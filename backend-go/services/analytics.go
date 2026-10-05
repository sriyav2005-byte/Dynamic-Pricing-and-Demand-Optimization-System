package services

import (
	"context"
	"fmt"
	"time"
	_ "time/tzdata" // embedded zone database (Windows has none)

	"github.com/jackc/pgx/v5"

	"github.com/rishabh26raj/priceiq/backend-go/clients"
	"github.com/rishabh26raj/priceiq/backend-go/database"
	"github.com/rishabh26raj/priceiq/backend-go/repositories"
	"github.com/rishabh26raj/priceiq/backend-go/utils"
)

// Range is an analytics window [From, To).
type Range struct {
	From time.Time `json:"from"`
	To   time.Time `json:"to"`
}

// ResolveRange parses optional YYYY-MM-DD bounds. Without bounds the window
// is the `days` days ending at the store's reference time (today for LIVE
// stores, the last sale for SYNTHETIC ones).
func (s *Service) ResolveRange(ctx context.Context, id database.Identity, storeID, from, to string, days int) (Range, error) {
	var r Range
	var ref time.Time
	var tz string
	err := s.DB.WithUser(ctx, id, func(tx pgx.Tx) error {
		var err error
		if ref, _, err = repositories.ReferenceTime(ctx, tx, storeID); err != nil {
			return err
		}
		return tx.QueryRow(ctx, "select timezone from stores where id=$1", storeID).Scan(&tz)
	})
	if err != nil {
		return r, err
	}
	// Day boundaries follow the store's local calendar (e.g. Asia/Kolkata).
	loc, lerr := time.LoadLocation(tz)
	if lerr != nil {
		loc = time.UTC
	}
	if days <= 0 || days > 3660 {
		days = 30
	}
	refLocal := ref.In(loc)
	r.To = time.Date(refLocal.Year(), refLocal.Month(), refLocal.Day()+1, 0, 0, 0, 0, loc)
	if to != "" {
		t, err := time.ParseInLocation("2006-01-02", to, loc)
		if err != nil {
			return r, utils.BadRequest("to must be YYYY-MM-DD")
		}
		r.To = t.AddDate(0, 0, 1)
	}
	r.From = r.To.AddDate(0, 0, -days)
	if from != "" {
		f, err := time.ParseInLocation("2006-01-02", from, loc)
		if err != nil {
			return r, utils.BadRequest("from must be YYYY-MM-DD")
		}
		r.From = f
	}
	if !r.From.Before(r.To) {
		return r, utils.BadRequest("from must be before to")
	}
	if r.To.Sub(r.From) > 3660*24*time.Hour {
		return r, utils.BadRequest("range is limited to 10 years")
	}
	return r, nil
}

type Summary struct {
	Range                  Range                       `json:"range"`
	DataMode               string                      `json:"data_mode"`
	DataFrom               *time.Time                  `json:"data_from"`
	DataTo                 *time.Time                  `json:"data_to"`
	Current                repositories.Totals         `json:"current"`
	Previous               repositories.Totals         `json:"previous"`
	AvgMarginPct           float64                     `json:"avg_margin_pct"`
	RevenueChangePct       *float64                    `json:"revenue_change_pct"`
	ProfitChangePct        *float64                    `json:"profit_change_pct"`
	UnitsChangePct         *float64                    `json:"units_change_pct"`
	Inventory              repositories.InventoryValue `json:"inventory"`
	AtRiskProducts         int                         `json:"at_risk_products"`
	CompetitorGap          CompetitorGap               `json:"competitor_gap"`
	PendingRecommendations int                         `json:"pending_recommendations"`
	OpenAlerts             map[string]int              `json:"open_alerts"`
}

type CompetitorGap struct {
	ProductsCompared    int      `json:"products_compared"`
	AvgGapPct           *float64 `json:"avg_gap_pct"` // + ⇒ we are more expensive than the market average
	ProductsAboveMarket int      `json:"products_above_market"`
	Note                string   `json:"note"`
}

