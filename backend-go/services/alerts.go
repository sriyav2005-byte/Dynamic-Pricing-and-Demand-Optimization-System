package services

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"math"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/rishabh26raj/priceiq/backend-go/database"
	"github.com/rishabh26raj/priceiq/backend-go/models"
	"github.com/rishabh26raj/priceiq/backend-go/repositories"
	"github.com/rishabh26raj/priceiq/backend-go/utils"
)

type Alert struct {
	ID          string          `json:"id"`
	StoreID     string          `json:"store_id"`
	ProductID   *string         `json:"product_id"`
	ProductName *string         `json:"product_name"`
	Type        string          `json:"alert_type"`
	Severity    string          `json:"severity"`
	Title       string          `json:"title"`
	Message     string          `json:"message"`
	Metadata    json.RawMessage `json:"metadata"`
	Status      string          `json:"status"`
	CreatedAt   time.Time       `json:"created_at"`
	UpdatedAt   time.Time       `json:"updated_at"`
}

// candidate is an alert produced by a detector during a scan.
type candidate struct {
	ProductID *string
	Type      string
	Severity  string
	Title     string
	Message   string
	Metadata  map[string]any
	Dedupe    string
}

// ScanResult summarises one detection pass.
type ScanResult struct {
	StoreID  string         `json:"store_id"`
	Detected int            `json:"detected"`
	Created  int            `json:"created"`
	Updated  int            `json:"updated"`
	Resolved int            `json:"resolved"`
	ByType   map[string]int `json:"by_type"`
	Warnings []string       `json:"warnings"`
}

// inventoryAlerts turns inventory intelligence into alert candidates.
func inventoryAlerts(inv InventoryOverview) []candidate {
	var out []candidate
	for _, p := range inv.Products {
		pid := p.ProductID
		has := func(s string) bool {
			for _, x := range p.Statuses {
				if x == s {
					return true
				}
			}
			return false
		}
		meta := map[string]any{"stock": p.Stock, "avg_daily_units": p.AvgDailyUnits, "days_of_cover": p.DaysOfCover,
			"reorder_qty": p.ReorderQty, "data_sufficiency": p.DataSufficiency}
		if has("OUT_OF_STOCK") {
			out = append(out, candidate{&pid, "LOW_STOCK", "CRITICAL", p.Name + " is out of stock",
				fmt.Sprintf("No units left. Recommended reorder: %d units.", p.ReorderQty), meta, "LOW_STOCK:" + pid})
		} else if has("LOW_STOCK") {
			sev := "MEDIUM"
			if p.DaysOfCover != nil && *p.DaysOfCover < 1 {
				sev = "HIGH"
			}
			out = append(out, candidate{&pid, "LOW_STOCK", sev, fmt.Sprintf("%s is low on stock (%d units)", p.Name, p.Stock),
				coverMsg(p) + fmt.Sprintf(" Recommended reorder: %d units.", p.ReorderQty), meta, "LOW_STOCK:" + pid})
		}
		if has("PREDICTED_STOCKOUT") {
			out = append(out, candidate{&pid, "PREDICTED_STOCKOUT", "HIGH", p.Name + " may stock out before a reorder can arrive",
				fmt.Sprintf("%s Supplier lead time is %d days; predicted stockout %s.", coverMsg(p), p.LeadTimeDays, deref(p.PredictedStockout, "soon")),
				meta, "PREDICTED_STOCKOUT:" + pid})
		}
		if has("OVERSTOCK") {
			out = append(out, candidate{&pid, "OVERSTOCK", "LOW", p.Name + " is overstocked", coverMsg(p) + " Consider a promotion or pausing reorders.",
				meta, "OVERSTOCK:" + pid})
		}
		if has("DEAD_STOCK") {
			last := "never"
			if p.LastSoldAt != nil {
				last = p.LastSoldAt.Format("2 Jan 2006")
			}
			out = append(out, candidate{&pid, "DEAD_STOCK", "MEDIUM", p.Name + " has not sold recently",
				fmt.Sprintf("%d units in stock (₹%.0f at cost); last sale: %s.", p.Stock, p.ValueAtCost, last), meta, "DEAD_STOCK:" + pid})
		}
		if p.ExpiryRisk != "NONE" && p.ExpiryRisk != "LOW" {
			sev := map[string]string{"EXPIRED": "CRITICAL", "CRITICAL": "CRITICAL", "HIGH": "HIGH", "MEDIUM": "MEDIUM"}[p.ExpiryRisk]
			units := 0
			if p.UnitsAtExpiryRisk != nil {
				units = *p.UnitsAtExpiryRisk
			}
			title := fmt.Sprintf("%s expires in %d day(s)", p.Name, deref(p.DaysToExpiry, 0))
			if p.ExpiryRisk == "EXPIRED" {
				title = p.Name + " has expired stock"
			}
			meta["units_at_risk"] = units
			meta["days_to_expiry"] = p.DaysToExpiry
			out = append(out, candidate{&pid, "EXPIRY", sev, title,
				fmt.Sprintf("%d of %d units are not expected to sell before expiry at the current sales rate (₹%.0f at cost).",
					units, p.Stock, float64(units)*p.CostPrice), meta, "EXPIRY:" + pid})
		}
	}
	return out
}

