package database_test

import (
	"context"
	"fmt"
	"os"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/rishabh26raj/priceiq/backend-go/database"
	"github.com/rishabh26raj/priceiq/backend-go/internal/testutil"
)

var testDB *database.DB

func TestMain(m *testing.M) {
	db, stop, err := testutil.StartDB()
	if err != nil {
		fmt.Fprintln(os.Stderr, "test database:", err)
		os.Exit(1)
	}
	testDB = db
	code := m.Run()
	stop()
	os.Exit(code)
}

// world is a two-organization fixture:
//
//	org A: stores A1, A2   adminA (org-wide ADMIN), mgrA1 (MANAGER @A1), viewerA2 (VIEWER @A2), analystA (org ANALYST)
//	org B: store  B1       adminB (org-wide ADMIN)
type world struct {
	f                                         testutil.Fixture
	orgA, orgB, a1, a2, b1                    string
	adminA, mgrA1, viewerA2, analystA, adminB string
	pA1, pA2, pB1                             string
}

func newWorld(t *testing.T) *world {
	f := testutil.Fixture{DB: testDB, T: t}
	w := &world{f: f}
	w.orgA, w.orgB = f.Org("org-a"), f.Org("org-b")
	w.a1, w.a2, w.b1 = f.Store(w.orgA, "A1"), f.Store(w.orgA, "A2"), f.Store(w.orgB, "B1")
	suffix := t.Name()
	w.adminA = f.User("adminA-" + suffix + "@x.test")
	w.mgrA1 = f.User("mgrA1-" + suffix + "@x.test")
	w.viewerA2 = f.User("viewerA2-" + suffix + "@x.test")
	w.analystA = f.User("analystA-" + suffix + "@x.test")
	w.adminB = f.User("adminB-" + suffix + "@x.test")
	f.Member(w.adminA, w.orgA, "", "ADMIN")
	f.Member(w.mgrA1, w.orgA, w.a1, "STORE_MANAGER")
	f.Member(w.viewerA2, w.orgA, w.a2, "VIEWER")
	f.Member(w.analystA, w.orgA, "", "ANALYST")
	f.Member(w.adminB, w.orgB, "", "ADMIN")
	w.pA1 = f.Product(w.a1, "SKU-A1", 10, 15, 20, 50)
	w.pA2 = f.Product(w.a2, "SKU-A2", 10, 15, 20, 50)
	w.pB1 = f.Product(w.b1, "SKU-B1", 10, 15, 20, 50)
	return w
}

func countVisible(t *testing.T, w *world, user, sql string, args ...any) int {
	t.Helper()
	var n int
	if err := w.f.As(user, func(tx pgx.Tx) error { return tx.QueryRow(context.Background(), sql, args...).Scan(&n) }); err != nil {
		t.Fatalf("query as %s: %v", user, err)
	}
	return n
}

func TestRLS_ProductVisibilityIsStoreScoped(t *testing.T) {
	w := newWorld(t)
	q := "select count(*) from products where id = any($1)"
	all := []string{w.pA1, w.pA2, w.pB1}
	cases := []struct {
		name string
		user string
		want int
	}{
		{"org admin sees both stores of own org", w.adminA, 2},
		{"store manager sees only own store", w.mgrA1, 1},
		{"store viewer sees only own store", w.viewerA2, 1},
		{"org analyst sees both stores", w.analystA, 2},
		{"other org admin sees only own org", w.adminB, 1},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := countVisible(t, w, c.user, q, all); got != c.want {
				t.Fatalf("visible products = %d, want %d", got, c.want)
			}
		})
	}
	if n := countVisible(t, w, w.mgrA1, "select count(*) from products where id=$1", w.pA2); n != 0 {
		t.Fatal("manager of A1 can read a product of A2")
	}
	if n := countVisible(t, w, w.adminB, "select count(*) from stores where organization_id=$1", w.orgA); n != 0 {
		t.Fatal("org B admin can see org A stores")
	}
}

func TestRLS_WritesRequireRoleOnTargetStore(t *testing.T) {
	w := newWorld(t)
	ctx := context.Background()

	// Viewer cannot update (row filtered ⇒ 0 rows affected).
	_ = w.f.As(w.viewerA2, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, "update products set stock = 1 where id=$1", w.pA2)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if tag.RowsAffected() != 0 {
			t.Fatal("viewer updated a product")
		}
		return nil
	})

	// Manager of A1 cannot create a product in A2.
	err := w.f.As(w.mgrA1, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `insert into products(store_id, sku, name, cost_price, selling_price, mrp)
			values ($1,'X','X',1,2,3)`, w.a2)
		return err
	})
	if database.PgCode(err) != database.CodeInsufficientPriv {
		t.Fatalf("cross-store insert: want RLS violation, got %v", err)
	}

	// Manager of A1 can create in A1.
	if err := w.f.As(w.mgrA1, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `insert into products(store_id, sku, name, cost_price, selling_price, mrp)
			values ($1,'NEW','New',1,2,3)`, w.a1)
		return err
	}); err != nil {
		t.Fatalf("own-store insert: %v", err)
	}

	// Other-org admin cannot modify org A data.
	_ = w.f.As(w.adminB, func(tx pgx.Tx) error {
		tag, _ := tx.Exec(ctx, "update products set selling_price = 16 where id=$1", w.pA1)
		if tag.RowsAffected() != 0 {
			t.Fatal("org B admin modified org A product")
		}
		tag, _ = tx.Exec(ctx, "delete from products where id=$1", w.pA1)
		if tag.RowsAffected() != 0 {
			t.Fatal("org B admin deleted org A product")
		}
		return nil
	})
}

