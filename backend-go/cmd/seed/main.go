// Command seed loads the synthetic demo/training dataset into a demo organization.
//
//	go run ./cmd/seed               # idempotent: skips when the demo org exists
//	go run ./cmd/seed -force        # delete the demo org and reload
//
// Input (both produced by backend/scripts/generate_synthetic_data.py):
//
//	data/priceiq_catalog.json          product master data
//	data/priceiq_synthetic_daily.csv   one row per (product, day), Sep 2025 – Sep 2026
//
// What is created
//   - organization "PriceIQ Demo Retail" with two stores (data_mode SYNTHETIC);
//     the catalogue is split between them so each store holds every category
//   - suppliers, categories and products (is_synthetic = true) with shelf life,
//     sensitivities, reorder levels and the stock / expiry state of the last
//     simulated day
//   - every non-zero CSV row as a sale (source SYNTHETIC), every price change
//     as a pricing_history row and every day's product state (price, cost,
//     stock, days to expiry, season factor) as a product_daily_snapshots row
//   - three demo seasonal considerations (clearly marked as simulated)
//   - demo users (local auth: inserted into auth.users; Supabase: created via
//     the Admin API when SUPABASE_SERVICE_ROLE_KEY is set)
//
// Everything seeded here is simulated and labelled as such (stores.data_mode,
// products.is_synthetic, sales.source). No competitor prices are seeded —
// those only ever come from a platform read or a manual staff entry.
package main

import (
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/joho/godotenv"
	"golang.org/x/crypto/bcrypt"

	"github.com/rishabh26raj/priceiq/backend-go/database"
)

const demoOrgSlug = "priceiq-demo"

// row is one (product, day) record of the daily CSV.
type row struct {
	pid          int
	cost, mrp    float64
	price        float64
	date         time.Time
	stock        int
	units        int
	daysToExpiry *int // nil ⇒ the product has no expiry
	seasonFactor float64
}

type catalogProduct struct {
	ProductID           int     `json:"product_id"`
	SKU                 string  `json:"sku"`
	Name                string  `json:"name"`
	Brand               *string `json:"brand"`
	Category            string  `json:"category"`
	Subcategory         string  `json:"subcategory"`
	PackSize            string  `json:"pack_size"`
	Supplier            string  `json:"supplier"`
	ShelfLifeDays       *int    `json:"shelf_life_days"`
	IsPerishable        bool    `json:"is_perishable"`
	SeasonalSensitivity float64 `json:"seasonal_sensitivity"`
	FestivalSensitivity float64 `json:"festival_sensitivity"`
	WeatherSensitivity  float64 `json:"weather_sensitivity"`
	ReorderLevel        int     `json:"reorder_level"`
	SafetyStock         int     `json:"safety_stock"`
	Store               int     `json:"store"`
}

type catalog struct {
	Suppliers []struct {
		Name         string `json:"name"`
		LeadTimeDays int    `json:"lead_time_days"`
	} `json:"suppliers"`
	Products []catalogProduct `json:"products"`
}

type demoUser struct {
	email, name string
	role        string
	storeIdx    int // -1 ⇒ org-wide
}

var demoUsers = []demoUser{
	{"demo@priceiq.ai", "Demo Admin", "ADMIN", -1},
	{"manager@priceiq.ai", "Koramangala Manager", "STORE_MANAGER", 0},
	{"analyst@priceiq.ai", "Pricing Analyst", "ANALYST", -1},
	{"viewer@priceiq.ai", "Indiranagar Viewer", "VIEWER", 1},
}

func main() {
	force := flag.Bool("force", false, "delete and recreate the demo organization")
	csvPath := flag.String("csv", "../data/priceiq_synthetic_daily.csv", "daily dataset path")
	catPath := flag.String("catalog", "../data/priceiq_catalog.json", "product catalogue path")
	flag.Parse()
	_ = godotenv.Load()

	ctx := context.Background()
	db, err := database.Connect(ctx, os.Getenv("DATABASE_URL"), 4)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	var exists bool
	_ = db.Pool.QueryRow(ctx, "select exists(select 1 from organizations where slug=$1)", demoOrgSlug).Scan(&exists)
	if exists && !*force {
		log.Println("demo organization already seeded — use -force to reload")
		seedUsers(ctx, db)
		return
	}

	rows, err := readCSV(*csvPath)
	if err != nil {
		log.Fatalf("dataset: %v (generate it with: python backend/scripts/generate_synthetic_data.py)", err)
	}
	cat, err := readCatalog(*catPath)
	if err != nil {
		log.Fatalf("catalogue: %v", err)
	}

	// One transaction: a failed seed leaves no half-loaded organization behind.
	err = db.WithSystem(ctx, func(tx pgx.Tx) error {
		if *force {
			if _, err := tx.Exec(ctx, "delete from organizations where slug=$1", demoOrgSlug); err != nil {
				return err
			}
		}
		return seedData(ctx, tx, rows, cat)
	})
	if err != nil {
		log.Fatalf("seed: %v", err)
	}
	seedUsers(ctx, db)
	log.Println("seed complete")
}

