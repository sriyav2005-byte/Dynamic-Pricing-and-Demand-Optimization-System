package services

import (
	"context"
	"math"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/rishabh26raj/priceiq/backend-go/clients"
	"github.com/rishabh26raj/priceiq/backend-go/database"
	"github.com/rishabh26raj/priceiq/backend-go/utils"
)

// Competitor data labels (never mixed up — see PROJECT_CONTEXT.md "Data honesty"):
//
//	LIVE             read from the platform by the scraper within LiveTTL
//	MANUAL_VERIFIED  a price a staff member looked up and recorded, within ManualTTL
//	CACHED           any real observation older than its TTL (still real, maybe stale)
//	ESTIMATED        modelled value — never produced by PriceIQ, kept for imports
//	UNAVAILABLE      the platform could not be read and nothing was recorded
//
// The database stores what happened (data_status + source + observed_at); the
// label shown to users is derived from those at read time, so an observation
// ages from LIVE/MANUAL_VERIFIED into CACHED without any background job.
const (
	LiveTTL   = 6 * time.Hour
	ManualTTL = 24 * time.Hour
)

// isObserved reports whether a display status is a real observation that may
// be used in market statistics.
func isObserved(status string) bool {
	return status == "LIVE" || status == "CACHED" || status == "MANUAL_VERIFIED"
}

type Platform struct {
	ID      string  `json:"id"`
	Key     string  `json:"key"`
	Name    string  `json:"name"`
	Website *string `json:"website"`
	Color   *string `json:"color"`
}

// CompetitorObservation is one platform's price for a product.
type CompetitorObservation struct {
	CompetitorKey  string     `json:"competitor_key"`
	CompetitorName string     `json:"competitor_name"`
	Color          *string    `json:"color"`
	Linked         bool       `json:"linked"`
	ExternalName   *string    `json:"external_name"`
	URL            *string    `json:"url"`
	PackSize       *string    `json:"pack_size"`
	Price          *float64   `json:"price"`
	MRP            *float64   `json:"mrp"`
	DiscountPct    *float64   `json:"discount_pct"`
	InStock        *bool      `json:"in_stock"`
	Status         string     `json:"status"` // LIVE | MANUAL_VERIFIED | CACHED | ESTIMATED | UNAVAILABLE
	Source         *string    `json:"source"`
	ObservedAt     *time.Time `json:"observed_at"`
	AgeMinutes     *int       `json:"age_minutes"`
	DiffPct        *float64   `json:"diff_pct"` // (competitor − ours) / ours
	Error          *string    `json:"error"`
}

type MarketStats struct {
	OurPrice       float64  `json:"our_price"`
	ObservedCount  int      `json:"observed_count"` // LIVE + MANUAL_VERIFIED + CACHED only
	Lowest         *float64 `json:"lowest"`
	Highest        *float64 `json:"highest"`
	Average        *float64 `json:"average"`
	LowestPlatform *string  `json:"lowest_platform"`
	DiffVsAvg      *float64 `json:"diff_vs_avg"`
	DiffVsAvgPct   *float64 `json:"diff_vs_avg_pct"`
	Position       string   `json:"position"` // cheapest | below_average | above_average | most_expensive | unknown
	Note           string   `json:"note"`
}

type ProductCompetitors struct {
	ProductID    string                  `json:"product_id"`
	ProductName  string                  `json:"product_name"`
	Category     *string                 `json:"category"`
	Observations []CompetitorObservation `json:"observations"`
	Market       MarketStats             `json:"market"`
}

func displayStatus(stored, source *string, observed *time.Time, now time.Time) string {
	if stored == nil {
		return "UNAVAILABLE"
	}
	switch *stored {
	case "ESTIMATED", "UNAVAILABLE":
		return *stored
	}
	manual := source != nil && *source == "MANUAL"
	ttl := LiveTTL
	if manual {
		ttl = ManualTTL
	}
	if observed != nil && now.Sub(*observed) > ttl {
		return "CACHED"
	}
	if manual {
		return "MANUAL_VERIFIED"
	}
	return "LIVE"
}