func pctChange(cur, prev float64) *float64 {
	if prev == 0 {
		return nil
	}
	v := utils.Round2((cur - prev) / prev * 100)
	return &v
}

func (s *Service) cacheKey(ctx context.Context, storeID, kind string, parts ...any) string {
	return fmt.Sprintf("an:%s:%s:%s:%v", storeID, clients.StoreVersion(ctx, s.Cache, storeID), kind, parts)
}

func (s *Service) Summary(ctx context.Context, id database.Identity, storeID string, r Range) (Summary, error) {
	key := s.cacheKey(ctx, storeID, "summary", r.From.Unix(), r.To.Unix())
	var out Summary
	if clients.GetJSON(ctx, s.Cache, key, &out) {
		return out, nil
	}
	out.Range = r
	err := s.DB.WithUser(ctx, id, func(tx pgx.Tx) error {
		var err error
		if _, out.DataMode, err = repositories.ReferenceTime(ctx, tx, storeID); err != nil {
			return err
		}
		if out.DataFrom, out.DataTo, err = repositories.DataRange(ctx, tx, storeID); err != nil {
			return err
		}
		if out.Current, err = repositories.SalesTotals(ctx, tx, storeID, r.From, r.To); err != nil {
			return err
		}
		span := r.To.Sub(r.From)
		if out.Previous, err = repositories.SalesTotals(ctx, tx, storeID, r.From.Add(-span), r.From); err != nil {
			return err
		}
		if out.Inventory, err = repositories.InventoryValuation(ctx, tx, storeID); err != nil {
			return err
		}
		if out.CompetitorGap, err = competitorGap(ctx, tx, storeID); err != nil {
			return err
		}
		if err = tx.QueryRow(ctx, "select count(*) from pricing_recommendations where store_id=$1 and status='PENDING'", storeID).
			Scan(&out.PendingRecommendations); err != nil {
			return err
		}
		out.OpenAlerts = map[string]int{}
		rows, err := tx.Query(ctx, "select severity::text, count(*) from alerts where store_id=$1 and status <> 'RESOLVED' group by 1", storeID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var sev string
			var n int
			if err := rows.Scan(&sev, &n); err != nil {
				return err
			}
			out.OpenAlerts[sev] = n
		}
		return rows.Err()
	})
	if err != nil {
		return out, err
	}
	if out.Current.Revenue > 0 {
		out.AvgMarginPct = utils.Round2(out.Current.Profit / out.Current.Revenue * 100)
	}
	out.RevenueChangePct = pctChange(out.Current.Revenue, out.Previous.Revenue)
	out.ProfitChangePct = pctChange(out.Current.Profit, out.Previous.Profit)
	out.UnitsChangePct = pctChange(float64(out.Current.Units), float64(out.Previous.Units))
	out.Current.Revenue, out.Current.Profit = utils.Round2(out.Current.Revenue), utils.Round2(out.Current.Profit)
	out.Previous.Revenue, out.Previous.Profit = utils.Round2(out.Previous.Revenue), utils.Round2(out.Previous.Profit)

	if inv, err := s.InventoryOverview(ctx, id, storeID); err == nil {
		for _, p := range inv.Products {
			if len(p.Statuses) > 0 {
				out.AtRiskProducts++
			}
		}
	}
	clients.SetJSON(ctx, s.Cache, key, out, 5*time.Minute)
	return out, nil
}

// competitorGap compares our price to the average of fresh, non-estimated
// competitor observations. Products without such data are excluded.
func competitorGap(ctx context.Context, q database.Querier, storeID string) (CompetitorGap, error) {
	var g CompetitorGap
	var avg *float64
	err := q.QueryRow(ctx, `
		with market as (
			select cp.product_id, avg(pr.price)::float8 as market_avg
			from competitor_products cp join competitor_prices pr on pr.competitor_product_id = cp.id
			where cp.store_id = $1 and pr.price is not null and pr.data_status in ('LIVE', 'CACHED')
			group by cp.product_id)
		select count(*)::int, avg((p.selling_price - m.market_avg) / m.market_avg * 100)::float8,
		       count(*) filter (where p.selling_price > m.market_avg)::int
		from market m join products p on p.id = m.product_id`, storeID).Scan(&g.ProductsCompared, &avg, &g.ProductsAboveMarket)
	if avg != nil {
		v := utils.Round2(*avg)
		g.AvgGapPct = &v
	}
	if g.ProductsCompared == 0 {
		g.Note = "No live or cached competitor prices available yet"
	} else {
		g.Note = "Based on observed competitor prices only (LIVE, MANUAL_VERIFIED, CACHED); estimates excluded"
	}
	return g, err
}

