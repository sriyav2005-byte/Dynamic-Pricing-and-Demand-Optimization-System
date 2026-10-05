package routes_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/rishabh26raj/priceiq/backend-go/clients"
	"github.com/rishabh26raj/priceiq/backend-go/config"
	"github.com/rishabh26raj/priceiq/backend-go/database"
	"github.com/rishabh26raj/priceiq/backend-go/internal/testutil"
	"github.com/rishabh26raj/priceiq/backend-go/middleware"
	"github.com/rishabh26raj/priceiq/backend-go/routes"
	"github.com/rishabh26raj/priceiq/backend-go/services"
)

var (
	db     *database.DB
	router *gin.Engine
	svc    *services.Service
	fakeAI *aiStub
)

// aiStub impersonates the Python AI service.
type aiStub struct {
	mu        sync.Mutex
	price     func(lo, hi, cur float64) float64
	feedbacks int
	down      bool
}

func (a *aiStub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.down {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	var body map[string]any
	_ = json.NewDecoder(r.Body).Decode(&body)
	w.Header().Set("Content-Type", "application/json")
	switch r.URL.Path {
	case "/health":
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	case "/v1/pricing/recommend":
		b := body["bounds"].(map[string]any)
		lo, hi := b["lo"].(float64), b["hi"].(float64)
		var cur float64
		_ = db.Pool.QueryRow(context.Background(), "select selling_price::float8 from products where id=$1", body["product_id"]).Scan(&cur)
		p := a.price(lo, hi, cur)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"recommended_price": p, "model_price": p, "expected_demand": 10.0, "expected_revenue": p * 10,
			"expected_profit": 50.0, "expected_margin_pct": 20.0, "confidence": 0.8, "policy": "test_policy",
			"model_version": "demand_xgb:v2", "explanation": map[string]any{"summary": "stub"}, "context": map[string]any{},
			"candidates": []map[string]any{{"price": p, "demand": 10, "revenue": p * 10, "profit": 50, "in_band": true}},
		})
	case "/v1/pricing/feedback":
		a.feedbacks++
		_, _ = w.Write([]byte(`{"recorded":true}`))
	case "/v1/pricing/simulate":
		_, _ = w.Write([]byte(`{"results":[]}`))
	case "/v1/anomalies/detect":
		_, _ = w.Write([]byte(`{"anomalies":[]}`))
	default:
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"detail":"not found"}`))
	}
}

func TestMain(m *testing.M) {
	gin.SetMode(gin.TestMode)
	var stop func()
	var err error
	db, stop, err = testutil.StartDB()
	if err != nil {
		fmt.Fprintln(os.Stderr, "test db:", err)
		os.Exit(1)
	}
	fakeAI = &aiStub{price: func(lo, hi, cur float64) float64 { return cur }}
	ai := httptest.NewServer(fakeAI)
	cfg := &config.Config{AuthProvider: config.AuthLocal, LocalJWTSecret: strings.Repeat("s", 40), LocalTokenTTL: time.Hour,
		AIServiceURL: ai.URL, AIServiceToken: "t", RateLimitPerMinute: 10000, CORSOrigins: []string{"http://localhost:3000"}}
	cache, _ := clients.NewCache("")
	verifier, _ := middleware.NewVerifier(context.Background(), cfg)
	svc = &services.Service{Cfg: cfg, DB: db, Cache: cache, Verifier: verifier,
		AI: clients.NewAIClient(ai.URL, "t", 10*time.Second), Roles: &middleware.RoleResolver{DB: db, Cache: cache}}
	router = gin.New()
	routes.Register(router, svc)
	code := m.Run()
	ai.Close()
	stop()
	os.Exit(code)
}

// ── helpers ─────────────────────────────────────────────────────────────────

type world struct {
	orgA, orgB, a1, a2, b1                string
	admin, mgr, analyst, viewer, outsider string // tokens
	product                               string
}

func newWorld(t *testing.T) world {
	t.Helper()
	f := testutil.Fixture{DB: db, T: t}
	w := world{orgA: f.Org("A"), orgB: f.Org("B")}
	w.a1, w.a2, w.b1 = f.Store(w.orgA, "A1"), f.Store(w.orgA, "A2"), f.Store(w.orgB, "B1")
	mk := func(name, org, store, role string) string {
		id := f.User(fmt.Sprintf("%s-%d@t.test", name, time.Now().UnixNano()))
		f.Member(id, org, store, role)
		tok, _, err := svc.Verifier.IssueLocal(id, name+"@t.test", time.Hour)
		if err != nil {
			t.Fatal(err)
		}
		return tok
	}
	w.admin = mk("admin", w.orgA, "", "ADMIN")
	w.mgr = mk("mgr", w.orgA, w.a1, "STORE_MANAGER")
	w.analyst = mk("analyst", w.orgA, w.a1, "ANALYST")
	w.viewer = mk("viewer", w.orgA, w.a1, "VIEWER")
	w.outsider = mk("outsider", w.orgB, "", "ADMIN")
	w.product = f.Product(w.a1, "P-1", 80, 100, 120, 50)
	return w
}

func call(t *testing.T, method, path, token string, body any) (int, map[string]any) {
	t.Helper()
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req := httptest.NewRequest(method, "/api/v1"+path, rd)
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

func want(t *testing.T, got, expected int, body map[string]any, what string) {
	t.Helper()
	if got != expected {
		t.Fatalf("%s: status %d, want %d (%v)", what, got, expected, body)
	}
}

// ── tests ───────────────────────────────────────────────────────────────────

func TestAuthentication(t *testing.T) {
	code, _ := call(t, "GET", "/me", "", nil)
	want(t, code, 401, nil, "no token")
	code, _ = call(t, "GET", "/me", "not.a.token", nil)
	want(t, code, 401, nil, "garbage token")
	other, _ := middleware.NewVerifier(context.Background(), &config.Config{AuthProvider: config.AuthLocal, LocalJWTSecret: strings.Repeat("x", 40)})
	forged, _, _ := other.IssueLocal("00000000-0000-0000-0000-000000000001", "x@x", time.Hour)
	code, _ = call(t, "GET", "/me", forged, nil)
	want(t, code, 401, nil, "token signed with another secret")
}

func TestCrossStoreAndCrossOrgIsolation(t *testing.T) {
	w := newWorld(t)
	code, body := call(t, "GET", "/stores/"+w.a2+"/products", w.mgr, nil)
	want(t, code, 404, body, "store manager of A1 reading A2")
	code, body = call(t, "GET", "/stores/"+w.a1+"/products", w.outsider, nil)
	want(t, code, 404, body, "other org reading A1")
	code, body = call(t, "GET", "/stores/"+w.a1+"/products/"+w.product, w.outsider, nil)
	want(t, code, 404, body, "other org reading A1 product")
	code, body = call(t, "PATCH", "/stores/"+w.b1+"/products/"+w.product, w.mgr, map[string]any{"stock": 1})
	want(t, code, 404, body, "manager patching via foreign store")
	// A product id from A1 addressed through A2 (where the admin has access) is not found.
	code, body = call(t, "GET", "/stores/"+w.a2+"/products/"+w.product, w.admin, nil)
	want(t, code, 404, body, "product via wrong store")
	code, body = call(t, "GET", "/stores/"+w.a1+"/products", w.admin, nil)
	want(t, code, 200, body, "org admin reads A1")
	code, body = call(t, "GET", "/me", w.mgr, nil)
	if stores := body["stores"].([]any); len(stores) != 1 {
		t.Fatalf("manager sees %d stores", len(stores))
	}
}

func TestRoleGuards(t *testing.T) {
	w := newWorld(t)
	s := "/stores/" + w.a1
	code, body := call(t, "POST", s+"/products", w.viewer, map[string]any{"sku": "X", "name": "X", "cost_price": 1, "selling_price": 2, "mrp": 3})
	want(t, code, 403, body, "viewer creates product")
	code, body = call(t, "POST", s+"/pricing/recommendations", w.viewer, map[string]any{"product_id": w.product})
	want(t, code, 403, body, "viewer generates recommendation")
	code, body = call(t, "PUT", s+"/settings", w.mgr, map[string]any{})
	want(t, code, 403, body, "manager changes settings")
	code, body = call(t, "GET", s+"/audit-logs", w.analyst, nil)
	want(t, code, 403, body, "analyst reads audit log")
	code, body = call(t, "GET", "/organizations/"+w.orgA+"/members", w.mgr, nil)
	want(t, code, 403, body, "store manager lists org members")
}

func TestProductCRUDAndIntegrity(t *testing.T) {
	w := newWorld(t)
	s := "/stores/" + w.a1
	good := map[string]any{"sku": "MILK-1", "name": "Toned Milk", "category": "Dairy", "cost_price": 20, "selling_price": 24,
		"mrp": 26, "stock": 10, "barcode": "8901234567890", "expiry_date": time.Now().AddDate(0, 0, 5).Format("2006-01-02")}
	code, p := call(t, "POST", s+"/products", w.mgr, good)
	want(t, code, 201, p, "create")
	if p["category"] != "Dairy" || p["days_to_expiry"] != float64(5) {
		t.Fatalf("created product = %v", p)
	}
	dup := map[string]any{"sku": "milk-1", "name": "Dup", "cost_price": 1, "selling_price": 2, "mrp": 3}
	code, body := call(t, "POST", s+"/products", w.mgr, dup)
	want(t, code, 409, body, "duplicate SKU (case-insensitive)")
	dupBarcode := map[string]any{"sku": "OTHER", "name": "Dup", "cost_price": 1, "selling_price": 2, "mrp": 3, "barcode": "8901234567890"}
	code, body = call(t, "POST", s+"/products", w.mgr, dupBarcode)
	want(t, code, 409, body, "duplicate barcode")
	code, body = call(t, "POST", s+"/products", w.mgr, map[string]any{"sku": "Z", "name": "Z", "cost_price": 5, "selling_price": 9, "mrp": 8})
	want(t, code, 422, body, "price above MRP")
	code, body = call(t, "POST", s+"/products", w.mgr, map[string]any{"sku": "Z2", "name": "Z", "cost_price": 5, "selling_price": 6, "mrp": 8, "stock": -1})
	want(t, code, 422, body, "negative stock")
	code, body = call(t, "PATCH", s+"/products/"+p["id"].(string), w.mgr, map[string]any{"selling_price": 25, "reason": "match market"})
	want(t, code, 200, body, "update")
	code, list := call(t, "GET", s+"/products?q=toned&page_size=1", w.viewer, nil)
	want(t, code, 200, list, "search")
	if list["total"] != float64(1) || len(list["data"].([]any)) != 1 {
		t.Fatalf("search result = %v", list)
	}
	code, audit := call(t, "GET", s+"/audit-logs?entity_type=products&entity_id="+p["id"].(string), w.mgr, nil)
	want(t, code, 200, audit, "audit")
	entries := audit["data"].([]any)
	if len(entries) < 2 || entries[0].(map[string]any)["reason"] != "match market" {
		t.Fatalf("audit entries = %v", entries)
	}
	code, body = call(t, "DELETE", s+"/products/"+p["id"].(string), w.mgr, nil)
	want(t, code, 204, body, "delete")
}

func TestBulkImport(t *testing.T) {
	w := newWorld(t)
	path := "/api/v1/stores/" + w.a1 + "/products/import"
	upload := func(csv string, fields map[string]string) (int, map[string]any) {
		var buf bytes.Buffer
		mw := multipart.NewWriter(&buf)
		fw, _ := mw.CreateFormFile("file", "products.csv")
		_, _ = fw.Write([]byte(csv))
		for k, v := range fields {
			_ = mw.WriteField(k, v)
		}
		_ = mw.Close()
		req := httptest.NewRequest("POST", path, &buf)
		req.Header.Set("Content-Type", mw.FormDataContentType())
		req.Header.Set("Authorization", "Bearer "+w.mgr)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		var out map[string]any
		_ = json.Unmarshal(rec.Body.Bytes(), &out)
		return rec.Code, out
	}
	bad := "sku,name,cost_price,selling_price,mrp,stock\nA-1,Alpha,10,12,15,5\nA-1,Alpha dup,10,12,15,5\nB-1,Beta,10,20,15,5\n"
	code, res := upload(bad, nil)
	want(t, code, 200, res, "import with errors")
	if res["committed"] != false || len(res["errors"].([]any)) != 2 {
		t.Fatalf("invalid import result = %v", res)
	}
	good := "SKU,Product Name,Cost,Price,MRP,Qty,Category\nA-1,Alpha,10,12,15,5,Snacks\nC-1,Gamma,\"1,000\",\"1,200\",1500,2,Snacks\n"
	code, res = upload(good, map[string]string{"dry_run": "true"})
	if code != 200 || res["committed"] != false || res["created"] != float64(2) {
		t.Fatalf("dry run = %d %v", code, res)
	}
	code, res = upload(good, nil)
	if code != 200 || res["committed"] != true || res["created"] != float64(2) {
		t.Fatalf("commit = %d %v", code, res)
	}
	code, res = upload("sku,name,cost_price,selling_price,mrp\nA-1,Alpha v2,10,13,15\n", map[string]string{"update_existing": "true"})
	if code != 200 || res["updated"] != float64(1) {
		t.Fatalf("upsert = %d %v", code, res)
	}
}

func TestSaleFlow(t *testing.T) {
	w := newWorld(t)
	s := "/stores/" + w.a1
	before := fakeAI.feedbacks
	code, sale := call(t, "POST", s+"/sales", w.mgr, map[string]any{"product_id": w.product, "quantity": 4})
	want(t, code, 201, sale, "record sale")
	if sale["unit_price"] != float64(100) || sale["profit"] != float64(80) {
		t.Fatalf("sale = %v", sale)
	}
	_, p := call(t, "GET", s+"/products/"+w.product, w.mgr, nil)
	if p["stock"] != float64(46) {
		t.Fatalf("stock after sale = %v", p["stock"])
	}
	code, body := call(t, "POST", s+"/sales", w.mgr, map[string]any{"product_id": w.product, "quantity": 1000})
	want(t, code, 422, body, "oversell")
	code, body = call(t, "POST", s+"/sales", w.mgr, map[string]any{"product_id": w.product, "quantity": 1, "unit_price": 500})
	want(t, code, 422, body, "sale above MRP")
	code, body = call(t, "POST", s+"/sales", w.viewer, map[string]any{"product_id": w.product, "quantity": 1})
	want(t, code, 403, body, "viewer records sale")
	_, mv := call(t, "GET", s+"/inventory/movements?product_id="+w.product, w.mgr, nil)
	first := mv["data"].([]any)[0].(map[string]any)
	if first["reason"] != "SALE" || first["change"] != float64(-4) {
		t.Fatalf("movement = %v", first)
	}
	deadline := time.Now().Add(3 * time.Second)
	for fakeAI.feedbacks == before && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
	}
	if fakeAI.feedbacks == before {
		t.Fatal("bandit feedback not sent")
	}
}

func TestRecommendationConstraintsAndWorkflow(t *testing.T) {
	w := newWorld(t)
	s := "/stores/" + w.a1

	// ML proposes +50%: the API must clamp to the band (+10% ⇒ 110) and say why.
	fakeAI.price = func(lo, hi, cur float64) float64 { return cur * 1.5 }
	code, rec := call(t, "POST", s+"/pricing/recommendations", w.analyst, map[string]any{"product_id": w.product})
	want(t, code, 201, rec, "generate")
	if rec["recommended_price"] != float64(110) {
		t.Fatalf("out-of-band ML price not enforced: %v", rec["recommended_price"])
	}
	cons, _ := rec["constraints_applied"].([]any)
	if len(cons) == 0 || cons[0].(map[string]any)["rule"] != "max_price_change" {
		t.Fatalf("constraints_applied = %v", rec["constraints_applied"])
	}
	id := rec["id"].(string)
	code, body := call(t, "POST", s+"/pricing/recommendations/"+id+"/apply", w.analyst, nil)
	want(t, code, 403, body, "analyst applies")
	code, body = call(t, "POST", s+"/pricing/recommendations/"+id+"/apply", w.mgr, map[string]any{"note": "approved in test"})
	want(t, code, 200, body, "manager applies")
	_, p := call(t, "GET", s+"/products/"+w.product, w.mgr, nil)
	if p["selling_price"] != float64(110) {
		t.Fatalf("price after apply = %v", p["selling_price"])
	}
	_, hist := callList(t, s+"/products/"+w.product+"/price-history?days=30", w.viewer)
	if hist[0]["source"] != "RECOMMENDATION" || hist[0]["reason"] != "approved in test" {
		t.Fatalf("price history = %v", hist[0])
	}

	// Stale recommendation: price changes before apply ⇒ 409 and EXPIRED.
	fakeAI.price = func(lo, hi, cur float64) float64 { return cur * 0.95 }
	_, rec2 := call(t, "POST", s+"/pricing/recommendations", w.analyst, map[string]any{"product_id": w.product})
	call(t, "PATCH", s+"/products/"+w.product, w.mgr, map[string]any{"selling_price": 105})
	code, body = call(t, "POST", s+"/pricing/recommendations/"+rec2["id"].(string)+"/apply", w.mgr, nil)
	want(t, code, 409, body, "stale apply")
	_, r2 := call(t, "GET", s+"/pricing/recommendations/"+rec2["id"].(string), w.viewer, nil)
	if r2["status"] != "EXPIRED" {
		t.Fatalf("stale recommendation status = %v", r2["status"])
	}
}

func TestPricingModes(t *testing.T) {
	w := newWorld(t)
	s := "/stores/" + w.a1
	_, st := call(t, "GET", s+"/settings", w.admin, nil)
	st["pricing_mode"] = "AUTOMATIC"
	code, body := call(t, "PUT", s+"/settings", w.admin, st)
	want(t, code, 200, body, "set AUTOMATIC")

	// +3% (below the 5% approval threshold) ⇒ applied by the system.
	fakeAI.price = func(lo, hi, cur float64) float64 { return cur * 1.03 }
	_, rec := call(t, "POST", s+"/pricing/recommendations", w.analyst, map[string]any{"product_id": w.product})
	if rec["status"] != "APPLIED" || rec["applied_by"] != nil {
		t.Fatalf("auto-apply = %v / %v", rec["status"], rec["applied_by"])
	}
	_, hist := callList(t, s+"/products/"+w.product+"/price-history?days=30", w.viewer)
	if hist[0]["source"] != "AUTOMATIC" {
		t.Fatalf("history source = %v", hist[0]["source"])
	}
	// +9% (above threshold) ⇒ pending manager approval.
	fakeAI.price = func(lo, hi, cur float64) float64 { return cur * 1.09 }
	_, rec = call(t, "POST", s+"/pricing/recommendations", w.analyst, map[string]any{"product_id": w.product})
	if rec["status"] != "PENDING" || rec["requires_approval"] != true {
		t.Fatalf("high-risk automatic = %v / %v", rec["status"], rec["requires_approval"])
	}
	code, body = call(t, "POST", s+"/pricing/recommendations/"+rec["id"].(string)+"/apply", w.mgr, nil)
	want(t, code, 409, body, "apply before approval")
	code, body = call(t, "POST", s+"/pricing/recommendations/"+rec["id"].(string)+"/approve", w.mgr, map[string]any{"apply_now": true})
	want(t, code, 200, body, "approve and apply")
	if body["status"] != "APPLIED" {
		t.Fatalf("status after approve+apply = %v", body["status"])
	}

	st["pricing_mode"] = "INVALID"
	code, body = call(t, "PUT", s+"/settings", w.admin, st)
	want(t, code, 422, body, "invalid mode")
}

func TestAIServiceUnavailable(t *testing.T) {
	w := newWorld(t)
	fakeAI.mu.Lock()
	fakeAI.down = true
	fakeAI.mu.Unlock()
	defer func() { fakeAI.mu.Lock(); fakeAI.down = false; fakeAI.mu.Unlock() }()
	code, body := call(t, "POST", "/stores/"+w.a1+"/pricing/recommendations", w.analyst, map[string]any{"product_id": w.product})
	if code != 502 && code != 503 {
		t.Fatalf("AI down: status %d (%v)", code, body)
	}
	code, _ = call(t, "GET", "/stores/"+w.a1+"/products", w.viewer, nil)
	want(t, code, 200, nil, "non-AI endpoints keep working")
}

func TestMembersAndEscalation(t *testing.T) {
	w := newWorld(t)
	org := "/organizations/" + w.orgA
	f := testutil.Fixture{DB: db, T: t}
	f.User("newbie@t.test")
	code, body := call(t, "POST", org+"/members", w.admin, map[string]any{"email": "newbie@t.test", "role": "SUPER_ADMIN"})
	want(t, code, 422, body, "grant SUPER_ADMIN")
	code, m := call(t, "POST", org+"/members", w.admin, map[string]any{"email": "newbie@t.test", "role": "ANALYST", "store_id": w.a1})
	want(t, code, 201, m, "add member")
	code, body = call(t, "POST", org+"/members", w.admin, map[string]any{"email": "nobody@t.test", "role": "VIEWER"})
	want(t, code, 404, body, "unknown user")
	_, members := callList(t, org+"/members", w.admin)
	var adminMembership string
	for _, mm := range members {
		if mm["role"] == "ADMIN" {
			adminMembership = mm["membership_id"].(string)
		}
	}
	code, body = call(t, "PATCH", org+"/members/"+adminMembership, w.admin, map[string]any{"role": "VIEWER"})
	want(t, code, 409, body, "demote the last admin")
}

func callList(t *testing.T, path, token string) (int, []map[string]any) {
	t.Helper()
	req := httptest.NewRequest("GET", "/api/v1"+path, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	var out []map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("%s: %d %s", path, rec.Code, rec.Body.String())
	}
	return rec.Code, out
}

// Seasonal considerations: managers write, viewers read, other tenants see
// nothing, and a product from another store cannot be targeted.
func TestSeasonalConsiderations(t *testing.T) {
	w := newWorld(t)
	s := "/stores/" + w.a1 + "/seasonal/considerations"
	body := map[string]any{"name": "Diwali week", "kind": "FESTIVAL", "product_id": w.product,
		"start_date": "2026-11-04", "end_date": "2026-11-09", "expected_demand_change_pct": 30, "supply_condition": "LIMITED"}

	code, out := call(t, "POST", s, w.viewer, body)
	want(t, code, 403, out, "viewer creating a consideration")
	code, out = call(t, "POST", s, w.analyst, body)
	want(t, code, 403, out, "analyst creating a consideration")
	code, out = call(t, "POST", s, w.mgr, body)
	want(t, code, 201, out, "manager creating a consideration")
	id, _ := out["id"].(string)
	if out["scope"] != "PRODUCT" || out["supply_condition"] != "LIMITED" || id == "" {
		t.Fatalf("unexpected consideration: %v", out)
	}

	code, list := callList(t, s, w.viewer)
	if code != 200 || len(list) != 1 {
		t.Fatalf("viewer list: %d %v", code, list)
	}
	code, out = call(t, "GET", s, w.outsider, nil)
	want(t, code, 404, out, "other org listing considerations")

	// Validation: end before start, no effect, both product and category, foreign product.
	bad := map[string]any{"name": "x", "kind": "SEASON", "start_date": "2026-11-09", "end_date": "2026-11-04", "expected_demand_change_pct": 10}
	code, out = call(t, "POST", s, w.mgr, bad)
	want(t, code, 422, out, "end before start")
	bad = map[string]any{"name": "x", "kind": "SEASON", "start_date": "2026-11-04", "end_date": "2026-11-09"}
	code, out = call(t, "POST", s, w.mgr, bad)
	want(t, code, 422, out, "no demand change and normal supply")
	body["expected_demand_change_pct"] = 500
	code, out = call(t, "POST", s, w.mgr, body)
	want(t, code, 422, out, "demand change out of range")
	body["expected_demand_change_pct"] = 30
	code, out = call(t, "POST", "/stores/"+w.a2+"/seasonal/considerations", w.admin, body)
	want(t, code, 422, out, "product of another store")

	body["expected_demand_change_pct"] = 15
	code, out = call(t, "PUT", s+"/"+id, w.mgr, body)
	want(t, code, 200, out, "manager updating")
	if out["expected_demand_change_pct"].(float64) != 15 {
		t.Fatalf("update not applied: %v", out)
	}
	code, out = call(t, "DELETE", s+"/"+id, w.viewer, nil)
	want(t, code, 403, out, "viewer deleting")
	code, out = call(t, "DELETE", s+"/"+id, w.mgr, nil)
	want(t, code, 204, out, "manager deleting")
}