// MarketFrom computes market stats from real observations only (LIVE,
// MANUAL_VERIFIED, CACHED) — ESTIMATED values never influence market figures.
func MarketFrom(our float64, obs []CompetitorObservation) MarketStats {
	m := MarketStats{OurPrice: our, Position: "unknown"}
	var prices []float64
	for i := range obs {
		o := &obs[i]
		if o.Price != nil && our > 0 {
			d := utils.Round2((*o.Price - our) / our * 100)
			o.DiffPct = &d
		}
		if o.Price == nil || !isObserved(o.Status) {
			continue
		}
		prices = append(prices, *o.Price)
		if m.Lowest == nil || *o.Price < *m.Lowest {
			m.Lowest, m.LowestPlatform = ptr(*o.Price), ptr(o.CompetitorName)
		}
		if m.Highest == nil || *o.Price > *m.Highest {
			m.Highest = ptr(*o.Price)
		}
	}
	m.ObservedCount = len(prices)
	if len(prices) == 0 {
		m.Note = "No live, manually verified or cached competitor prices — market figures unavailable"
		return m
	}
	sum := 0.0
	for _, p := range prices {
		sum += p
	}
	avg := utils.Round2(sum / float64(len(prices)))
	m.Average = &avg
	m.DiffVsAvg = ptr(utils.Round2(our - avg))
	m.DiffVsAvgPct = ptr(utils.Round2((our - avg) / avg * 100))
	switch {
	case our <= *m.Lowest:
		m.Position = "cheapest"
	case our >= *m.Highest:
		m.Position = "most_expensive"
	case our <= avg:
		m.Position = "below_average"
	default:
		m.Position = "above_average"
	}
	m.Note = "Computed from LIVE, MANUAL_VERIFIED and CACHED observations only"
	return m
}

func (s *Service) Platforms(ctx context.Context, id database.Identity) ([]Platform, error) {
	var out []Platform
	err := s.DB.WithUser(ctx, id, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, "select id, key, name, website, color from competitors where is_active order by name")
		if err != nil {
			return err
		}
		out, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (Platform, error) {
			var p Platform
			return p, r.Scan(&p.ID, &p.Key, &p.Name, &p.Website, &p.Color)
		})
		return err
	})
	return out, err
}

// competitorRows loads (product × platform) observations for one or all products.
func competitorRows(ctx context.Context, q database.Querier, storeID, productID string) (map[string]*ProductCompetitors, []string, error) {
	rows, err := q.Query(ctx, `
		select p.id, p.name, c.name, p.selling_price::float8, k.key, k.name, k.color,
		       cp.id is not null, cp.external_name, cp.url, cp.pack_size,
		       pr.price::float8, pr.mrp::float8, pr.discount_pct, pr.in_stock, pr.data_status::text, pr.source, pr.observed_at, pr.error
		from products p
		left join categories c on c.id = p.category_id
		cross join competitors k
		left join competitor_products cp on cp.product_id = p.id and cp.competitor_id = k.id
		left join competitor_prices pr on pr.competitor_product_id = cp.id
		where p.store_id = $1 and p.is_active and k.is_active and ($2 = '' or p.id::text = $2)
		order by lower(p.name), k.name`, storeID, productID)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	now := time.Now()
	byID := map[string]*ProductCompetitors{}
	var order []string
	for rows.Next() {
		var pid, pname string
		var cat *string
		var our float64
		var o CompetitorObservation
		var stored *string
		if err := rows.Scan(&pid, &pname, &cat, &our, &o.CompetitorKey, &o.CompetitorName, &o.Color, &o.Linked,
			&o.ExternalName, &o.URL, &o.PackSize, &o.Price, &o.MRP, &o.DiscountPct, &o.InStock, &stored, &o.Source,
			&o.ObservedAt, &o.Error); err != nil {
			return nil, nil, err
		}
		o.Status = displayStatus(stored, o.Source, o.ObservedAt, now)
		if o.ObservedAt != nil {
			o.AgeMinutes = ptr(int(now.Sub(*o.ObservedAt).Minutes()))
		}
		pc := byID[pid]
		if pc == nil {
			pc = &ProductCompetitors{ProductID: pid, ProductName: pname, Category: cat, Market: MarketStats{OurPrice: our}}
			byID[pid] = pc
			order = append(order, pid)
		}
		pc.Observations = append(pc.Observations, o)
	}
	for _, pc := range byID {
		pc.Market = MarketFrom(pc.Market.OurPrice, pc.Observations)
	}
	return byID, order, rows.Err()
}