func coverMsg(p ProductInventory) string {
	if p.DaysOfCover == nil {
		return "No recent sales to estimate days of cover."
	}
	return fmt.Sprintf("About %.1f days of cover at %.1f units/day.", *p.DaysOfCover, p.AvgDailyUnits)
}

// competitorAlerts: undercuts (fresh observations only) and sharp price moves.
func competitorAlerts(ctx context.Context, q database.Querier, storeID string, undercutPct float64) ([]candidate, error) {
	var out []candidate
	rows, err := q.Query(ctx, `
		select p.id, p.name, p.selling_price::float8, k.key, k.name, pr.price::float8, pr.observed_at
		from competitor_prices pr
		join competitor_products cp on cp.id = pr.competitor_product_id
		join competitors k on k.id = cp.competitor_id
		join products p on p.id = cp.product_id
		where pr.store_id = $1 and pr.price is not null and pr.data_status = 'LIVE'
		  and pr.observed_at > now() - interval '48 hours'
		  and pr.price < p.selling_price * (1 - $2::float8)`, storeID, undercutPct)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var pid, pname, key, kname string
		var ours, theirs float64
		var at time.Time
		if err := rows.Scan(&pid, &pname, &ours, &key, &kname, &theirs, &at); err != nil {
			rows.Close()
			return nil, err
		}
		gap := (ours - theirs) / ours * 100
		sev := "MEDIUM"
		if gap > 2*undercutPct*100 {
			sev = "HIGH"
		}
		p := pid
		out = append(out, candidate{&p, "COMPETITOR_UNDERCUT", sev, fmt.Sprintf("%s undercuts %s by %.1f%%", kname, pname, gap),
			fmt.Sprintf("%s: ₹%.2f vs our ₹%.2f (observed %s).", kname, theirs, ours, at.Format("2 Jan 15:04")),
			map[string]any{"competitor": key, "competitor_price": theirs, "our_price": ours, "gap_pct": utils.Round2(gap)},
			"COMPETITOR_UNDERCUT:" + pid + ":" + key})
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	rows, err = q.Query(ctx, `
		with ranked as (
			select cp.product_id, k.key, k.name, h.price::float8 price, h.observed_at,
			       row_number() over (partition by h.competitor_product_id order by h.observed_at desc) rn
			from competitor_price_history h
			join competitor_products cp on cp.id = h.competitor_product_id
			join competitors k on k.id = cp.competitor_id
			where h.store_id = $1 and h.source <> 'ESTIMATE' and h.observed_at > now() - interval '7 days')
		select a.product_id, p.name, a.key, a.name, b.price, a.price
		from ranked a join ranked b on a.product_id = b.product_id and a.key = b.key and b.rn = 2
		join products p on p.id = a.product_id
		where a.rn = 1 and a.observed_at > now() - interval '24 hours'
		  and abs(a.price - b.price) / b.price >= 0.05`, storeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var pid, pname, key, kname string
		var before, after float64
		if err := rows.Scan(&pid, &pname, &key, &kname, &before, &after); err != nil {
			return nil, err
		}
		p := pid
		chg := (after - before) / before * 100
		out = append(out, candidate{&p, "COMPETITOR_PRICE_CHANGE", "LOW", fmt.Sprintf("%s changed %s price by %+.1f%%", kname, pname, chg),
			fmt.Sprintf("₹%.2f → ₹%.2f", before, after),
			map[string]any{"competitor": key, "before": before, "after": after, "change_pct": utils.Round2(chg)},
			"COMPETITOR_PRICE_CHANGE:" + pid + ":" + key})
	}
	return out, rows.Err()
}

