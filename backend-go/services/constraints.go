package services

import (
	"encoding/json"
	"fmt"
	"math"
	"strings"

	"github.com/rishabh26raj/priceiq/backend-go/models"
	"github.com/rishabh26raj/priceiq/backend-go/utils"
)

// Margin convention used everywhere in PriceIQ: gross margin on selling price,
//   margin = (price − cost) / price
// so a minimum margin m implies price ≥ cost / (1 − m).

// BusinessRules is the typed view of store_settings.rules (all optional).
type BusinessRules struct {
	RoundTo           float64            `json:"round_to"`            // e.g. 0.5 or 1 (rupee)
	MinPrice          float64            `json:"min_price"`           // absolute floor
	MaxPrice          float64            `json:"max_price"`           // absolute ceiling
	CategoryMinMargin map[string]float64 `json:"category_min_margin"` // category name → margin
	FreezeCategories  []string           `json:"freeze_categories"`   // never reprice these
}

func ParseRules(raw json.RawMessage) (BusinessRules, error) {
	var r BusinessRules
	if len(raw) == 0 || string(raw) == "null" {
		return r, nil
	}
	if err := json.Unmarshal(raw, &r); err != nil {
		return r, fmt.Errorf("rules: %w", err)
	}
	if r.RoundTo < 0 || r.RoundTo > 100 {
		return r, fmt.Errorf("rules.round_to must be between 0 and 100")
	}
	if r.MinPrice < 0 || r.MaxPrice < 0 || (r.MaxPrice > 0 && r.MinPrice > r.MaxPrice) {
		return r, fmt.Errorf("rules.min_price/max_price are invalid")
	}
	for k, v := range r.CategoryMinMargin {
		if v < 0 || v >= 1 {
			return r, fmt.Errorf("rules.category_min_margin[%s] must be in [0, 1)", k)
		}
	}
	return r, nil
}

// BoundRule describes one constraint's contribution to the price band.
type BoundRule struct {
	Rule    string  `json:"rule"`
	Kind    string  `json:"kind"` // floor | ceiling
	Value   float64 `json:"value"`
	Message string  `json:"message"`
}

// Bounds is the allowed price band [Lo, Hi] for a product.
type Bounds struct {
	Lo           float64     `json:"lo"`
	Hi           float64     `json:"hi"`
	RoundTo      float64     `json:"round_to"`
	ExpiryWindow bool        `json:"expiry_window"`
	Frozen       bool        `json:"frozen"`
	Conflict     string      `json:"conflict,omitempty"`
	Rules        []BoundRule `json:"rules"`
}

// AppliedConstraint documents a constraint that changed the model's price.
type AppliedConstraint struct {
	Rule    string  `json:"rule"`
	Before  float64 `json:"before"`
	After   float64 `json:"after"`
	Message string  `json:"message"`
}

// PriceBounds computes the band every recommended price must fall into.
//
// Why this lives in Go and not in the ML service: the model optimises expected
// profit and may explore, so legal and commercial limits must be enforced by
// deterministic code the business can read. The band is computed twice — when
// a recommendation is generated and again when it is applied (the product may
// have changed in between) — and the ML output is clamped into it by Enforce.
//
// Order of rules (each one is recorded in Bounds.Rules for the explanation):
//
//	frozen category        → price cannot change at all
//	floors                 minimum margin (category override), max decrease per update,
//	                       business-rule minimum; inside the expiry window the margin floor
//	                       relaxes to break-even (or zero when below-cost clearance is allowed)
//	                       and the larger expiry markdown limit applies
//	ceilings               max increase per update, MRP (legal), business-rule maximum;
//	                       expiring stock can never be marked up
//	conflict resolution    MRP > minimum margin > change limit
func PriceBounds(p models.Product, st models.StoreSettings, rules BusinessRules) Bounds {
	b := Bounds{RoundTo: rules.RoundTo}
	cur := p.SellingPrice
	cat := ""
	if p.Category != nil {
		cat = *p.Category
	}
	for _, fc := range rules.FreezeCategories {
		if strings.EqualFold(fc, cat) {
			b.Frozen = true
		}
	}
	if b.Frozen {
		b.Lo, b.Hi = cur, cur
		b.Rules = []BoundRule{{"frozen_category", "floor", cur, "Category is frozen by business rules — price is not changed"}}
		return b
	}
	b.ExpiryWindow = p.DaysToExpiry != nil && *p.DaysToExpiry >= 0 && *p.DaysToExpiry <= st.ExpiryMarkdownDays && p.Stock > 0

	minMargin := st.MinMarginPct
	for k, v := range rules.CategoryMinMargin {
		if strings.EqualFold(k, cat) {
			minMargin = v
		}
	}
	// Floors
	marginFloor := p.CostPrice / (1 - minMargin)
	marginMsg := fmt.Sprintf("Minimum margin %.0f%% ⇒ price ≥ ₹%.2f", minMargin*100, marginFloor)
	if b.ExpiryWindow {
		if st.AllowBelowCostClearance {
			marginFloor = 0
			marginMsg = "Expiry clearance: below-cost pricing allowed by store settings"
		} else {
			marginFloor = p.CostPrice
			marginMsg = fmt.Sprintf("Expiry clearance: margin floor relaxed to break-even (₹%.2f)", p.CostPrice)
		}
	}
	maxDown := st.MaxPriceChangePct
	downMsg := fmt.Sprintf("Maximum price change %.0f%% per update", st.MaxPriceChangePct*100)
	if b.ExpiryWindow {
		maxDown = math.Max(maxDown, st.MaxExpiryMarkdownPct)
		downMsg = fmt.Sprintf("Expiry markdown limit %.0f%%", maxDown*100)
	}
	changeFloor := cur * (1 - maxDown)
	b.Rules = append(b.Rules,
		BoundRule{"min_margin", "floor", utils.Round2(marginFloor), marginMsg},
		BoundRule{"max_price_change", "floor", utils.Round2(changeFloor), downMsg},
	)
	lo := math.Max(marginFloor, changeFloor)
	if rules.MinPrice > 0 {
		lo = math.Max(lo, rules.MinPrice)
		b.Rules = append(b.Rules, BoundRule{"business_rule_min_price", "floor", rules.MinPrice, "Business rule minimum price"})
	}
	// Ceilings
	changeCeil := cur * (1 + st.MaxPriceChangePct)
	b.Rules = append(b.Rules,
		BoundRule{"max_price_change", "ceiling", utils.Round2(changeCeil), fmt.Sprintf("Maximum price increase %.0f%% per update", st.MaxPriceChangePct*100)},
		BoundRule{"mrp_ceiling", "ceiling", p.MRP, fmt.Sprintf("Price can never exceed MRP (₹%.2f)", p.MRP)},
	)
	hi := math.Min(changeCeil, p.MRP)
	if rules.MaxPrice > 0 {
		hi = math.Min(hi, rules.MaxPrice)
		b.Rules = append(b.Rules, BoundRule{"business_rule_max_price", "ceiling", rules.MaxPrice, "Business rule maximum price"})
	}
	if b.ExpiryWindow && p.Stock > 0 {
		// While clearing expiring stock, never recommend a price increase.
		hi = math.Min(hi, cur)
		b.Rules = append(b.Rules, BoundRule{"expiry_no_increase", "ceiling", cur, "Expiring stock: price increases are blocked"})
	}

	// Conflict resolution. Priority: MRP (legal) > minimum margin > change limit.
	if lo > hi {
		switch {
		case marginFloor > p.MRP:
			b.Conflict = "Minimum margin cannot be met below MRP; price pinned to MRP"
			lo, hi = p.MRP, p.MRP
		case marginFloor > hi:
			b.Conflict = fmt.Sprintf("Current price is below the minimum margin floor; restoring margin requires a change beyond the %.0f%% limit", st.MaxPriceChangePct*100)
			hi = math.Min(p.MRP, math.Max(marginFloor, rules.MinPrice))
			lo = hi
		default:
			b.Conflict = "Business rules conflict; price held"
			lo, hi = cur, cur
		}
	}
	b.Lo, b.Hi = utils.Round2(lo), utils.Round2(hi)
	if b.Lo > b.Hi { // rounding guard
		b.Lo = b.Hi
	}
	return b
}

