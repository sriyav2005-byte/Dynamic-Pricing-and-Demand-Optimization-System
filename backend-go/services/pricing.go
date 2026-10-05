package services

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/rishabh26raj/priceiq/backend-go/clients"
	"github.com/rishabh26raj/priceiq/backend-go/database"
	"github.com/rishabh26raj/priceiq/backend-go/models"
	"github.com/rishabh26raj/priceiq/backend-go/repositories"
	"github.com/rishabh26raj/priceiq/backend-go/utils"
)

// aiRecommendation is the contract with POST /v1/pricing/recommend.
type aiRecommendation struct {
	RecommendedPrice  float64        `json:"recommended_price"`
	ModelPrice        float64        `json:"model_price"`
	ExpectedDemand    float64        `json:"expected_demand"`
	ExpectedRevenue   float64        `json:"expected_revenue"`
	ExpectedProfit    float64        `json:"expected_profit"`
	ExpectedMarginPct float64        `json:"expected_margin_pct"`
	Confidence        float64        `json:"confidence"`
	Policy            string         `json:"policy"`
	ModelVersion      string         `json:"model_version"`
	Explanation       map[string]any `json:"explanation"`
	Context           map[string]any `json:"context"`
	Candidates        []aiCandidate  `json:"candidates"`
}

type aiCandidate struct {
	Price   float64 `json:"price"`
	Demand  float64 `json:"demand"`
	Revenue float64 `json:"revenue"`
	Profit  float64 `json:"profit"`
	InBand  bool    `json:"in_band"`
}

// pricingContext loads product, settings and bounds in one user transaction.
func (s *Service) pricingContext(ctx context.Context, q database.Querier, storeID, productID string, lock bool) (models.Product, models.StoreSettings, Bounds, error) {
	var p models.Product
	var err error
	if lock {
		p, err = repositories.GetProductForUpdate(ctx, q, storeID, productID)
	} else {
		p, err = repositories.GetProduct(ctx, q, storeID, productID)
	}
	if err != nil {
		return p, models.StoreSettings{}, Bounds{}, err
	}
	st, err := repositories.GetSettings(ctx, q, storeID)
	if err != nil {
		return p, st, Bounds{}, err
	}
	rules, err := ParseRules(st.Rules)
	if err != nil {
		return p, st, Bounds{}, utils.Unprocessable("Store business rules are invalid", err.Error())
	}
	return p, st, PriceBounds(p, st, rules), nil
}

func aiErr(err error) error {
	var ae *clients.AIError
	switch {
	case errors.As(err, &ae) && ae.Status == 404:
		return utils.NotFound("Product")
	case errors.As(err, &ae) && ae.Status == 422:
		return utils.Unprocessable("AI service rejected the request", ae.Detail)
	case errors.As(err, &ae):
		return utils.NewError(502, "ai_error", "AI service error: "+ae.Detail)
	case errors.Is(err, clients.ErrAIUnavailable):
		return utils.Unavailable("The AI service is not reachable. Start it with `uvicorn app.main:app --port 8000` in backend/.")
	}
	return err
}

