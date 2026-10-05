package services

import (
	"testing"
	"time"

	"github.com/rishabh26raj/priceiq/backend-go/models"
	"github.com/rishabh26raj/priceiq/backend-go/repositories"
)

func TestValidGTIN(t *testing.T) {
	valid := []string{"8901234567890", "4006381333931", "96385074", "036000291452", "10012345678902"}
	for _, v := range valid {
		if !ValidGTIN(v) {
			t.Errorf("%s should be valid", v)
		}
	}
	for _, v := range []string{"8901234567891", "4006381333932", "12345", "abcdefghijklm"} {
		if ValidGTIN(v) {
			t.Errorf("%s should be invalid", v)
		}
	}
}

func validRow() repositories.ProductRow {
	return repositories.ProductRow{SKU: "SKU-1", Name: "Milk", CostPrice: 20, SellingPrice: 25, MRP: 28, Stock: 5, SeasonFactor: 1}
}

func TestValidateProductRow(t *testing.T) {
	if errs := ValidateProductRow(validRow(), true, nil, false); len(errs) != 0 {
		t.Fatalf("valid row rejected: %v", errs)
	}
	past := time.Now().AddDate(0, 0, -2).Format("2006-01-02")
	future := time.Now().AddDate(0, 1, 0).Format("2006-01-02")
	bad := "8901234567891"
	cases := map[string]func(r *repositories.ProductRow){
		"selling_price": func(r *repositories.ProductRow) { r.SellingPrice = 30 },  // > MRP
		"cost_price":    func(r *repositories.ProductRow) { r.CostPrice = -1 },     // negative
		"stock":         func(r *repositories.ProductRow) { r.Stock = -3 },         // negative inventory
		"expiry_date":   func(r *repositories.ProductRow) { r.ExpiryDate = &past }, // past expiry
		"barcode":       func(r *repositories.ProductRow) { r.Barcode = &bad },     // bad check digit
		"sku":           func(r *repositories.ProductRow) { r.SKU = "bad sku!" },   // pattern
		"season_factor": func(r *repositories.ProductRow) { r.SeasonFactor = 0 },   // range
		"name":          func(r *repositories.ProductRow) { r.Name = " " },         // required
	}
	for field, mutate := range cases {
		r := validRow()
		mutate(&r)
		if errs := ValidateProductRow(r, true, nil, false); errs[field] == "" {
			t.Errorf("%s: expected error, got %v", field, errs)
		}
	}
	// Below cost is rejected unless clearance is allowed.
	r := validRow()
	r.SellingPrice = 15
	if errs := ValidateProductRow(r, true, nil, false); errs["selling_price"] == "" {
		t.Error("below-cost price accepted")
	}
	if errs := ValidateProductRow(r, true, nil, true); len(errs) != 0 {
		t.Errorf("below-cost with clearance rejected: %v", errs)
	}
	// An unchanged past expiry may be kept on update; a future one is fine.
	r = validRow()
	r.ExpiryDate = &past
	if errs := ValidateProductRow(r, false, &past, false); len(errs) != 0 {
		t.Errorf("unchanged past expiry rejected on update: %v", errs)
	}
	r.ExpiryDate = &future
	if errs := ValidateProductRow(r, true, nil, false); len(errs) != 0 {
		t.Errorf("future expiry rejected: %v", errs)
	}
}

func TestValidatePassword(t *testing.T) {
	for pw, ok := range map[string]bool{"short1": false, "nodigitshere": false, "12345678": false, "PriceIQ@2026!": true} {
		if (ValidatePassword(pw) == "") != ok {
			t.Errorf("password %q: ok=%v", pw, !ok)
		}
	}
}