func (s *Service) ProductCompetitors(ctx context.Context, id database.Identity, storeID, productID string) (ProductCompetitors, error) {
	var out ProductCompetitors
	err := s.DB.WithUser(ctx, id, func(tx pgx.Tx) error {
		m, _, err := competitorRows(ctx, tx, storeID, productID)
		if err != nil {
			return err
		}
		pc, ok := m[productID]
		if !ok {
			return utils.NotFound("Product")
		}
		out = *pc
		return nil
	})
	return out, err
}

type CompetitorOverview struct {
	Products            []ProductCompetitors `json:"products"`
	StatusCounts        map[string]int       `json:"status_counts"`
	ProductsWithData    int                  `json:"products_with_market_data"`
	ProductsAboveMarket int                  `json:"products_above_market"`
	AvgGapPct           *float64             `json:"avg_gap_pct"`
}

func (s *Service) CompetitorOverview(ctx context.Context, id database.Identity, storeID string) (CompetitorOverview, error) {
	out := CompetitorOverview{StatusCounts: map[string]int{}, Products: []ProductCompetitors{}}
	err := s.DB.WithUser(ctx, id, func(tx pgx.Tx) error {
		m, order, err := competitorRows(ctx, tx, storeID, "")
		if err != nil {
			return err
		}
		var gaps []float64
		for _, pid := range order {
			pc := m[pid]
			out.Products = append(out.Products, *pc)
			for _, o := range pc.Observations {
				out.StatusCounts[o.Status]++
			}
			if pc.Market.DiffVsAvgPct != nil {
				out.ProductsWithData++
				gaps = append(gaps, *pc.Market.DiffVsAvgPct)
				if *pc.Market.DiffVsAvgPct > 0 {
					out.ProductsAboveMarket++
				}
			}
		}
		if len(gaps) > 0 {
			sum := 0.0
			for _, g := range gaps {
				sum += g
			}
			out.AvgGapPct = ptr(utils.Round2(sum / float64(len(gaps))))
		}
		return nil
	})
	return out, err
}

// ── History ─────────────────────────────────────────────────────────────────

type HistoryPoint struct {
	Time   time.Time          `json:"time"`
	Ours   *float64           `json:"ours"`
	Prices map[string]float64 `json:"prices"` // competitor key → price
	Avg    *float64           `json:"market_avg"`
	Low    *float64           `json:"market_low"`
}

type CompetitorHistory struct {
	Range         string             `json:"range"`
	Sufficient    bool               `json:"sufficient_data"`
	Message       string             `json:"message,omitempty"`
	Observations  int                `json:"observations"`
	Points        []HistoryPoint     `json:"points"`
	VolatilityPct map[string]float64 `json:"volatility_pct"` // coefficient of variation per competitor
	Competitors   []string           `json:"competitors"`
}

var historyRanges = map[string]struct {
	span   time.Duration
	bucket string
}{
	"24h": {24 * time.Hour, "hour"},
	"7d":  {7 * 24 * time.Hour, "day"},
	"30d": {30 * 24 * time.Hour, "day"},
	"90d": {90 * 24 * time.Hour, "day"},
}