// GenerateRecommendation asks the AI service for a price inside the allowed
// band, enforces constraints again, stores the recommendation and — in
// AUTOMATIC mode, for low-risk changes only — applies it.
//
// Workflow:
//  1. (user tx, RLS) load product + store settings, compute the price band.
//  2. POST /v1/pricing/recommend with the band — the AI service picks a price
//     and explains it; it reads the database itself but only for these ids.
//  3. Enforce() clamps the answer into the band and records which rules bound
//     it; if the AI price was outside the band the expected impact is re-derived
//     from the nearest evaluated candidate so the numbers match the final price.
//  4. Pricing mode decides the next step: MANUAL → pending; SEMI_AUTOMATIC →
//     pending, approval required; AUTOMATIC → auto-apply only small,
//     confident, conflict-free changes, everything else waits for a manager.
//  5. (user tx) store the recommendation and supersede older pending ones.
func (s *Service) GenerateRecommendation(ctx context.Context, id database.Identity, storeID, productID string) (repositories.Recommendation, error) {
	var p models.Product
	var st models.StoreSettings
	var b Bounds
	err := s.DB.WithUser(ctx, id, func(tx pgx.Tx) error {
		var err error
		p, st, b, err = s.pricingContext(ctx, tx, storeID, productID, false)
		return err
	})
	if database.IsNotFound(err) {
		return repositories.Recommendation{}, utils.NotFound("Product")
	}
	if err != nil {
		return repositories.Recommendation{}, err
	}

	var ai aiRecommendation
	if err := s.AI.Post(ctx, "/v1/pricing/recommend", map[string]any{
		"store_id": storeID, "product_id": productID, "bounds": b, "settings": st,
	}, &ai, ""); err != nil {
		return repositories.Recommendation{}, aiErr(err)
	}

	final, enforced := Enforce(ai.RecommendedPrice, b)
	modelPrice := ai.ModelPrice
	if modelPrice <= 0 {
		modelPrice = ai.RecommendedPrice
	}
	_, applied := Enforce(modelPrice, b) // which rules moved the model's preferred price
	if final != utils.Round2(ai.RecommendedPrice) {
		slog.Warn("AI recommendation outside band — enforced", "product", productID, "ai", ai.RecommendedPrice, "final", final)
		applied = append(applied, enforced...)
	}
	demand, revenue, profit, margin := ai.ExpectedDemand, ai.ExpectedRevenue, ai.ExpectedProfit, ai.ExpectedMarginPct
	if final != utils.Round2(ai.RecommendedPrice) && len(ai.Candidates) > 0 {
		best := ai.Candidates[0]
		for _, c := range ai.Candidates {
			if math.Abs(c.Price-final) < math.Abs(best.Price-final) {
				best = c
			}
		}
		demand, revenue, profit = best.Demand, final*best.Demand, (final-p.CostPrice)*best.Demand
		margin = (final - p.CostPrice) / final * 100
	}

	changePct := math.Abs(final-p.SellingPrice) / p.SellingPrice
	status, requiresApproval, autoApply := "PENDING", false, false
	switch st.PricingMode {
	case "SEMI_AUTOMATIC":
		requiresApproval = true
	case "AUTOMATIC":
		if changePct > st.ApprovalThresholdPct || b.Conflict != "" || ai.Confidence < 0.5 {
			requiresApproval = true // high-risk ⇒ human review even in automatic mode
		} else if changePct > 0.0001 {
			autoApply = true
		}
	}
	if b.Conflict != "" {
		requiresApproval = true
	}
	action := "HOLD"
	if final > p.SellingPrice+0.004 {
		action = "INCREASE"
	} else if final < p.SellingPrice-0.004 {
		action = "DECREASE"
	}
	if ai.Explanation == nil {
		ai.Explanation = map[string]any{}
	}
	ai.Explanation["action"] = action
	ai.Explanation["bounds"] = b
	ai.Explanation["pricing_mode"] = st.PricingMode
	if ai.Context == nil {
		ai.Context = map[string]any{}
	}
	ai.Context["candidates"] = ai.Candidates

	var recID string
	err = s.DB.WithUser(ctx, id, func(tx pgx.Tx) error {
		var err error
		recID, err = repositories.InsertRecommendation(ctx, tx, repositories.NewRecommendation{
			StoreID: storeID, ProductID: productID, CurrentPrice: p.SellingPrice, RecommendedPrice: final,
			ModelPrice: &modelPrice, ExpectedDemand: &demand, ExpectedRevenue: ptr(utils.Round2(revenue)),
			ExpectedProfit: ptr(utils.Round2(profit)), ExpectedMarginPct: ptr(utils.Round2(margin)),
			Confidence: &ai.Confidence, Policy: ai.Policy, ModelVersion: ai.ModelVersion,
			ConstraintsApplied: applied, Explanation: ai.Explanation, Context: ai.Context,
			Status: status, RequiresApproval: requiresApproval, CreatedBy: &id.UserID,
		})
		if err != nil {
			return err
		}
		return repositories.SupersedePending(ctx, tx, productID, recID)
	})
	if err != nil {
		return repositories.Recommendation{}, err
	}
	if autoApply {
		if _, err := s.applyRecommendation(ctx, nil, storeID, recID, "automatic pricing (store policy)"); err != nil {
			slog.Warn("automatic apply failed", "rec", recID, "err", err)
		}
	}
	return s.GetRecommendation(ctx, id, storeID, recID)
}

func (s *Service) GetRecommendation(ctx context.Context, id database.Identity, storeID, recID string) (repositories.Recommendation, error) {
	var r repositories.Recommendation
	err := s.DB.WithUser(ctx, id, func(tx pgx.Tx) error {
		var err error
		r, err = repositories.GetRecommendation(ctx, tx, storeID, recID, false)
		return err
	})
	if database.IsNotFound(err) {
		return r, utils.NotFound("Recommendation")
	}
	return r, err
}

func (s *Service) ListRecommendations(ctx context.Context, id database.Identity, storeID string, f repositories.RecFilter) (models.Page[repositories.Recommendation], error) {
	var page models.Page[repositories.Recommendation]
	err := s.DB.WithUser(ctx, id, func(tx pgx.Tx) error {
		var err error
		page.Data, page.Total, err = repositories.ListRecommendations(ctx, tx, storeID, f)
		return err
	})
	return page, err
}