// demandAlerts compares the last 7 days with the previous 28 days using a
// z-test on the 7-day total. Requires ≥14 selling days in the 35-day window.
func demandAlerts(ctx context.Context, q database.Querier, storeID string) ([]candidate, error) {
	rows, err := q.Query(ctx, `
		with ref as (select app.store_reference_time($1) t),
		days as (
			select s.product_id, date_trunc('day', s.sold_at) d, sum(s.quantity)::float8 q
			from sales s, ref
			where s.store_id = $1 and s.sold_at > ref.t - interval '35 days' and s.sold_at <= ref.t
			group by 1, 2),
		agg as (
			select d.product_id,
			       coalesce(sum(q) filter (where d.d > (select t from ref) - interval '7 days'), 0) recent7,
			       coalesce(sum(q) filter (where d.d <= (select t from ref) - interval '7 days'), 0) base_units,
			       coalesce(sum(q*q) filter (where d.d <= (select t from ref) - interval '7 days'), 0) base_sumsq,
			       count(*) days_with_sales
			from days d group by 1)
		select a.product_id, p.name, a.recent7, a.base_units / 28.0 base_mean,
		       sqrt(greatest(a.base_sumsq / 28.0 - power(a.base_units / 28.0, 2), 0)) base_std
		from agg a join products p on p.id = a.product_id
		where a.days_with_sales >= 14 and p.is_active`, storeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []candidate
	for rows.Next() {
		var pid, name string
		var recent, mean, std float64
		if err := rows.Scan(&pid, &name, &recent, &mean, &std); err != nil {
			return nil, err
		}
		if mean <= 0 {
			continue
		}
		expected := mean * 7
		sd7 := math.Max(std*math.Sqrt(7), 1)
		z := (recent - expected) / sd7
		ratio := recent / expected
		p := pid
		meta := map[string]any{"last_7_days": recent, "expected_7_days": utils.Round2(expected), "z_score": utils.Round2(z), "ratio": utils.Round2(ratio)}
		switch {
		case z >= 2.5 && ratio >= 1.3:
			out = append(out, candidate{&p, "DEMAND_SPIKE", "MEDIUM", fmt.Sprintf("Demand spike for %s (+%.0f%%)", name, (ratio-1)*100),
				fmt.Sprintf("%.0f units in the last 7 days vs %.0f expected (z = %.1f). Check stock and pricing headroom.", recent, expected, z), meta, "DEMAND_SPIKE:" + pid})
		case z <= -2.5 && ratio <= 0.7:
			out = append(out, candidate{&p, "DEMAND_DROP", "MEDIUM", fmt.Sprintf("Demand drop for %s (%.0f%%)", name, (ratio-1)*100),
				fmt.Sprintf("%.0f units in the last 7 days vs %.0f expected (z = %.1f). Check competitor prices and availability.", recent, expected, z), meta, "DEMAND_DROP:" + pid})
		}
	}
	return out, rows.Err()
}

// opportunityAlerts surfaces pending recommendations with material profit uplift.
func opportunityAlerts(ctx context.Context, q database.Querier, storeID string) ([]candidate, error) {
	rows, err := q.Query(ctx, `
		select r.id, r.product_id, p.name, r.current_price::float8, r.recommended_price::float8,
		       (r.explanation -> 'impact' ->> 'profit_change_pct')::float8
		from pricing_recommendations r join products p on p.id = r.product_id
		where r.store_id = $1 and r.status = 'PENDING'
		  and (r.explanation -> 'impact' ->> 'profit_change_pct') is not null
		  and (r.explanation -> 'impact' ->> 'profit_change_pct')::float8 >= 5`, storeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []candidate
	for rows.Next() {
		var rid, pid, name string
		var cur, rec, uplift float64
		if err := rows.Scan(&rid, &pid, &name, &cur, &rec, &uplift); err != nil {
			return nil, err
		}
		p := pid
		sev := "LOW"
		if uplift >= 15 {
			sev = "MEDIUM"
		}
		out = append(out, candidate{&p, "PRICING_OPPORTUNITY", sev, fmt.Sprintf("Pricing opportunity: %s (+%.0f%% expected profit)", name, uplift),
			fmt.Sprintf("Recommended ₹%.2f vs current ₹%.2f. Review the recommendation.", rec, cur),
			map[string]any{"recommendation_id": rid, "profit_change_pct": uplift}, "PRICING_OPPORTUNITY:" + pid})
	}
	return out, rows.Err()
}

// anomalyAlerts asks the AI service for statistically unusual events.
func (s *Service) anomalyAlerts(ctx context.Context, storeID string) ([]candidate, error) {
	var resp struct {
		Anomalies []struct {
			ProductID *string        `json:"product_id"`
			Kind      string         `json:"kind"`
			Title     string         `json:"title"`
			Message   string         `json:"message"`
			Severity  string         `json:"severity"`
			Key       string         `json:"key"`
			Metadata  map[string]any `json:"metadata"`
		} `json:"anomalies"`
	}
	if err := s.AI.Post(ctx, "/v1/anomalies/detect", map[string]any{"store_id": storeID}, &resp, ""); err != nil {
		return nil, err
	}
	var out []candidate
	for _, a := range resp.Anomalies {
		sev := strings.ToUpper(a.Severity)
		if sev != "LOW" && sev != "MEDIUM" && sev != "HIGH" && sev != "CRITICAL" {
			sev = "MEDIUM"
		}
		out = append(out, candidate{a.ProductID, "ANOMALY", sev, a.Title, a.Message, a.Metadata, "ANOMALY:" + a.Key})
	}
	return out, nil
}

// ScanStore runs every detector for a store (system context), upserts alerts,
// resolves alerts whose condition cleared and notifies managers of new
// HIGH/CRITICAL alerts.
func (s *Service) ScanStore(ctx context.Context, storeID string) (ScanResult, error) {
	res := ScanResult{StoreID: storeID, ByType: map[string]int{}, Warnings: []string{}}
	inv, err := s.inventoryOverview(ctx, s.systemRunner(ctx), storeID)
	if err != nil {
		return res, err
	}
	cands := inventoryAlerts(inv)
	scannedTypes := []string{"LOW_STOCK", "PREDICTED_STOCKOUT", "OVERSTOCK", "DEAD_STOCK", "EXPIRY",
		"COMPETITOR_UNDERCUT", "COMPETITOR_PRICE_CHANGE", "DEMAND_SPIKE", "DEMAND_DROP", "PRICING_OPPORTUNITY"}

	err = s.DB.WithSystem(ctx, func(tx pgx.Tx) error {
		st, err := repositories.GetSettings(ctx, tx, storeID)
		if err != nil {
			return err
		}
		for _, detect := range []func() ([]candidate, error){
			func() ([]candidate, error) { return competitorAlerts(ctx, tx, storeID, st.CompetitorUndercutPct) },
			func() ([]candidate, error) { return demandAlerts(ctx, tx, storeID) },
			func() ([]candidate, error) { return opportunityAlerts(ctx, tx, storeID) },
		} {
			c, err := detect()
			if err != nil {
				return err
			}
			cands = append(cands, c...)
		}
		return nil
	})
	if err != nil {
		return res, err
	}
	actx, cancel := context.WithTimeout(ctx, 60*time.Second)
	if an, err := s.anomalyAlerts(actx, storeID); err != nil {
		res.Warnings = append(res.Warnings, "anomaly detection skipped: "+err.Error())
	} else {
		cands = append(cands, an...)
		scannedTypes = append(scannedTypes, "ANOMALY")
	}
	cancel()

	var newAlerts []string
	err = s.DB.WithSystem(ctx, func(tx pgx.Tx) error {
		keys := make([]string, 0, len(cands))
		for _, c := range cands {
			res.Detected++
			res.ByType[c.Type]++
			keys = append(keys, c.Dedupe)
			meta, _ := json.Marshal(c.Metadata)
			var id string
			var inserted bool
			err := tx.QueryRow(ctx, `insert into alerts(store_id, product_id, alert_type, severity, title, message, metadata, dedupe_key)
				values ($1,$2,$3,$4::alert_severity,$5,$6,$7,$8)
				on conflict (store_id, dedupe_key) where status <> 'RESOLVED'
				do update set severity=excluded.severity, title=excluded.title, message=excluded.message, metadata=excluded.metadata
				returning id, (xmax = 0)`, storeID, c.ProductID, c.Type, c.Severity, c.Title, c.Message, meta, c.Dedupe).Scan(&id, &inserted)
			if err != nil {
				return fmt.Errorf("upsert alert %s: %w", c.Dedupe, err)
			}
			if inserted {
				res.Created++
				if c.Severity == "HIGH" || c.Severity == "CRITICAL" {
					newAlerts = append(newAlerts, id)
				}
			} else {
				res.Updated++
			}
		}
		tag, err := tx.Exec(ctx, `update alerts set status='RESOLVED', resolved_at=now()
			where store_id=$1 and status <> 'RESOLVED' and alert_type = any($2) and not (dedupe_key = any($3))`,
			storeID, scannedTypes, keys)
		if err != nil {
			return err
		}
		res.Resolved = int(tag.RowsAffected())
		if len(newAlerts) == 0 {
			return nil
		}
		// In-app notifications for store managers and above.
		_, err = tx.Exec(ctx, `
			insert into notifications(user_id, store_id, alert_id, title, body, link)
			select distinct m.user_id, a.store_id, a.id, a.title, a.message, '/alerts?id=' || a.id
			from alerts a
			join stores s on s.id = a.store_id
			join memberships m on m.organization_id = s.organization_id and (m.store_id is null or m.store_id = s.id)
			where a.id = any($1) and m.role >= 'STORE_MANAGER'
			on conflict (user_id, alert_id) do nothing`, newAlerts)
		return err
	})
	if err == nil && len(newAlerts) > 0 {
		go s.emailAlerts(newAlerts)
	}
	return res, err
}

// ── Alert & notification API ────────────────────────────────────────────────

func (s *Service) ListAlerts(ctx context.Context, id database.Identity, storeID, status, severity, alertType string, limit, offset int) (models.Page[Alert], error) {
	page := models.Page[Alert]{Data: []Alert{}}
	err := s.DB.WithUser(ctx, id, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `select a.id, a.store_id, a.product_id, p.name, a.alert_type, a.severity::text, a.title, a.message,
				a.metadata, a.status, a.created_at, a.updated_at, count(*) over ()
			from alerts a left join products p on p.id = a.product_id
			where a.store_id=$1
			  and (case when $2 = '' then a.status <> 'RESOLVED' when $2 = 'ALL' then true else a.status = $2 end)
			  and ($3 = '' or a.severity::text = $3) and ($4 = '' or a.alert_type = $4)
			order by case a.severity when 'CRITICAL' then 0 when 'HIGH' then 1 when 'MEDIUM' then 2 else 3 end, a.created_at desc
			limit $5 offset $6`, storeID, status, severity, alertType, limit, offset)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var a Alert
			if err := rows.Scan(&a.ID, &a.StoreID, &a.ProductID, &a.ProductName, &a.Type, &a.Severity, &a.Title, &a.Message,
				&a.Metadata, &a.Status, &a.CreatedAt, &a.UpdatedAt, &page.Total); err != nil {
				return err
			}
			page.Data = append(page.Data, a)
		}
		return rows.Err()
	})
	return page, err
}