// CompetitorHistory buckets our price and every competitor's observations.
// A range is only reported as sufficient when at least two buckets contain
// competitor observations.
func (s *Service) CompetitorHistory(ctx context.Context, id database.Identity, storeID, productID, rng string) (CompetitorHistory, error) {
	cfg, ok := historyRanges[rng]
	if !ok {
		return CompetitorHistory{}, utils.BadRequest("range must be one of 24h, 7d, 30d, 90d")
	}
	out := CompetitorHistory{Range: rng, Points: []HistoryPoint{}, VolatilityPct: map[string]float64{}, Competitors: []string{}}
	since := time.Now().Add(-cfg.span)
	err := s.DB.WithUser(ctx, id, func(tx pgx.Tx) error {
		if _, err := repositoriesGetProductID(ctx, tx, storeID, productID); err != nil {
			return err
		}
		rows, err := tx.Query(ctx, `
			select date_trunc($3, h.observed_at) b, k.key, avg(h.price)::float8
			from competitor_price_history h
			join competitor_products cp on cp.id = h.competitor_product_id
			join competitors k on k.id = cp.competitor_id
			where h.store_id=$1 and cp.product_id=$2 and h.observed_at >= $4 and h.source <> 'ESTIMATE'
			group by 1, 2 order by 1`, storeID, productID, cfg.bucket, since)
		if err != nil {
			return err
		}
		buckets := map[time.Time]*HistoryPoint{}
		series := map[string][]float64{}
		for rows.Next() {
			var b time.Time
			var key string
			var price float64
			if err := rows.Scan(&b, &key, &price); err != nil {
				rows.Close()
				return err
			}
			out.Observations++
			hp := buckets[b]
			if hp == nil {
				hp = &HistoryPoint{Time: b, Prices: map[string]float64{}}
				buckets[b] = hp
			}
			hp.Prices[key] = utils.Round2(price)
			series[key] = append(series[key], price)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		// Our price at each bucket = latest price change at or before it.
		var hist []struct {
			t time.Time
			p float64
		}
		hrows, err := tx.Query(ctx, `select created_at, new_price::float8 from pricing_history
			where store_id=$1 and product_id=$2 order by created_at`, storeID, productID)
		if err != nil {
			return err
		}
		for hrows.Next() {
			var h struct {
				t time.Time
				p float64
			}
			if err := hrows.Scan(&h.t, &h.p); err != nil {
				hrows.Close()
				return err
			}
			hist = append(hist, h)
		}
		hrows.Close()
		for _, hp := range buckets {
			for _, h := range hist {
				if !h.t.After(hp.Time.Add(time.Hour)) {
					p := h.p
					hp.Ours = &p
				}
			}
			vals := make([]float64, 0, len(hp.Prices))
			for _, v := range hp.Prices {
				vals = append(vals, v)
			}
			sort.Float64s(vals)
			sum := 0.0
			for _, v := range vals {
				sum += v
			}
			hp.Avg = ptr(utils.Round2(sum / float64(len(vals))))
			hp.Low = ptr(vals[0])
			out.Points = append(out.Points, *hp)
		}
		sort.Slice(out.Points, func(i, j int) bool { return out.Points[i].Time.Before(out.Points[j].Time) })
		for key, vals := range series {
			out.Competitors = append(out.Competitors, key)
			if len(vals) >= 2 {
				mean, sd := meanStd(vals)
				if mean > 0 {
					out.VolatilityPct[key] = utils.Round2(sd / mean * 100)
				}
			}
		}
		sort.Strings(out.Competitors)
		return nil
	})
	out.Sufficient = len(out.Points) >= 2
	if !out.Sufficient {
		out.Message = "Not enough competitor observations in this range to draw a history. Refresh competitor prices or record observations over time."
	}
	return out, err
}

func repositoriesGetProductID(ctx context.Context, q database.Querier, storeID, productID string) (string, error) {
	var id string
	err := q.QueryRow(ctx, "select id from products where store_id=$1 and id=$2", storeID, productID).Scan(&id)
	if database.IsNotFound(err) {
		return "", utils.NotFound("Product")
	}
	return id, err
}

func meanStd(v []float64) (float64, float64) {
	if len(v) == 0 {
		return 0, 0
	}
	sum := 0.0
	for _, x := range v {
		sum += x
	}
	mean := sum / float64(len(v))
	ss := 0.0
	for _, x := range v {
		ss += (x - mean) * (x - mean)
	}
	if len(v) < 2 {
		return mean, 0
	}
	return mean, math.Sqrt(ss / float64(len(v)-1))
}

// ── Manual observations & linking ───────────────────────────────────────────

type ManualObservation struct {
	CompetitorKey string   `json:"competitor_key" binding:"required"`
	Price         float64  `json:"price" binding:"required,gt=0"`
	MRP           *float64 `json:"mrp" binding:"omitempty,gt=0"`
	InStock       *bool    `json:"in_stock"`
	ExternalName  *string  `json:"external_name"`
	URL           *string  `json:"url"`
	PackSize      *string  `json:"pack_size"`
}

func validHTTPURL(raw string) bool {
	u, err := url.Parse(raw)
	return err == nil && (u.Scheme == "http" || u.Scheme == "https") && u.Host != ""
}

// RecordManualObservation stores a price a staff member verified themselves
// (the fallback for platforms that block automated reading). It is shown as
// MANUAL_VERIFIED for ManualTTL and as CACHED afterwards.
func (s *Service) RecordManualObservation(ctx context.Context, id database.Identity, storeID, productID string, in ManualObservation) (ProductCompetitors, error) {
	if in.MRP != nil && in.Price > *in.MRP {
		return ProductCompetitors{}, utils.Unprocessable("Invalid competitor data", map[string]string{"price": "cannot exceed the competitor MRP"})
	}
	if in.URL != nil && *in.URL != "" && !validHTTPURL(*in.URL) {
		return ProductCompetitors{}, utils.Unprocessable("Invalid competitor data", map[string]string{"url": "must be an http(s) URL"})
	}
	err := s.userTx(ctx, id, "manual competitor observation", func(tx pgx.Tx) error {
		cpID, err := ensureCompetitorProduct(ctx, tx, storeID, productID, in.CompetitorKey, in.ExternalName, in.URL, in.PackSize)
		if err != nil {
			return err
		}
		var disc *float64
		if in.MRP != nil {
			disc = ptr(utils.Round2((1 - in.Price / *in.MRP) * 100))
		}
		if _, err := tx.Exec(ctx, `insert into competitor_prices(competitor_product_id, store_id, price, mrp, discount_pct, in_stock, data_status, source, observed_at, error)
			values ($1,$2,$3,$4,$5,$6,'LIVE','MANUAL',now(),null)
			on conflict (competitor_product_id) do update set price=excluded.price, mrp=excluded.mrp, discount_pct=excluded.discount_pct,
				in_stock=excluded.in_stock, data_status='LIVE', source='MANUAL', observed_at=now(), error=null`,
			cpID, storeID, in.Price, in.MRP, disc, in.InStock); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `insert into competitor_price_history(competitor_product_id, store_id, price, mrp, discount_pct, in_stock, source)
			values ($1,$2,$3,$4,$5,$6,'MANUAL')`, cpID, storeID, in.Price, in.MRP, disc, in.InStock)
		return err
	})
	if err != nil {
		return ProductCompetitors{}, err
	}
	s.invalidate(ctx, storeID)
	return s.ProductCompetitors(ctx, id, storeID, productID)
}