func TestComputeInventory(t *testing.T) {
	st := settings()
	ref := time.Date(2026, 6, 30, 0, 0, 0, 0, time.UTC)
	last := ref.Add(-time.Hour)

	// 10/day, 25 in stock, 3-day lead ⇒ 2.5 days cover: LOW_STOCK + PREDICTED_STOCKOUT
	p := models.Product{ID: "a", Name: "A", Stock: 25, CostPrice: 10, SellingPrice: 12}
	pi := ComputeInventory(p, 10, 3, 20, &last, 3, ref, ref, st)
	has := func(s string) bool {
		for _, x := range pi.Statuses {
			if x == s {
				return true
			}
		}
		return false
	}
	if !has("LOW_STOCK") || !has("PREDICTED_STOCKOUT") || pi.DaysOfCover == nil || *pi.DaysOfCover != 2.5 {
		t.Fatalf("low stock: %+v", pi)
	}
	// Safety stock = ceil(1.65 * 3 * sqrt(3)) = 9 ; ROP = 30 + 9 = 39 ; qty = 10*(3+7)+9-25 = 84
	if pi.SafetyStockRec == nil || *pi.SafetyStockRec != 9 || *pi.ReorderPoint != 39 || pi.ReorderQty != 84 {
		t.Fatalf("reorder math: safety=%v rop=%v qty=%d", pi.SafetyStockRec, pi.ReorderPoint, pi.ReorderQty)
	}
	// Too little history ⇒ no σ-based safety stock (not invented).
	pi = ComputeInventory(p, 10, 3, 3, &last, 3, ref, ref, st)
	if pi.SafetyStockRec != nil || pi.DataSufficiency != "LIMITED" {
		t.Fatalf("limited data: %+v", pi)
	}
	// Overstock and dead stock.
	old := ref.AddDate(0, 0, -45)
	p2 := models.Product{ID: "b", Stock: 700}
	pi = ComputeInventory(p2, 10, 1, 20, &old, 3, ref, ref, st)
	if !contains(pi.Statuses, "OVERSTOCK") || !contains(pi.Statuses, "DEAD_STOCK") {
		t.Fatalf("over/dead: %v", pi.Statuses)
	}
	// Expiry: 100 units, 2 days left, 10/day ⇒ 80 at risk ⇒ CRITICAL.
	p3 := models.Product{ID: "c", Stock: 100, CostPrice: 5, DaysToExpiry: intp(2)}
	pi = ComputeInventory(p3, 10, 2, 20, &last, 3, ref, ref, st)
	if pi.ExpiryRisk != "CRITICAL" || *pi.UnitsAtExpiryRisk != 80 || !contains(pi.Statuses, "EXPIRY_RISK") {
		t.Fatalf("expiry: %+v", pi)
	}
	// Out of stock.
	pi = ComputeInventory(models.Product{ID: "d", Stock: 0}, 5, 1, 20, &last, 3, ref, ref, st)
	if !contains(pi.Statuses, "OUT_OF_STOCK") {
		t.Fatalf("oos: %v", pi.Statuses)
	}
}

func contains(xs []string, s string) bool {
	for _, x := range xs {
		if x == s {
			return true
		}
	}
	return false
}

func TestCompetitorStatusLabels(t *testing.T) {
	now := time.Now()
	ago := func(d time.Duration) *time.Time { v := now.Add(-d); return &v }
	live, est, scrape, manual := "LIVE", "ESTIMATED", "SCRAPE", "MANUAL"
	cases := []struct {
		stored, source *string
		at             *time.Time
		want           string
	}{
		{nil, nil, nil, "UNAVAILABLE"},
		{&live, &scrape, ago(time.Hour), "LIVE"},
		{&live, &scrape, ago(7 * time.Hour), "CACHED"},
		{&live, &manual, ago(7 * time.Hour), "MANUAL_VERIFIED"}, // manual entries stay verified for 24 h
		{&live, &manual, ago(25 * time.Hour), "CACHED"},
		{&est, &scrape, ago(time.Minute), "ESTIMATED"},
	}
	for _, c := range cases {
		if got := displayStatus(c.stored, c.source, c.at, now); got != c.want {
			t.Errorf("displayStatus = %s, want %s", got, c.want)
		}
	}
	// Only real observations feed market statistics; ESTIMATED/UNAVAILABLE never do.
	p := func(v float64) *float64 { return &v }
	m := MarketFrom(100, []CompetitorObservation{
		{CompetitorName: "A", Price: p(90), Status: "LIVE"}, {CompetitorName: "B", Price: p(110), Status: "MANUAL_VERIFIED"},
		{CompetitorName: "C", Price: p(10), Status: "ESTIMATED"}, {CompetitorName: "D", Status: "UNAVAILABLE"},
	})
	if m.ObservedCount != 2 || *m.Average != 100 || *m.Lowest != 90 {
		t.Fatalf("market stats: %+v", m)
	}
}

func TestSafeCSV(t *testing.T) {
	rows := SafeCSV([][]string{{"=HYPERLINK(\"http://x\")", "-12.50", "+SUM(A1)", "@cmd", "Milk", ""}})
	want := []string{"'=HYPERLINK(\"http://x\")", "-12.50", "'+SUM(A1)", "'@cmd", "Milk", ""}
	for i := range want {
		if rows[0][i] != want[i] {
			t.Errorf("cell %d = %q, want %q", i, rows[0][i], want[i])
		}
	}
}