// ReviewRecommendation approves or rejects a pending recommendation.
func (s *Service) ReviewRecommendation(ctx context.Context, id database.Identity, storeID, recID string, approve bool, note string, applyNow bool) (repositories.Recommendation, error) {
	err := s.userTx(ctx, id, note, func(tx pgx.Tx) error {
		r, err := repositories.GetRecommendation(ctx, tx, storeID, recID, true)
		if err != nil {
			return err
		}
		if r.Status != "PENDING" {
			return utils.Conflict(fmt.Sprintf("Recommendation is %s, only PENDING recommendations can be reviewed", r.Status))
		}
		status := "REJECTED"
		if approve {
			status = "APPROVED"
		}
		var n *string
		if note != "" {
			n = &note
		}
		return repositories.SetRecommendationStatus(ctx, tx, recID, status, &id.UserID, n)
	})
	if database.IsNotFound(err) {
		return repositories.Recommendation{}, utils.NotFound("Recommendation")
	}
	if err != nil {
		return repositories.Recommendation{}, err
	}
	if approve && applyNow {
		return s.ApplyRecommendation(ctx, id, storeID, recID, note)
	}
	return s.GetRecommendation(ctx, id, storeID, recID)
}

// ApplyRecommendation sets the product price to the recommendation.
func (s *Service) ApplyRecommendation(ctx context.Context, id database.Identity, storeID, recID, note string) (repositories.Recommendation, error) {
	if _, err := s.applyRecommendation(ctx, &id, storeID, recID, note); err != nil {
		return repositories.Recommendation{}, err
	}
	return s.GetRecommendation(ctx, id, storeID, recID)
}

// applyRecommendation runs as the user (manual/semi-automatic) or as the
// system (automatic mode, id == nil). Constraints are re-validated against
// the product's current state; stale recommendations are refused.
func (s *Service) applyRecommendation(ctx context.Context, id *database.Identity, storeID, recID, note string) (float64, error) {
	var price float64
	var staleErr error
	fn := func(tx pgx.Tx) error {
		r, err := repositories.GetRecommendation(ctx, tx, storeID, recID, true)
		if err != nil {
			return err
		}
		switch {
		case r.Status == "APPROVED":
		case r.Status == "PENDING" && !r.RequiresApproval:
		case r.Status == "PENDING" && id == nil: // automatic mode, low-risk
		case r.Status == "PENDING":
			return utils.Conflict("This recommendation requires manager approval before it can be applied")
		default:
			return utils.Conflict(fmt.Sprintf("Recommendation is %s and cannot be applied", r.Status))
		}
		p, _, b, err := s.pricingContext(ctx, tx, storeID, r.ProductID, true)
		if err != nil {
			return err
		}
		if math.Abs(p.SellingPrice-r.CurrentPrice) > 0.005 {
			// Commit the EXPIRED status, then report the conflict.
			staleErr = utils.Conflict(fmt.Sprintf("The price changed from ₹%.2f to ₹%.2f since this recommendation was generated — generate a new one", r.CurrentPrice, p.SellingPrice))
			return repositories.SetRecommendationStatus(ctx, tx, recID, "EXPIRED", nil, strPtr("price changed since recommendation"))
		}
		if v := ValidatePrice(r.RecommendedPrice, b); len(v) > 0 {
			return utils.Unprocessable("Recommended price violates current pricing constraints", v)
		}
		source := "RECOMMENDATION"
		if id == nil {
			source = "AUTOMATIC"
		}
		reason := note
		if reason == "" {
			reason = fmt.Sprintf("applied %s recommendation", r.Policy)
		}
		for k, v := range map[string]string{"app.price_source": source, "app.recommendation_id": recID, "app.audit_reason": reason} {
			if err := database.SetLocal(ctx, tx, k, v); err != nil {
				return err
			}
		}
		if err := repositories.SetPrice(ctx, tx, storeID, r.ProductID, r.RecommendedPrice); err != nil {
			return err
		}
		var who *string
		if id != nil {
			who = &id.UserID
		}
		price = r.RecommendedPrice
		return repositories.SetRecommendationStatus(ctx, tx, recID, "APPLIED", who, nil)
	}
	var err error
	if id != nil {
		err = s.DB.WithUser(ctx, *id, fn)
	} else {
		err = s.DB.WithSystem(ctx, fn)
	}
	if database.IsNotFound(err) {
		return 0, utils.NotFound("Recommendation")
	}
	if err == nil && staleErr != nil {
		return 0, staleErr
	}
	if err == nil {
		s.invalidate(ctx, storeID)
	}
	return price, err
}