func seedData(ctx context.Context, tx pgx.Tx, rows []row, cat *catalog) error {
	var orgID string
	if err := tx.QueryRow(ctx, `insert into organizations(name, slug) values ('PriceIQ Demo Retail', $1) returning id`,
		demoOrgSlug).Scan(&orgID); err != nil {
		return err
	}
	storeDefs := []struct {
		name, code string
		lat, lon   float64
		pincode    string
	}{
		{"Koramangala", "BLR-KOR", 12.9352, 77.6245, "560034"},
		{"Indiranagar", "BLR-IND", 12.9719, 77.6412, "560038"},
	}
	storeIDs := make([]string, len(storeDefs))
	for i, s := range storeDefs {
		if err := tx.QueryRow(ctx, `insert into stores(organization_id, name, code, city, state, pincode, latitude, longitude, data_mode)
			values ($1,$2,$3,'Bengaluru','Karnataka',$4,$5,$6,'SYNTHETIC') returning id`,
			orgID, s.name, s.code, s.pincode, s.lat, s.lon).Scan(&storeIDs[i]); err != nil {
			return err
		}
	}

	supplierIDs := map[string]string{}
	for _, s := range cat.Suppliers {
		var id string
		if err := tx.QueryRow(ctx, `insert into suppliers(organization_id, name, lead_time_days) values ($1,$2,$3) returning id`,
			orgID, s.Name, s.LeadTimeDays).Scan(&id); err != nil {
			return err
		}
		supplierIDs[s.Name] = id
	}
	catIDs := map[string]string{}
	for _, p := range cat.Products {
		if _, ok := catIDs[p.Category]; ok {
			continue
		}
		var id string
		if err := tx.QueryRow(ctx, `insert into categories(organization_id, name) values ($1,$2) returning id`,
			orgID, titleCase(p.Category)).Scan(&id); err != nil {
			return err
		}
		catIDs[p.Category] = id
	}

	// Group the daily rows by product, chronologically.
	byProduct := map[int][]row{}
	for _, r := range rows {
		byProduct[r.pid] = append(byProduct[r.pid], r)
	}

	today := time.Now().UTC().Truncate(24 * time.Hour)
	var nSales, nHist, nProducts int
	var firstDay, lastDay time.Time
	for _, cp := range cat.Products {
		hist := byProduct[cp.ProductID]
		if len(hist) == 0 {
			return fmt.Errorf("catalogue product %d (%s) has no rows in the daily dataset", cp.ProductID, cp.SKU)
		}
		sort.Slice(hist, func(i, j int) bool { return hist[i].date.Before(hist[j].date) })
		first, last := hist[0], hist[len(hist)-1]
		if firstDay.IsZero() || first.date.Before(firstDay) {
			firstDay = first.date
		}
		if last.date.After(lastDay) {
			lastDay = last.date
		}
		if cp.Store < 0 || cp.Store >= len(storeIDs) {
			return fmt.Errorf("product %s: unknown store index %d", cp.SKU, cp.Store)
		}
		storeID := storeIDs[cp.Store]

		// The product carries the state of the last simulated day. Its expiry
		// date is re-anchored to today so "days to expiry" stays meaningful
		// whenever the seed is run.
		var expiry any
		if last.daysToExpiry != nil {
			expiry = today.AddDate(0, 0, *last.daysToExpiry)
		}
		var productID string
		if err := tx.QueryRow(ctx, `insert into products(store_id, legacy_product_id, sku, name, brand, category_id, subcategory,
				supplier_id, pack_size, cost_price, selling_price, mrp, stock, reorder_level, safety_stock, expiry_date,
				season_factor, is_perishable, shelf_life_days, seasonal_sensitivity, festival_sensitivity, weather_sensitivity,
				is_synthetic, created_at)
			values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,true,$23) returning id`,
			storeID, cp.ProductID, cp.SKU, cp.Name, cp.Brand, catIDs[cp.Category], cp.Subcategory,
			supplierIDs[cp.Supplier], cp.PackSize, last.cost, last.price, last.mrp, last.stock, cp.ReorderLevel, cp.SafetyStock,
			expiry, last.seasonFactor, cp.IsPerishable, cp.ShelfLifeDays, cp.SeasonalSensitivity, cp.FestivalSensitivity,
			cp.WeatherSensitivity, first.date).Scan(&productID); err != nil {
			return fmt.Errorf("product %s: %w", cp.SKU, err)
		}
		nProducts++
		// The insert triggers wrote one price-history row and one stock
		// movement dated "now"; replace the price row with the real series.
		if _, err := tx.Exec(ctx, `delete from pricing_history where product_id=$1`, productID); err != nil {
			return err
		}

		histRows := make([][]any, 0, 64)
		saleRows := make([][]any, 0, len(hist))
		snapRows := make([][]any, 0, len(hist))
		var prev *float64
		for _, h := range hist {
			if prev == nil || *prev != h.price {
				var old any
				if prev != nil {
					old = *prev
				}
				histRows = append(histRows, []any{storeID, productID, old, h.price, "IMPORT", "synthetic dataset", h.date})
				p := h.price
				prev = &p
			}
			snapRows = append(snapRows, []any{productID, storeID, h.date, h.price, h.cost, h.mrp, h.stock, h.daysToExpiry, h.seasonFactor})
			if h.units > 0 {
				// Sales are booked at noon so they fall on the same calendar day in every timezone used.
				saleRows = append(saleRows, []any{storeID, productID, h.units, h.price, h.cost, "SYNTHETIC", h.date.Add(12 * time.Hour)})
			}
		}
		// COPY is ~50× faster than row inserts for the ~130k history rows.
		n, err := tx.CopyFrom(ctx, pgx.Identifier{"pricing_history"},
			[]string{"store_id", "product_id", "old_price", "new_price", "source", "reason", "created_at"},
			pgx.CopyFromRows(histRows))
		if err != nil {
			return err
		}
		nHist += int(n)
		n, err = tx.CopyFrom(ctx, pgx.Identifier{"sales"},
			[]string{"store_id", "product_id", "quantity", "unit_price", "unit_cost", "source", "sold_at"},
			pgx.CopyFromRows(saleRows))
		if err != nil {
			return err
		}
		nSales += int(n)
		if _, err = tx.CopyFrom(ctx, pgx.Identifier{"product_daily_snapshots"},
			[]string{"product_id", "store_id", "snapshot_date", "price", "cost_price", "mrp", "stock", "days_to_expiry", "season_factor"},
			pgx.CopyFromRows(snapRows)); err != nil {
			return err
		}
	}

	if err := seedConsiderations(ctx, tx, storeIDs, catIDs, today); err != nil {
		return err
	}
	log.Printf("seeded 1 organization, %d stores, %d suppliers, %d products, %d sales, %d price changes (%s .. %s) — all SYNTHETIC",
		len(storeIDs), len(supplierIDs), nProducts, nSales, nHist, firstDay.Format("2006-01-02"), lastDay.Format("2006-01-02"))
	return nil
}

