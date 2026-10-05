package services

import (
	"encoding/json"
	"math"
	"testing"

	"github.com/rishabh26raj/priceiq/backend-go/models"
)

func settings() models.StoreSettings {
	return models.StoreSettings{MinMarginPct: 0.10, MaxPriceChangePct: 0.10, ApprovalThresholdPct: 0.05,
		ExpiryMarkdownDays: 7, MaxExpiryMarkdownPct: 0.40, LowStockCoverDays: 3, OverstockCoverDays: 60, DeadStockDays: 30}
}

func product(cost, price, mrp float64, stock int, dte *int) models.Product {
	cat := "Dairy"
	return models.Product{CostPrice: cost, SellingPrice: price, MRP: mrp, Stock: stock, DaysToExpiry: dte, Category: &cat}
}

func intp(v int) *int { return &v }

func approx(a, b float64) bool { return math.Abs(a-b) < 0.011 }

func TestPriceBounds_Normal(t *testing.T) {
	b := PriceBounds(product(80, 100, 120, 50, nil), settings(), BusinessRules{})
	// floor = max(80/0.9 = 88.89, 100*0.9 = 90) ; ceiling = min(110, 120)
	if !approx(b.Lo, 90) || !approx(b.Hi, 110) || b.ExpiryWindow || b.Conflict != "" {
		t.Fatalf("bounds = %+v", b)
	}
}

func TestPriceBounds_MRPCeilingWins(t *testing.T) {
	b := PriceBounds(product(80, 100, 104, 50, nil), settings(), BusinessRules{})
	if !approx(b.Hi, 104) {
		t.Fatalf("MRP ceiling not applied: %+v", b)
	}
}

func TestPriceBounds_ExpiryWindowRelaxesFloorAndBlocksIncrease(t *testing.T) {
	b := PriceBounds(product(80, 100, 120, 50, intp(3)), settings(), BusinessRules{})
	// floor = max(cost 80, 100*(1-0.4)=60) = 80 ; no increases
	if !b.ExpiryWindow || !approx(b.Lo, 80) || !approx(b.Hi, 100) {
		t.Fatalf("expiry bounds = %+v", b)
	}
	st := settings()
	st.AllowBelowCostClearance = true
	b = PriceBounds(product(80, 100, 120, 50, intp(3)), st, BusinessRules{})
	if !approx(b.Lo, 60) {
		t.Fatalf("below-cost clearance floor = %v, want 60", b.Lo)
	}
	// No stock ⇒ no expiry window.
	b = PriceBounds(product(80, 100, 120, 0, intp(3)), settings(), BusinessRules{})
	if b.ExpiryWindow {
		t.Fatal("expiry window without stock")
	}
}

func TestPriceBounds_Conflicts(t *testing.T) {
	// Margin floor (100/0.9 = 111.1) above MRP (105): pinned to MRP.
	b := PriceBounds(product(100, 102, 105, 10, nil), settings(), BusinessRules{})
	if b.Conflict == "" || !approx(b.Lo, 105) || !approx(b.Hi, 105) {
		t.Fatalf("margin>MRP conflict = %+v", b)
	}
	// Current price far below the margin floor: margin restored beyond the change limit.
	b = PriceBounds(product(100, 95, 150, 10, nil), settings(), BusinessRules{})
	if b.Conflict == "" || !approx(b.Lo, 111.11) {
		t.Fatalf("margin restore conflict = %+v", b)
	}
}

func TestPriceBounds_BusinessRules(t *testing.T) {
	raw := json.RawMessage(`{"category_min_margin":{"dairy":0.25},"max_price":105,"round_to":0.5,"freeze_categories":[]}`)
	rules, err := ParseRules(raw)
	if err != nil {
		t.Fatal(err)
	}
	b := PriceBounds(product(70, 100, 120, 10, nil), settings(), rules)
	// floor = max(70/0.75 = 93.33, 90) ; ceiling = min(110, 120, 105)
	if !approx(b.Lo, 93.33) || !approx(b.Hi, 105) {
		t.Fatalf("rules bounds = %+v", b)
	}
	frozen, _ := ParseRules(json.RawMessage(`{"freeze_categories":["DAIRY"]}`))
	b = PriceBounds(product(70, 100, 120, 10, nil), settings(), frozen)
	if !b.Frozen || b.Lo != 100 || b.Hi != 100 {
		t.Fatalf("frozen = %+v", b)
	}
	if _, err := ParseRules(json.RawMessage(`{"category_min_margin":{"x":1.5}}`)); err == nil {
		t.Fatal("invalid margin rule accepted")
	}
}

func TestEnforce(t *testing.T) {
	b := Bounds{Lo: 90, Hi: 110, Rules: []BoundRule{
		{"min_margin", "floor", 88.89, "m"}, {"max_price_change", "floor", 90, "c"},
		{"max_price_change", "ceiling", 110, "c"}, {"mrp_ceiling", "ceiling", 120, "mrp"}}}
	p, applied := Enforce(130, b)
	if p != 110 || len(applied) != 1 || applied[0].Rule != "max_price_change" || applied[0].Before != 130 {
		t.Fatalf("ceiling enforce = %v %+v", p, applied)
	}
	p, applied = Enforce(50, b)
	if p != 90 || applied[0].Rule != "max_price_change" {
		t.Fatalf("floor enforce = %v %+v", p, applied)
	}
	p, applied = Enforce(100, b)
	if p != 100 || len(applied) != 0 {
		t.Fatalf("in-band enforce = %v %+v", p, applied)
	}
	p, applied = Enforce(math.NaN(), b)
	if p != 110 || applied[0].Rule != "invalid_model_output" {
		t.Fatalf("NaN enforce = %v %+v", p, applied)
	}
	b.RoundTo = 0.5
	if p, _ = Enforce(99.83, b); p != 100 {
		t.Fatalf("rounding = %v", p)
	}
	if p, _ = Enforce(109.9, Bounds{Lo: 109.8, Hi: 109.95, RoundTo: 1}); p < 109.8 || p > 109.95 {
		t.Fatalf("rounding left band: %v", p)
	}
}

func TestValidatePrice(t *testing.T) {
	b := Bounds{Lo: 90, Hi: 110}
	if len(ValidatePrice(100, b)) != 0 || len(ValidatePrice(111, b)) != 1 || len(ValidatePrice(89, b)) != 1 {
		t.Fatal("ValidatePrice mismatch")
	}
}
