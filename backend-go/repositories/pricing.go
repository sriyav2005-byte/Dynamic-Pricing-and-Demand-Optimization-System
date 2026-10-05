package repositories

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/rishabh26raj/priceiq/backend-go/database"
)

type Recommendation struct {
	ID                 string          `json:"id"`
	StoreID            string          `json:"store_id"`
	ProductID          string          `json:"product_id"`
	ProductName        string          `json:"product_name"`
	SKU                string          `json:"sku"`
	CurrentPrice       float64         `json:"current_price"`
	RecommendedPrice   float64         `json:"recommended_price"`
	ModelPrice         *float64        `json:"model_price"`
	ChangePct          float64         `json:"change_pct"`
	ExpectedDemand     *float64        `json:"expected_demand"`
	ExpectedRevenue    *float64        `json:"expected_revenue"`
	ExpectedProfit     *float64        `json:"expected_profit"`
	ExpectedMarginPct  *float64        `json:"expected_margin_pct"`
	Confidence         *float64        `json:"confidence"`
	Policy             string          `json:"policy"`
	ModelVersion       *string         `json:"model_version"`
	ConstraintsApplied json.RawMessage `json:"constraints_applied"`
	Explanation        json.RawMessage `json:"explanation"`
	Context            json.RawMessage `json:"context"`
	Status             string          `json:"status"`
	RequiresApproval   bool            `json:"requires_approval"`
	CreatedBy          *string         `json:"created_by"`
	ReviewedBy         *string         `json:"reviewed_by"`
	ReviewedAt         *time.Time      `json:"reviewed_at"`
	ReviewNote         *string         `json:"review_note"`
	AppliedBy          *string         `json:"applied_by"`
	AppliedAt          *time.Time      `json:"applied_at"`
	CreatedAt          time.Time       `json:"created_at"`
}

const recSelect = `select r.id, r.store_id, r.product_id, p.name, p.sku, r.current_price::float8, r.recommended_price::float8,
	r.model_price::float8, r.expected_demand, r.expected_revenue::float8, r.expected_profit::float8, r.expected_margin_pct,
	r.confidence, r.policy, mv.name || ':' || mv.version, r.constraints_applied, r.explanation, r.context, r.status::text,
	r.requires_approval, cb.email, rb.email, r.reviewed_at, r.review_note, ab.email, r.applied_at, r.created_at`

const recFrom = `
	from pricing_recommendations r
	join products p on p.id = r.product_id
	left join model_versions mv on mv.id = r.model_version_id
	left join profiles cb on cb.id = r.created_by
	left join profiles rb on rb.id = r.reviewed_by
	left join profiles ab on ab.id = r.applied_by`

func scanRec(row pgx.Row, extra ...any) (Recommendation, error) {
	var r Recommendation
	err := row.Scan(append([]any{&r.ID, &r.StoreID, &r.ProductID, &r.ProductName, &r.SKU, &r.CurrentPrice, &r.RecommendedPrice,
		&r.ModelPrice, &r.ExpectedDemand, &r.ExpectedRevenue, &r.ExpectedProfit, &r.ExpectedMarginPct, &r.Confidence,
		&r.Policy, &r.ModelVersion, &r.ConstraintsApplied, &r.Explanation, &r.Context, &r.Status, &r.RequiresApproval,
		&r.CreatedBy, &r.ReviewedBy, &r.ReviewedAt, &r.ReviewNote, &r.AppliedBy, &r.AppliedAt, &r.CreatedAt}, extra...)...)
	if err == nil && r.CurrentPrice > 0 {
		r.ChangePct = (r.RecommendedPrice - r.CurrentPrice) / r.CurrentPrice * 100
	}
	return r, err
}

type NewRecommendation struct {
	StoreID, ProductID                              string
	CurrentPrice, RecommendedPrice                  float64
	ModelPrice                                      *float64
	ExpectedDemand, ExpectedRevenue, ExpectedProfit *float64
	ExpectedMarginPct, Confidence                   *float64
	Policy                                          string
	ModelVersion                                    string // "name:version"
	ConstraintsApplied, Explanation, Context        any
	Status                                          string
	RequiresApproval                                bool
	CreatedBy                                       *string
}