// BatchRecommend generates recommendations for many products concurrently.
type BatchResult struct {
	Requested int                           `json:"requested"`
	Generated int                           `json:"generated"`
	Failed    []map[string]string           `json:"failed"`
	Items     []repositories.Recommendation `json:"items"`
}

func (s *Service) BatchRecommend(ctx context.Context, id database.Identity, storeID string, productIDs []string, concurrency int) BatchResult {
	if concurrency <= 0 {
		concurrency = 4
	}
	res := BatchResult{Requested: len(productIDs), Failed: []map[string]string{}, Items: []repositories.Recommendation{}}
	var mu sync.Mutex
	var wg sync.WaitGroup
	sem := make(chan struct{}, concurrency)
	for _, pid := range productIDs {
		wg.Add(1)
		go func(pid string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			cctx, cancel := context.WithTimeout(ctx, 90*time.Second)
			defer cancel()
			r, err := s.GenerateRecommendation(cctx, id, storeID, pid)
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				res.Failed = append(res.Failed, map[string]string{"product_id": pid, "error": err.Error()})
				return
			}
			res.Generated++
			res.Items = append(res.Items, r)
		}(pid)
	}
	wg.Wait()
	return res
}

// ── Simulation ──────────────────────────────────────────────────────────────

type SimulationRequest struct {
	ProductID   string           `json:"product_id" binding:"required,uuid"`
	Prices      []float64        `json:"prices" binding:"max=50,dive,gt=0"`
	Scenarios   []map[string]any `json:"scenarios" binding:"max=10"`
	HorizonDays int              `json:"horizon_days" binding:"omitempty,min=1,max=90"`
}

// Simulate runs a what-if analysis in the AI service. Each price is annotated
// with the constraint violations it would cause (simulations are allowed to
// explore prices outside the band; applying them is not).
func (s *Service) Simulate(ctx context.Context, id database.Identity, storeID string, req SimulationRequest) (map[string]any, error) {
	var p models.Product
	var st models.StoreSettings
	var b Bounds
	err := s.DB.WithUser(ctx, id, func(tx pgx.Tx) error {
		var err error
		p, st, b, err = s.pricingContext(ctx, tx, storeID, req.ProductID, false)
		return err
	})
	if database.IsNotFound(err) {
		return nil, utils.NotFound("Product")
	}
	if err != nil {
		return nil, err
	}
	if len(req.Prices) == 0 {
		cur := p.SellingPrice
		req.Prices = []float64{utils.Round2(cur * 0.9), utils.Round2(cur * 0.95), cur, utils.Round2(math.Min(cur*1.05, p.MRP))}
	}
	for _, pr := range req.Prices {
		if pr > p.MRP*3 {
			return nil, utils.Unprocessable("Simulated price is unrealistic", map[string]string{"prices": fmt.Sprintf("₹%.2f is more than 3× MRP", pr)})
		}
	}
	violations := map[string][]string{}
	for _, pr := range req.Prices {
		v := ValidatePrice(pr, b)
		if pr > p.MRP {
			v = append(v, "exceeds MRP (illegal to charge)")
		}
		if pr < p.CostPrice {
			v = append(v, "below cost (loss per unit)")
		}
		violations[fmt.Sprintf("%.2f", pr)] = v
	}
	var horizon any // omitted ⇒ the AI service picks the planning horizon
	if req.HorizonDays > 0 {
		horizon = req.HorizonDays
	}
	var out map[string]any
	if err := s.AI.Post(ctx, "/v1/pricing/simulate", map[string]any{
		"store_id": storeID, "product_id": req.ProductID, "prices": req.Prices, "scenarios": req.Scenarios,
		"horizon_days": horizon, "bounds": b, "settings": st,
	}, &out, ""); err != nil {
		return nil, aiErr(err)
	}
	out["constraint_violations"] = violations
	out["bounds"] = b
	return out, nil
}

func (s *Service) PriceHistory(ctx context.Context, id database.Identity, storeID, productID string, days int) ([]repositories.PricePoint, error) {
	var out []repositories.PricePoint
	err := s.DB.WithUser(ctx, id, func(tx pgx.Tx) error {
		ref, _, err := repositories.ReferenceTime(ctx, tx, storeID)
		if err != nil {
			return err
		}
		out, err = repositories.PriceHistory(ctx, tx, storeID, productID, ref.AddDate(0, 0, -days), 2000)
		return err
	})
	return out, err
}