// roundWithin rounds to the nearest multiple of step that stays in [lo, hi].
func roundWithin(price, step, lo, hi float64) float64 {
	if step <= 0 {
		return utils.Round2(price)
	}
	n := math.Round(price/step) * step
	if n > hi+1e-9 {
		n = math.Floor(hi/step) * step
	}
	if n < lo-1e-9 {
		n = math.Ceil(lo/step) * step
	}
	if n < lo-1e-9 || n > hi+1e-9 { // no multiple inside the band
		return utils.Round2(utils.Clamp(price, lo, hi))
	}
	return utils.Round2(n)
}

// Enforce clamps a proposed price into the band and reports every constraint
// that changed it. It is the final gate for all ML recommendations.
func Enforce(proposed float64, b Bounds) (float64, []AppliedConstraint) {
	applied := []AppliedConstraint{}
	price := proposed
	if math.IsNaN(price) || math.IsInf(price, 0) || price <= 0 {
		applied = append(applied, AppliedConstraint{"invalid_model_output", proposed, b.Hi, "Model returned an invalid price; using the upper bound of the allowed band"})
		price = b.Hi
	}
	if price > b.Hi {
		rule, msg := bindingRule(b, "ceiling", b.Hi)
		applied = append(applied, AppliedConstraint{rule, utils.Round2(price), b.Hi, msg})
		price = b.Hi
	}
	if price < b.Lo {
		rule, msg := bindingRule(b, "floor", b.Lo)
		applied = append(applied, AppliedConstraint{rule, utils.Round2(price), b.Lo, msg})
		price = b.Lo
	}
	rounded := roundWithin(price, b.RoundTo, b.Lo, b.Hi)
	if rounded != utils.Round2(price) {
		applied = append(applied, AppliedConstraint{"price_rounding", utils.Round2(price), rounded, fmt.Sprintf("Rounded to a multiple of ₹%g", b.RoundTo)})
	}
	if b.Conflict != "" {
		applied = append(applied, AppliedConstraint{"rule_conflict", utils.Round2(proposed), rounded, b.Conflict})
	}
	return rounded, applied
}

// bindingRule picks the tightest rule of the given kind at value v.
func bindingRule(b Bounds, kind string, v float64) (string, string) {
	best, msg, dist := "constraint", "", math.MaxFloat64
	for _, r := range b.Rules {
		if r.Kind != kind {
			continue
		}
		if d := math.Abs(r.Value - v); d < dist {
			best, msg, dist = r.Rule, r.Message, d
		}
	}
	return best, msg
}

// ValidatePrice checks a concrete price (e.g. at apply time) against the band.
func ValidatePrice(price float64, b Bounds) []string {
	var v []string
	if price > b.Hi+0.005 {
		v = append(v, fmt.Sprintf("₹%.2f is above the allowed maximum ₹%.2f", price, b.Hi))
	}
	if price < b.Lo-0.005 {
		v = append(v, fmt.Sprintf("₹%.2f is below the allowed minimum ₹%.2f", price, b.Lo))
	}
	return v
}