func InsertRecommendation(ctx context.Context, q database.Querier, n NewRecommendation) (string, error) {
	ca, _ := json.Marshal(n.ConstraintsApplied)
	ex, _ := json.Marshal(n.Explanation)
	cx, _ := json.Marshal(n.Context)
	var id string
	err := q.QueryRow(ctx, `insert into pricing_recommendations(store_id, product_id, current_price, recommended_price, model_price,
			expected_demand, expected_revenue, expected_profit, expected_margin_pct, confidence, policy, model_version_id,
			constraints_applied, explanation, context, status, requires_approval, created_by)
		values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
			(select id from model_versions where name || ':' || version = $12),
			$13,$14,$15,$16::recommendation_status,$17,$18) returning id`,
		n.StoreID, n.ProductID, n.CurrentPrice, n.RecommendedPrice, n.ModelPrice, n.ExpectedDemand, n.ExpectedRevenue,
		n.ExpectedProfit, n.ExpectedMarginPct, n.Confidence, n.Policy, n.ModelVersion, ca, ex, cx, n.Status,
		n.RequiresApproval, n.CreatedBy).Scan(&id)
	return id, err
}

// SupersedePending marks older pending recommendations for a product.
func SupersedePending(ctx context.Context, q database.Querier, productID, exceptID string) error {
	_, err := q.Exec(ctx, `update pricing_recommendations set status='SUPERSEDED'
		where product_id=$1 and id <> $2 and status in ('PENDING', 'APPROVED')`, productID, exceptID)
	return err
}

func GetRecommendation(ctx context.Context, q database.Querier, storeID, id string, lock bool) (Recommendation, error) {
	sql := recSelect + recFrom + " where r.store_id=$1 and r.id=$2"
	if lock {
		sql += " for update of r"
	}
	return scanRec(q.QueryRow(ctx, sql, storeID, id))
}

type RecFilter struct {
	Status, ProductID string
	Limit, Offset     int
}

func ListRecommendations(ctx context.Context, q database.Querier, storeID string, f RecFilter) ([]Recommendation, int, error) {
	rows, err := q.Query(ctx, recSelect+`, count(*) over () `+recFrom+` where r.store_id=$1
		and ($2 = '' or r.status::text = $2) and ($3 = '' or r.product_id::text = $3)
		order by r.created_at desc limit $4 offset $5`, storeID, f.Status, f.ProductID, f.Limit, f.Offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []Recommendation{}
	total := 0
	for rows.Next() {
		r, err := scanRec(rows, &total)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, r)
	}
	return out, total, rows.Err()
}

func SetRecommendationStatus(ctx context.Context, q database.Querier, id, status string, reviewer *string, note *string) error {
	_, err := q.Exec(ctx, `update pricing_recommendations set status=$2::recommendation_status,
		reviewed_by = case when $2 in ('APPROVED','REJECTED') then $3 else reviewed_by end,
		reviewed_at = case when $2 in ('APPROVED','REJECTED') then now() else reviewed_at end,
		review_note = coalesce($4, review_note),
		applied_by = case when $2 = 'APPLIED' then $3 else applied_by end,
		applied_at = case when $2 = 'APPLIED' then now() else applied_at end
		where id=$1`, id, status, reviewer, note)
	return err
}

type PricePoint struct {
	OldPrice         *float64  `json:"old_price"`
	NewPrice         float64   `json:"new_price"`
	Source           string    `json:"source"`
	RecommendationID *string   `json:"recommendation_id"`
	ChangedBy        *string   `json:"changed_by"`
	Reason           *string   `json:"reason"`
	CreatedAt        time.Time `json:"created_at"`
}

func PriceHistory(ctx context.Context, q database.Querier, storeID, productID string, since time.Time, limit int) ([]PricePoint, error) {
	rows, err := q.Query(ctx, `select h.old_price::float8, h.new_price::float8, h.source, h.recommendation_id, pr.email, h.reason, h.created_at
		from pricing_history h left join profiles pr on pr.id = h.changed_by
		where h.store_id=$1 and h.product_id=$2 and h.created_at >= $3
		order by h.created_at desc limit $4`, storeID, productID, since, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (PricePoint, error) {
		var p PricePoint
		return p, r.Scan(&p.OldPrice, &p.NewPrice, &p.Source, &p.RecommendationID, &p.ChangedBy, &p.Reason, &p.CreatedAt)
	})
}