func ensureCompetitorProduct(ctx context.Context, tx pgx.Tx, storeID, productID, key string, name, link, pack *string) (string, error) {
	var compID string
	if err := tx.QueryRow(ctx, "select id from competitors where key=$1 and is_active", strings.ToLower(key)).Scan(&compID); err != nil {
		if database.IsNotFound(err) {
			return "", utils.Unprocessable("Unknown competitor", map[string]string{"competitor_key": "not a supported platform"})
		}
		return "", err
	}
	if _, err := repositoriesGetProductID(ctx, tx, storeID, productID); err != nil {
		return "", err
	}
	var cpID string
	err := tx.QueryRow(ctx, `insert into competitor_products(store_id, product_id, competitor_id, external_name, url, pack_size)
		values ($1,$2,$3,$4,$5,$6)
		on conflict (product_id, competitor_id) do update set
			external_name = coalesce(excluded.external_name, competitor_products.external_name),
			url = coalesce(excluded.url, competitor_products.url),
			pack_size = coalesce(excluded.pack_size, competitor_products.pack_size)
		returning id`, storeID, productID, compID, trimPtr(name), trimPtr(link), trimPtr(pack)).Scan(&cpID)
	return cpID, err
}

type LinkRequest struct {
	CompetitorKey string  `json:"competitor_key" binding:"required"`
	ExternalName  *string `json:"external_name"`
	ExternalID    *string `json:"external_id"`
	URL           string  `json:"url" binding:"required"`
	PackSize      *string `json:"pack_size"`
}