func (s *Service) UpdateAlertStatus(ctx context.Context, id database.Identity, storeID, alertID, status string) error {
	if status != "ACKNOWLEDGED" && status != "RESOLVED" && status != "OPEN" {
		return utils.Unprocessable("Invalid status", map[string]string{"status": "must be OPEN, ACKNOWLEDGED or RESOLVED"})
	}
	return s.DB.WithUser(ctx, id, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `update alerts set status=$3, resolved_at = case when $3='RESOLVED' then now() else null end
			where store_id=$1 and id=$2`, storeID, alertID, status)
		if err == nil && tag.RowsAffected() == 0 {
			return utils.NotFound("Alert")
		}
		return err
	})
}

type Notification struct {
	ID        string     `json:"id"`
	StoreID   *string    `json:"store_id"`
	AlertID   *string    `json:"alert_id"`
	Title     string     `json:"title"`
	Body      string     `json:"body"`
	Link      *string    `json:"link"`
	ReadAt    *time.Time `json:"read_at"`
	CreatedAt time.Time  `json:"created_at"`
}

func (s *Service) ListNotifications(ctx context.Context, id database.Identity, unreadOnly bool, limit int) (map[string]any, error) {
	items := []Notification{}
	var unread int
	err := s.DB.WithUser(ctx, id, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, "select count(*) from notifications where user_id=$1 and read_at is null", id.UserID).Scan(&unread); err != nil {
			return err
		}
		rows, err := tx.Query(ctx, `select id, store_id, alert_id, title, body, link, read_at, created_at from notifications
			where user_id=$1 and (not $2 or read_at is null) order by created_at desc limit $3`, id.UserID, unreadOnly, limit)
		if err != nil {
			return err
		}
		items, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (Notification, error) {
			var n Notification
			return n, r.Scan(&n.ID, &n.StoreID, &n.AlertID, &n.Title, &n.Body, &n.Link, &n.ReadAt, &n.CreatedAt)
		})
		return err
	})
	return map[string]any{"unread": unread, "items": items}, err
}