func TestRLS_SaleCannotReferenceProductOfAnotherStore(t *testing.T) {
	w := newWorld(t)
	err := w.f.As(w.mgrA1, func(tx pgx.Tx) error {
		_, err := tx.Exec(context.Background(),
			"insert into sales(store_id, product_id, quantity, unit_price, unit_cost) values ($1,$2,1,15,10)", w.a1, w.pA2)
		return err
	})
	if err == nil {
		t.Fatal("sale in A1 referencing A2 product was accepted")
	}
}

func TestRLS_NoPrivilegeEscalation(t *testing.T) {
	w := newWorld(t)
	ctx := context.Background()

	// A store manager cannot grant memberships.
	err := w.f.As(w.mgrA1, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, "insert into memberships(user_id, organization_id, role) values ($1,$2,'ADMIN')", w.mgrA1, w.orgA)
		return err
	})
	if database.PgCode(err) != database.CodeInsufficientPriv {
		t.Fatalf("manager self-promotion: want RLS violation, got %v", err)
	}

	// An org admin cannot grant SUPER_ADMIN.
	err = w.f.As(w.adminA, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, "insert into memberships(user_id, organization_id, role) values ($1,$2,'SUPER_ADMIN')", w.viewerA2, w.orgA)
		return err
	})
	if database.PgCode(err) != database.CodeInsufficientPriv {
		t.Fatalf("grant SUPER_ADMIN: want RLS violation, got %v", err)
	}

	// An org admin cannot attach a membership to another org's store.
	err = w.f.As(w.adminA, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, "insert into memberships(user_id, organization_id, store_id, role) values ($1,$2,$3,'VIEWER')",
			w.viewerA2, w.orgA, w.b1)
		return err
	})
	if database.PgCode(err) != database.CodeInsufficientPriv {
		t.Fatalf("foreign store membership: want RLS violation, got %v", err)
	}

	// Nobody can flip their own is_super_admin flag.
	err = w.f.As(w.adminA, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, "update profiles set is_super_admin = true where id = $1", w.adminA)
		return err
	})
	if database.PgCode(err) != database.CodeInsufficientPriv {
		t.Fatalf("self super-admin: want permission denied, got %v", err)
	}

	// Org admin CAN manage memberships in their own org.
	if err := w.f.As(w.adminA, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, "update memberships set role='ANALYST' where user_id=$1 and organization_id=$2", w.viewerA2, w.orgA)
		return err
	}); err != nil {
		t.Fatalf("admin role change: %v", err)
	}
}

func TestTriggers_AuditAndPriceHistoryAttributeTheUser(t *testing.T) {
	w := newWorld(t)
	ctx := context.Background()
	err := w.f.As(w.mgrA1, func(tx pgx.Tx) error {
		if err := database.SetLocal(ctx, tx, "app.audit_reason", "competitor undercut"); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, "update products set selling_price = 14.5, stock = 40 where id=$1", w.pA1)
		return err
	})
	if err != nil {
		t.Fatal(err)
	}

	var changedBy, reason string
	var oldP, newP float64
	if err := testDB.Pool.QueryRow(ctx, `select changed_by::text, reason, old_price, new_price from pricing_history
		where product_id=$1 and old_price is not null order by created_at desc limit 1`, w.pA1).
		Scan(&changedBy, &reason, &oldP, &newP); err != nil {
		t.Fatal(err)
	}
	if changedBy != w.mgrA1 || reason != "competitor undercut" || oldP != 15 || newP != 14.5 {
		t.Fatalf("pricing_history = %s %q %v→%v", changedBy, reason, oldP, newP)
	}

	var auditUser string
	var oldVal, newVal map[string]any
	if err := testDB.Pool.QueryRow(ctx, `select user_id::text, old_value, new_value from audit_logs
		where entity_type='products' and entity_id=$1 and action='update' order by id desc limit 1`, w.pA1).
		Scan(&auditUser, &oldVal, &newVal); err != nil {
		t.Fatal(err)
	}
	if auditUser != w.mgrA1 || newVal["stock"] != float64(40) || oldVal["stock"] != float64(50) {
		t.Fatalf("audit = %s old=%v new=%v", auditUser, oldVal, newVal)
	}
	if _, ok := newVal["name"]; ok {
		t.Fatal("audit stored unchanged columns")
	}

	var reasonMv string
	var change int
	if err := testDB.Pool.QueryRow(ctx, `select reason, change from inventory_movements where product_id=$1
		order by created_at desc limit 1`, w.pA1).Scan(&reasonMv, &change); err != nil {
		t.Fatal(err)
	}
	if reasonMv != "ADJUSTMENT" || change != -10 {
		t.Fatalf("movement = %s %d", reasonMv, change)
	}

	// Audit logs are append-only for users.
	err = w.f.As(w.adminA, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, "delete from audit_logs")
		return err
	})
	if database.PgCode(err) != database.CodeInsufficientPriv {
		t.Fatalf("audit delete: want permission denied, got %v", err)
	}
	// Viewers cannot read audit logs; the store manager can.
	if n := countVisible(t, w, w.viewerA2, "select count(*) from audit_logs"); n != 0 {
		t.Fatalf("viewer sees %d audit rows", n)
	}
	if n := countVisible(t, w, w.mgrA1, "select count(*) from audit_logs where store_id=$1", w.a1); n == 0 {
		t.Fatal("manager cannot see own store audit rows")
	}
	if n := countVisible(t, w, w.mgrA1, "select count(*) from audit_logs where store_id=$1", w.a2); n != 0 {
		t.Fatal("manager sees another store's audit rows")
	}
}