// LinkCompetitorProduct maps a product to a competitor listing, then asks the
// AI service to fetch its price (prices are never taken from the client).
func (s *Service) LinkCompetitorProduct(ctx context.Context, id database.Identity, storeID, productID string, in LinkRequest) (ProductCompetitors, error) {
	if !validHTTPURL(in.URL) {
		return ProductCompetitors{}, utils.Unprocessable("Invalid link", map[string]string{"url": "must be an http(s) URL"})
	}
	err := s.userTx(ctx, id, "link competitor listing", func(tx pgx.Tx) error {
		cpID, err := ensureCompetitorProduct(ctx, tx, storeID, productID, in.CompetitorKey, in.ExternalName, &in.URL, in.PackSize)
		if err == nil && in.ExternalID != nil {
			_, err = tx.Exec(ctx, "update competitor_products set external_id=$2 where id=$1", cpID, *in.ExternalID)
		}
		return err
	})
	if err != nil {
		return ProductCompetitors{}, err
	}
	return s.RefreshCompetitors(ctx, id, storeID, productID)
}

// RefreshCompetitors triggers a fetch in the AI service (which writes the
// observations with the service role) and returns the updated view.
func (s *Service) RefreshCompetitors(ctx context.Context, id database.Identity, storeID, productID string) (ProductCompetitors, error) {
	if _, err := s.ProductCompetitors(ctx, id, storeID, productID); err != nil {
		return ProductCompetitors{}, err
	}
	lockKey := "lock:cmp-refresh:" + productID
	if ok, _ := s.Cache.Lock(ctx, lockKey, 2*time.Minute); !ok {
		return ProductCompetitors{}, utils.Conflict("A refresh for this product is already running")
	}
	defer s.Cache.Delete(ctx, lockKey)
	if err := s.AI.Post(ctx, "/v1/competitors/refresh", map[string]any{"store_id": storeID, "product_id": productID}, nil, ""); err != nil {
		return ProductCompetitors{}, aiErr(err)
	}
	s.invalidate(ctx, storeID)
	return s.ProductCompetitors(ctx, id, storeID, productID)
}

// SearchCompetitors performs a live cross-platform search via the AI service.
// Results are cached for 30 minutes; cached hits are relabelled CACHED.
func (s *Service) SearchCompetitors(ctx context.Context, storeID, query string) (map[string]any, error) {
	q := strings.Join(strings.Fields(strings.ToLower(query)), " ")
	if len(q) < 2 || len(q) > 120 {
		return nil, utils.BadRequest("query must be 2–120 characters")
	}
	// Prices depend on the delivery location, so results are cached per store.
	key := "cs:" + storeID + ":" + q
	var cached map[string]any
	if clients.GetJSON(ctx, s.Cache, key, &cached) {
		if results, ok := cached["results"].([]any); ok {
			for _, r := range results {
				if m, ok := r.(map[string]any); ok && m["status"] == "LIVE" {
					m["status"] = "CACHED"
				}
			}
		}
		cached["cache"] = map[string]any{"hit": true, "cached_at": cached["fetched_at"]}
		return cached, nil
	}
	var out map[string]any
	if err := s.AI.Get(ctx, "/v1/competitors/search", url.Values{"q": {q}, "store_id": {storeID}}, &out); err != nil {
		return nil, aiErr(err)
	}
	out["cache"] = map[string]any{"hit": false}
	clients.SetJSON(ctx, s.Cache, key, out, 30*time.Minute)
	return out, nil
}

// UnlinkCompetitorProduct removes a product's listing on a platform together
// with its observations (e.g. after linking the wrong listing).
func (s *Service) UnlinkCompetitorProduct(ctx context.Context, id database.Identity, storeID, productID, key string) error {
	err := s.userTx(ctx, id, "unlink competitor listing", func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `delete from competitor_products cp using competitors k
			where cp.competitor_id = k.id and k.key = $3 and cp.store_id = $1 and cp.product_id = $2`, storeID, productID, strings.ToLower(key))
		if err == nil && tag.RowsAffected() == 0 {
			return utils.NotFound("Linked listing")
		}
		return err
	})
	if err == nil {
		s.invalidate(ctx, storeID)
	}
	return err
}