func (s *Service) Trend(ctx context.Context, id database.Identity, storeID, productID string, r Range) ([]repositories.TrendPoint, error) {
	key := s.cacheKey(ctx, storeID, "trend", productID, r.From.Unix(), r.To.Unix())
	var out []repositories.TrendPoint
	if clients.GetJSON(ctx, s.Cache, key, &out) {
		return out, nil
	}
	err := s.DB.WithUser(ctx, id, func(tx pgx.Tx) error {
		var err error
		out, err = repositories.DailyTrend(ctx, tx, storeID, productID, r.From, r.To)
		return err
	})
	if err == nil {
		clients.SetJSON(ctx, s.Cache, key, out, 5*time.Minute)
	}
	return out, err
}

func (s *Service) CategoryPerformance(ctx context.Context, id database.Identity, storeID string, r Range) ([]repositories.GroupPerf, error) {
	var out []repositories.GroupPerf
	err := s.DB.WithUser(ctx, id, func(tx pgx.Tx) error {
		var err error
		out, err = repositories.CategoryPerformance(ctx, tx, storeID, r.From, r.To)
		return err
	})
	return out, err
}

func (s *Service) ProductPerformance(ctx context.Context, id database.Identity, storeID string, r Range, sortBy string, desc bool, limit int) ([]repositories.GroupPerf, error) {
	var out []repositories.GroupPerf
	err := s.DB.WithUser(ctx, id, func(tx pgx.Tx) error {
		var err error
		out, err = repositories.ProductPerformance(ctx, tx, storeID, r.From, r.To, sortBy, desc, limit)
		return err
	})
	return out, err
}

// StoreComparison powers organization-level analytics: one summary row per
// store the caller can see in the organization.
type StoreComparisonRow struct {
	StoreID   string                      `json:"store_id"`
	StoreName string                      `json:"store_name"`
	DataMode  string                      `json:"data_mode"`
	Totals    repositories.Totals         `json:"totals"`
	MarginPct float64                     `json:"margin_pct"`
	Inventory repositories.InventoryValue `json:"inventory"`
}

func (s *Service) OrganizationAnalytics(ctx context.Context, id database.Identity, orgID string, days int) ([]StoreComparisonRow, error) {
	var out []StoreComparisonRow
	err := s.DB.WithUser(ctx, id, func(tx pgx.Tx) error {
		stores, err := repositories.ListOrgStores(ctx, tx, orgID)
		if err != nil {
			return err
		}
		for _, st := range stores {
			ref, mode, err := repositories.ReferenceTime(ctx, tx, st.ID)
			if err != nil {
				return err
			}
			to := ref.Truncate(24 * time.Hour).Add(24 * time.Hour)
			row := StoreComparisonRow{StoreID: st.ID, StoreName: st.Name, DataMode: mode}
			if row.Totals, err = repositories.SalesTotals(ctx, tx, st.ID, to.AddDate(0, 0, -days), to); err != nil {
				return err
			}
			if row.Inventory, err = repositories.InventoryValuation(ctx, tx, st.ID); err != nil {
				return err
			}
			if row.Totals.Revenue > 0 {
				row.MarginPct = utils.Round2(row.Totals.Profit / row.Totals.Revenue * 100)
			}
			out = append(out, row)
		}
		return nil
	})
	if out == nil {
		out = []StoreComparisonRow{}
	}
	return out, err
}