func (s *Service) MarkNotificationsRead(ctx context.Context, id database.Identity, notificationID string) error {
	return s.DB.WithUser(ctx, id, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `update notifications set read_at=now()
			where user_id=$1 and read_at is null and ($2 = '' or id::text = $2)`, id.UserID, notificationID)
		return err
	})
}

// emailAlerts sends HIGH/CRITICAL alerts by e-mail when SMTP is configured.
func (s *Service) emailAlerts(alertIDs []string) {
	if s.Mailer == nil || !s.Mailer.Enabled() {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	rows, err := s.DB.Pool.Query(ctx, `
		select distinct p.email, a.title, a.message, st.name
		from alerts a join stores st on st.id = a.store_id
		join memberships m on m.organization_id = st.organization_id and (m.store_id is null or m.store_id = st.id)
		join profiles p on p.id = m.user_id
		where a.id = any($1) and m.role >= 'STORE_MANAGER' and p.email is not null`, alertIDs)
	if err != nil {
		slog.Warn("alert email query failed", "err", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var to, title, msg, store string
		if err := rows.Scan(&to, &title, &msg, &store); err != nil {
			return
		}
		if err := s.Mailer.Send(to, "[PriceIQ] "+store+": "+title, msg); err != nil {
			slog.Warn("alert email failed", "to", to, "err", err)
		}
	}
}