func TestSignupTriggerCreatesOrganizationForStoreOwner(t *testing.T) {
	ctx := context.Background()
	var uid string
	if err := testDB.Pool.QueryRow(ctx, `insert into auth.users(email, raw_user_meta_data)
		values ('owner-signup@x.test', '{"full_name":"Owner","store_name":"Sharma General Store","city":"Pune","pincode":"411001"}')
		returning id`).Scan(&uid); err != nil {
		t.Fatal(err)
	}
	var role, storeName, city string
	var settings int
	if err := testDB.Pool.QueryRow(ctx, `select m.role::text, s.name, s.city,
		(select count(*) from store_settings ss where ss.store_id = s.id)
		from memberships m join stores s on s.organization_id = m.organization_id where m.user_id=$1`, uid).
		Scan(&role, &storeName, &city, &settings); err != nil {
		t.Fatal(err)
	}
	if role != "ADMIN" || storeName != "Sharma General Store" || city != "Pune" || settings != 1 {
		t.Fatalf("signup provisioning: role=%s store=%s city=%s settings=%d", role, storeName, city, settings)
	}
}

func TestDataIntegrityConstraints(t *testing.T) {
	w := newWorld(t)
	ctx := context.Background()
	bad := []struct {
		name string
		sql  string
		args []any
	}{
		{"price above MRP", "update products set selling_price = 25 where id=$1", []any{w.pA1}},
		{"negative stock", "update products set stock = -1 where id=$1", []any{w.pA1}},
		{"negative cost", "update products set cost_price = -1 where id=$1", []any{w.pA1}},
		{"duplicate SKU", "insert into products(store_id, sku, name, cost_price, selling_price, mrp) values ($1,'SKU-A1','dup',1,2,3)", []any{w.a1}},
		{"zero quantity sale", "insert into sales(store_id, product_id, quantity, unit_price, unit_cost) values ($1,$2,0,15,10)", []any{w.a1, w.pA1}},
	}
	for _, b := range bad {
		t.Run(b.name, func(t *testing.T) {
			_, err := testDB.Pool.Exec(ctx, b.sql, b.args...)
			if err == nil {
				t.Fatal("accepted invalid data")
			}
		})
	}
	// Barcodes are unique per store but may repeat across stores.
	_, err := testDB.Pool.Exec(ctx, "update products set barcode='8901234567890' where id = any($1)", []string{w.pA1, w.pA2})
	if err != nil {
		t.Fatalf("same barcode in different stores rejected: %v", err)
	}
	_, err = testDB.Pool.Exec(ctx, `insert into products(store_id, sku, name, barcode, cost_price, selling_price, mrp)
		values ($1,'OTHER','o','8901234567890',1,2,3)`, w.a1)
	if database.PgCode(err) != database.CodeUniqueViolation {
		t.Fatalf("duplicate barcode in store: want unique violation, got %v", err)
	}
}

// Regression: deleting an organization cascades through audited tables; the
// audit rows written during the cascade must not block the delete, and they
// must survive it.
func TestOrganizationDeleteKeepsAuditTrail(t *testing.T) {
	w := newWorld(t)
	ctx := context.Background()
	if _, err := testDB.Pool.Exec(ctx, "delete from organizations where id=$1", w.orgA); err != nil {
		t.Fatalf("organization delete failed: %v", err)
	}
	var n int
	_ = testDB.Pool.QueryRow(ctx, "select count(*) from audit_logs where organization_id=$1 and action='delete'", w.orgA).Scan(&n)
	if n == 0 {
		t.Fatal("no audit rows kept for the deleted organization")
	}
}
