// Package testutil provides a migrated PostgreSQL database for integration
// tests. It uses TEST_DATABASE_URL when set (the database must be disposable),
// otherwise it starts an embedded PostgreSQL 16 on a free port, applies the
// local auth shim and all migrations, and tears it down after the tests.
package testutil

import (
	"context"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	ep "github.com/fergusstrange/embedded-postgres"
	"github.com/jackc/pgx/v5"

	"github.com/rishabh26raj/priceiq/backend-go/database"
)

// RepoRoot returns the repository root (parent of backend-go).
func RepoRoot() string {
	_, file, _, _ := runtime.Caller(0)
	return filepath.Clean(filepath.Join(filepath.Dir(file), "..", "..", ".."))
}

// StartDB returns a migrated database and a stop function. Call it from
// TestMain so the (slow) startup happens once per package.
func StartDB() (*database.DB, func(), error) {
	ctx := context.Background()
	root := RepoRoot()
	dsn := os.Getenv("TEST_DATABASE_URL")
	stop := func() {}

	if dsn == "" {
		port, err := freePort()
		if err != nil {
			return nil, nil, err
		}
		tmp, err := os.MkdirTemp("", "priceiq-testdb-")
		if err != nil {
			return nil, nil, err
		}
		home, _ := os.UserHomeDir()
		pg := ep.NewDatabase(ep.DefaultConfig().
			Version(ep.V16).Port(uint32(port)).Database("priceiq_test").Encoding("UTF8").Locale("C").
			RuntimePath(filepath.Join(tmp, "runtime")).
			DataPath(filepath.Join(tmp, "data")).
			BinariesPath(filepath.Join(tmp, "bin")).
			CachePath(filepath.Join(home, ".cache", "embedded-postgres")).
			Logger(io.Discard))
		if err := pg.Start(); err != nil {
			return nil, nil, fmt.Errorf("embedded postgres: %w", err)
		}
		stop = func() { _ = pg.Stop(); _ = os.RemoveAll(tmp) }
		dsn = fmt.Sprintf("postgres://postgres:postgres@localhost:%d/priceiq_test?sslmode=disable", port)
	}

	db, err := database.Connect(ctx, dsn, 8)
	if err != nil {
		stop()
		return nil, nil, err
	}
	var hasAuth bool
	_ = db.Pool.QueryRow(ctx, "select exists(select 1 from pg_namespace where nspname='auth')").Scan(&hasAuth)
	if !hasAuth {
		if err := db.ApplyFile(ctx, filepath.Join(root, "supabase", "local", "00_auth_shim.sql")); err != nil {
			db.Close()
			stop()
			return nil, nil, fmt.Errorf("auth shim: %w", err)
		}
	}
	if _, err := db.Migrate(ctx, filepath.Join(root, "supabase", "migrations")); err != nil {
		db.Close()
		stop()
		return nil, nil, err
	}
	return db, func() { db.Close(); stop() }, nil
}

func freePort() (int, error) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port, nil
}

// ── Fixture helpers (run as the service role) ───────────────────────────────

type Fixture struct {
	DB *database.DB
	T  testing.TB
}

func (f Fixture) exec(sql string, args ...any) string {
	f.T.Helper()
	var id string
	if err := f.DB.Pool.QueryRow(context.Background(), sql, args...).Scan(&id); err != nil {
		f.T.Fatalf("fixture %q: %v", sql, err)
	}
	return id
}

func (f Fixture) Org(name string) string {
	return f.exec("insert into organizations(name, slug) values ($1, $1 || '-' || gen_random_uuid()) returning id", name)
}

func (f Fixture) Store(orgID, code string) string {
	return f.exec("insert into stores(organization_id, name, code) values ($1, $2, $2) returning id", orgID, code)
}

// User creates an auth user (+ profile via trigger) and returns its id.
func (f Fixture) User(email string) string {
	return f.exec("insert into auth.users(email, encrypted_password) values ($1, crypt('pw-123456', gen_salt('bf', 4))) returning id", email)
}

// Member grants a role; storeID "" ⇒ org-wide.
func (f Fixture) Member(userID, orgID, storeID, role string) {
	f.T.Helper()
	var sid any
	if storeID != "" {
		sid = storeID
	}
	if _, err := f.DB.Pool.Exec(context.Background(),
		"insert into memberships(user_id, organization_id, store_id, role) values ($1,$2,$3,$4)",
		userID, orgID, sid, role); err != nil {
		f.T.Fatalf("member: %v", err)
	}
}

func (f Fixture) Product(storeID, sku string, cost, price, mrp float64, stock int) string {
	return f.exec(`insert into products(store_id, sku, name, cost_price, selling_price, mrp, stock)
		values ($1,$2,$2,$3,$4,$5,$6) returning id`, storeID, sku, cost, price, mrp, stock)
}

// As runs fn as the given user with RLS enforced.
func (f Fixture) As(userID string, fn func(pgx.Tx) error) error {
	return f.DB.WithUser(context.Background(), database.Identity{UserID: userID}, fn)
}