// seedConsiderations adds a few example seasonal considerations so the
// Seasonal page and the pricing explanation have something to show. They are
// planning assumptions of the demo, not measurements.
func seedConsiderations(ctx context.Context, tx pgx.Tx, storeIDs []string, catIDs map[string]string, today time.Time) error {
	const note = "Demo consideration — a simulated planning assumption, not a measured effect."
	defs := []struct {
		name, kind, category string
		start, end           time.Time
		pct                  float64
		supply               string
		weather, festival    any
	}{
		{"Warm spell this week", "WEATHER", "beverages", today.AddDate(0, 0, -1), today.AddDate(0, 0, 6), 10, "NORMAL", "HIGH", nil},
		{"Navratri 2026", "FESTIVAL", "fruits", date(2026, 10, 11), date(2026, 10, 19), 25, "NORMAL", nil, "HIGH"},
		{"Diwali 2026", "FESTIVAL", "snacks", date(2026, 11, 2), date(2026, 11, 9), 40, "LIMITED", nil, "HIGH"},
	}
	for _, storeID := range storeIDs {
		for _, d := range defs {
			if d.end.Before(today) {
				continue // the fixed-date examples expire with the calendar
			}
			if _, err := tx.Exec(ctx, `insert into seasonal_considerations(store_id, name, kind, category_id, start_date, end_date,
					expected_demand_change_pct, supply_condition, weather_sensitivity, festival_sensitivity, notes)
				values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
				storeID, d.name, d.kind, catIDs[d.category], d.start, d.end, d.pct, d.supply, d.weather, d.festival, note); err != nil {
				return fmt.Errorf("consideration %s: %w", d.name, err)
			}
		}
	}
	return nil
}

func date(y int, m time.Month, d int) time.Time { return time.Date(y, m, d, 0, 0, 0, 0, time.UTC) }

// seedUsers creates the demo accounts and their memberships (idempotent).
func seedUsers(ctx context.Context, db *database.DB) {
	password, fromEnv := os.Getenv("SEED_DEMO_PASSWORD"), true
	if password == "" {
		password, fromEnv = "PriceIQ@2026!", false
	}
	shown := password // the built-in demo password is public (README); a custom one is not logged
	if fromEnv {
		shown = "$SEED_DEMO_PASSWORD"
	}
	provider := strings.ToLower(os.Getenv("AUTH_PROVIDER"))

	var orgID string
	if err := db.Pool.QueryRow(ctx, "select id from organizations where slug=$1", demoOrgSlug).Scan(&orgID); err != nil {
		log.Printf("users skipped: %v", err)
		return
	}
	storeRows, _ := db.Pool.Query(ctx, "select id from stores where organization_id=$1 order by code desc", orgID)
	storeIDs, _ := pgx.CollectRows(storeRows, pgx.RowTo[string]) // BLR-KOR, BLR-IND

	for _, u := range demoUsers {
		var userID string
		switch provider {
		case "local":
			var err error
			userID, err = insertAuthUser(ctx, db, u.email, password, u.name)
			if err != nil {
				log.Printf("user %s: %v", u.email, err)
				continue
			}
		default:
			id, err := createSupabaseUser(u.email, password, u.name)
			if err != nil {
				log.Printf("user %s not created (%v) — create it in Supabase Auth and re-run seed", u.email, err)
				continue
			}
			userID = id
		}
		var storeID any
		if u.storeIdx >= 0 && u.storeIdx < len(storeIDs) {
			storeID = storeIDs[u.storeIdx]
		}
		_, err := db.Pool.Exec(ctx, `insert into profiles(id, email, full_name) values ($1,$2,$3) on conflict (id) do nothing`,
			userID, u.email, u.name)
		if err == nil {
			_, err = db.Pool.Exec(ctx, `insert into memberships(user_id, organization_id, store_id, role)
				values ($1,$2,$3,$4) on conflict (user_id, organization_id, store_id) do update set role = excluded.role`,
				userID, orgID, storeID, u.role)
		}
		if err != nil {
			log.Printf("membership %s: %v", u.email, err)
			continue
		}
		log.Printf("user %-22s %-13s password=%s", u.email, u.role, shown)
	}
}

// insertAuthUser writes a demo account straight into auth.users (local auth)
// and returns its id; an existing account with that e-mail is reused.
//
// Local auth can also run on a real Supabase database. There auth.users is
// GoTrue's own table: it has no plain unique(email) to upsert on, and GoTrue
// cannot read a row that lacks its bookkeeping columns. So on Supabase the row
// is written in the shape GoTrue itself produces (instance, aud/role, empty
// token columns, an e-mail identity), which lets the same account sign in
// through Supabase Auth after switching to AUTH_PROVIDER=supabase.
func insertAuthUser(ctx context.Context, db *database.DB, email, password, name string) (string, error) {
	var id string
	err := db.Pool.QueryRow(ctx, "select id from auth.users where lower(email)=lower($1)", email).Scan(&id)
	if err == nil || !database.IsNotFound(err) {
		return id, err
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), 10)
	if err != nil {
		return "", err
	}
	var gotrue bool
	if err := db.Pool.QueryRow(ctx, "select to_regclass('auth.identities') is not null").Scan(&gotrue); err != nil {
		return "", err
	}
	if !gotrue { // plain PostgreSQL with supabase/local/00_auth_shim.sql
		err = db.Pool.QueryRow(ctx, `insert into auth.users(email, encrypted_password, email_confirmed_at, raw_user_meta_data)
			values ($1, $2, now(), jsonb_build_object('full_name', $3::text)) returning id`, email, string(hash), name).Scan(&id)
		return id, err
	}
	err = db.WithSystem(ctx, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `insert into auth.users(instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
				raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
				confirmation_token, recovery_token, email_change_token_new, email_change)
			values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', $1, $2, now(),
				'{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('full_name', $3::text), now(), now(),
				'', '', '', '') returning id`, email, string(hash), name).Scan(&id); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `insert into auth.identities(provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
			values ($1::text, $1::uuid, jsonb_build_object('sub', $1::text, 'email', $2::text, 'email_verified', true, 'phone_verified', false),
				'email', now(), now(), now())`, id, email)
		return err
	})
	return id, err
}

// createSupabaseUser uses the GoTrue Admin API (service role key required).
// If the user already exists its id is looked up from auth.users instead.
func createSupabaseUser(email, password, name string) (string, error) {
	base := strings.TrimRight(os.Getenv("SUPABASE_URL"), "/")
	key := os.Getenv("SUPABASE_SERVICE_ROLE_KEY")
	if base == "" || key == "" {
		return "", fmt.Errorf("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set")
	}
	body, _ := json.Marshal(map[string]any{
		"email": email, "password": password, "email_confirm": true,
		"user_metadata": map[string]string{"full_name": name},
	})
	req, _ := http.NewRequest(http.MethodPost, base+"/auth/v1/admin/users", bytes.NewReader(body))
	req.Header.Set("apikey", key)
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode == http.StatusUnprocessableEntity || resp.StatusCode == http.StatusConflict {
		return lookupSupabaseUser(email)
	}
	if resp.StatusCode >= 300 {
		return "", fmt.Errorf("admin API %d: %s", resp.StatusCode, raw)
	}
	var out struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(raw, &out); err != nil || out.ID == "" {
		return "", fmt.Errorf("unexpected admin API response: %s", raw)
	}
	return out.ID, nil
}

func lookupSupabaseUser(email string) (string, error) {
	db, err := database.Connect(context.Background(), os.Getenv("DATABASE_URL"), 1)
	if err != nil {
		return "", err
	}
	defer db.Close()
	var id string
	err = db.Pool.QueryRow(context.Background(), "select id from auth.users where email=$1", email).Scan(&id)
	return id, err
}

func readCSV(path string) ([]row, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	recs, err := csv.NewReader(f).ReadAll()
	if err != nil {
		return nil, err
	}
	if len(recs) < 2 {
		return nil, fmt.Errorf("%s is empty", path)
	}
	idx := map[string]int{}
	for i, h := range recs[0] {
		idx[h] = i
	}
	for _, col := range []string{"product_id", "cost_price", "mrp", "price", "date", "stock_level", "units_sold", "days_to_expiry", "season_factor"} {
		if _, ok := idx[col]; !ok {
			return nil, fmt.Errorf("csv missing column %q", col)
		}
	}
	out := make([]row, 0, len(recs)-1)
	for _, r := range recs[1:] {
		d, err := time.Parse("2006-01-02", r[idx["date"]])
		if err != nil {
			return nil, err
		}
		rw := row{
			pid:          atoi(r[idx["product_id"]]),
			cost:         round2(atof(r[idx["cost_price"]])),
			mrp:          round2(atof(r[idx["mrp"]])),
			price:        round2(atof(r[idx["price"]])),
			date:         d,
			stock:        atoi(r[idx["stock_level"]]),
			units:        atoi(r[idx["units_sold"]]),
			seasonFactor: atof(r[idx["season_factor"]]),
		}
		if v := strings.TrimSpace(r[idx["days_to_expiry"]]); v != "" { // empty ⇒ no expiry
			n := int(atof(v))
			rw.daysToExpiry = &n
		}
		out = append(out, rw)
	}
	return out, nil
}

func readCatalog(path string) (*catalog, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var c catalog
	if err := json.Unmarshal(b, &c); err != nil {
		return nil, err
	}
	if len(c.Products) == 0 {
		return nil, fmt.Errorf("%s contains no products", path)
	}
	return &c, nil
}

func atoi(s string) int        { v, _ := strconv.Atoi(strings.TrimSpace(s)); return v }
func atof(s string) float64    { v, _ := strconv.ParseFloat(strings.TrimSpace(s), 64); return v }
func round2(v float64) float64 { return float64(int64(v*100+0.5)) / 100 }

func titleCase(s string) string {
	parts := strings.Fields(strings.ReplaceAll(s, "_", " "))
	for i, p := range parts {
		parts[i] = strings.ToUpper(p[:1]) + p[1:]
	}
	return strings.Join(parts, " ")
}
