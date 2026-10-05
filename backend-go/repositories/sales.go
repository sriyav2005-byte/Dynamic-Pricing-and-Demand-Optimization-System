package repositories

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/rishabh26raj/priceiq/backend-go/database"
	"github.com/rishabh26raj/priceiq/backend-go/models"
)

func InsertSale(ctx context.Context, q database.Querier, s models.Sale, userID string) error {
	_, err := q.Exec(ctx, `insert into sales(id, store_id, product_id, quantity, unit_price, unit_cost, recommendation_id, source, sold_at, created_by)
		values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
		s.ID, s.StoreID, s.ProductID, s.Quantity, s.UnitPrice, s.UnitCost, s.RecommendationID, s.Source, s.SoldAt, userID)
	return err
}

func ListSales(ctx context.Context, q database.Querier, storeID, productID string, from, to time.Time, limit, offset int) ([]models.Sale, int, error) {
	rows, err := q.Query(ctx, `select s.id, s.store_id, s.product_id, p.name, s.quantity, s.unit_price::float8, s.unit_cost::float8,
			s.revenue::float8, s.profit::float8, s.recommendation_id, s.source, s.sold_at, count(*) over ()
		from sales s join products p on p.id = s.product_id
		where s.store_id=$1 and ($2 = '' or s.product_id::text = $2) and s.sold_at >= $3 and s.sold_at < $4
		order by s.sold_at desc limit $5 offset $6`, storeID, productID, from, to, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []models.Sale{}
	total := 0
	for rows.Next() {
		var s models.Sale
		if err := rows.Scan(&s.ID, &s.StoreID, &s.ProductID, &s.ProductName, &s.Quantity, &s.UnitPrice, &s.UnitCost,
			&s.Revenue, &s.Profit, &s.RecommendationID, &s.Source, &s.SoldAt, &total); err != nil {
			return nil, 0, err
		}
		out = append(out, s)
	}
	return out, total, rows.Err()
}

// ── Analytics ───────────────────────────────────────────────────────────────

type Totals struct {
	Revenue  float64 `json:"revenue"`
	Profit   float64 `json:"profit"`
	Units    int     `json:"units"`
	Orders   int     `json:"orders"`
	Products int     `json:"products_sold"`
}

func SalesTotals(ctx context.Context, q database.Querier, storeID string, from, to time.Time) (Totals, error) {
	var t Totals
	err := q.QueryRow(ctx, `select coalesce(sum(revenue),0)::float8, coalesce(sum(profit),0)::float8,
			coalesce(sum(quantity),0)::int, count(*)::int, count(distinct product_id)::int
		from sales where store_id=$1 and sold_at >= $2 and sold_at < $3`, storeID, from, to).
		Scan(&t.Revenue, &t.Profit, &t.Units, &t.Orders, &t.Products)
	return t, err
}

type TrendPoint struct {
	Date    string  `json:"date"`
	Revenue float64 `json:"revenue"`
	Profit  float64 `json:"profit"`
	Units   int     `json:"units"`
}

// DailyTrend returns one point per day in [from, to), zero-filled.
func DailyTrend(ctx context.Context, q database.Querier, storeID, productID string, from, to time.Time) ([]TrendPoint, error) {
	rows, err := q.Query(ctx, `
		with st as (select timezone as tz from stores where id = $1),
		days as (
			select generate_series(($2::timestamptz at time zone (select tz from st))::date,
			                       (($3::timestamptz - interval '1 second') at time zone (select tz from st))::date,
			                       interval '1 day')::date as d)
		select to_char(d.d, 'YYYY-MM-DD'), coalesce(sum(s.revenue),0)::float8, coalesce(sum(s.profit),0)::float8,
		       coalesce(sum(s.quantity),0)::int
		from days d
		left join sales s on s.store_id = $1 and ($4 = '' or s.product_id::text = $4)
		                 and s.sold_at >= $2 and s.sold_at < $3
		                 and (s.sold_at at time zone (select tz from st))::date = d.d
		group by d.d order by d.d`, storeID, from, to, productID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (TrendPoint, error) {
		var p TrendPoint
		return p, r.Scan(&p.Date, &p.Revenue, &p.Profit, &p.Units)
	})
}

type GroupPerf struct {
	Key       string  `json:"key"`
	Name      string  `json:"name"`
	Revenue   float64 `json:"revenue"`
	Profit    float64 `json:"profit"`
	Units     int     `json:"units"`
	MarginPct float64 `json:"margin_pct"`
}

func CategoryPerformance(ctx context.Context, q database.Querier, storeID string, from, to time.Time) ([]GroupPerf, error) {
	rows, err := q.Query(ctx, `select coalesce(c.id::text, 'none'), coalesce(c.name, 'Uncategorised'),
			sum(s.revenue)::float8, sum(s.profit)::float8, sum(s.quantity)::int
		from sales s join products p on p.id = s.product_id left join categories c on c.id = p.category_id
		where s.store_id=$1 and s.sold_at >= $2 and s.sold_at < $3
		group by 1, 2 order by 3 desc`, storeID, from, to)
	return collectPerf(rows, err)
}

func ProductPerformance(ctx context.Context, q database.Querier, storeID string, from, to time.Time, sortBy string, desc bool, limit int) ([]GroupPerf, error) {
	col := map[string]string{
		"revenue": "sum(s.revenue)", "profit": "sum(s.profit)", "units": "sum(s.quantity)",
		"margin": "sum(s.profit) / nullif(sum(s.revenue), 0)",
	}[sortBy]
	if col == "" {
		col = "sum(s.revenue)"
	}
	dir := "desc"
	if !desc {
		dir = "asc"
	}
	rows, err := q.Query(ctx, `select p.id::text, p.name, coalesce(sum(s.revenue),0)::float8, coalesce(sum(s.profit),0)::float8,
			coalesce(sum(s.quantity),0)::int
		from products p left join sales s on s.product_id = p.id and s.sold_at >= $2 and s.sold_at < $3
		where p.store_id=$1 and p.is_active
		group by p.id, p.name order by `+col+` `+dir+` nulls last limit $4`, storeID, from, to, limit)
	return collectPerf(rows, err)
}

func collectPerf(rows pgx.Rows, err error) ([]GroupPerf, error) {
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (GroupPerf, error) {
		var g GroupPerf
		err := r.Scan(&g.Key, &g.Name, &g.Revenue, &g.Profit, &g.Units)
		if g.Revenue > 0 {
			g.MarginPct = g.Profit / g.Revenue * 100
		}
		return g, err
	})
}

// ReferenceTime returns the analytics anchor for the store.
func ReferenceTime(ctx context.Context, q database.Querier, storeID string) (time.Time, string, error) {
	var t time.Time
	var mode string
	err := q.QueryRow(ctx, "select app.store_reference_time($1), data_mode from stores where id=$1", storeID).Scan(&t, &mode)
	return t, mode, err
}

// DataRange returns the first and last sale timestamps (nil when no sales).
func DataRange(ctx context.Context, q database.Querier, storeID string) (*time.Time, *time.Time, error) {
	var a, b *time.Time
	err := q.QueryRow(ctx, "select min(sold_at), max(sold_at) from sales where store_id=$1", storeID).Scan(&a, &b)
	return a, b, err
}

type InventoryValue struct {
	AtCost   float64 `json:"at_cost"`
	AtRetail float64 `json:"at_retail"`
	Units    int     `json:"units"`
}

func InventoryValuation(ctx context.Context, q database.Querier, storeID string) (InventoryValue, error) {
	var v InventoryValue
	err := q.QueryRow(ctx, `select coalesce(sum(stock * cost_price),0)::float8, coalesce(sum(stock * selling_price),0)::float8,
		coalesce(sum(stock),0)::int from products where store_id=$1 and is_active`, storeID).Scan(&v.AtCost, &v.AtRetail, &v.Units)
	return v, err
}
