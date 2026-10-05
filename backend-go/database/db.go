// Package database owns the PostgreSQL connection pool and the transaction
// helpers that make Row Level Security apply to API queries.
//
// Two execution contexts exist:
//
//   - WithUser: runs inside a transaction that switches to the Supabase
//     `authenticated` role and publishes the caller's JWT claims through
//     request.jwt.claims. auth.uid() and every RLS policy therefore see the
//     real end user, exactly as they would for a PostgREST request.
//   - WithSystem: runs as the connecting (owner/service) role, bypassing RLS.
//     Only background workers, seeding and trusted internal flows use it.
package database

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Querier is satisfied by *pgxpool.Pool and pgx.Tx.
type Querier interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// Identity is the authenticated caller whose claims are forwarded to Postgres.
type Identity struct {
	UserID string
	Email  string
}

type DB struct {
	Pool *pgxpool.Pool
}

// Connect creates a pool. Supabase's transaction pooler (port 6543) hands every
// transaction to a different server connection, so named prepared statements
// cannot be relied on. CacheDescribe still asks the server for parameter types
// (needed to send []byte as jsonb rather than bytea) but uses only the unnamed
// statement. Cached descriptions assume a stable schema: restart the API
// after applying migrations.
func Connect(ctx context.Context, dsn string, maxConns int32) (*DB, error) {
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("parse DATABASE_URL: %w", err)
	}
	if maxConns > 0 {
		cfg.MaxConns = maxConns
	}
	cfg.MaxConnIdleTime = 5 * time.Minute
	cfg.HealthCheckPeriod = time.Minute
	if isTransactionPooler(dsn) {
		cfg.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeCacheDescribe
	}
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	pingCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("database ping: %w", err)
	}
	return &DB{Pool: pool}, nil
}

func isTransactionPooler(dsn string) bool {
	u, err := url.Parse(dsn)
	if err != nil {
		return false
	}
	return u.Port() == "6543" || strings.Contains(u.Host, "pooler.supabase.com") && u.Port() != "5432"
}

func (d *DB) Close() { d.Pool.Close() }

// WithUser executes fn in a transaction scoped to the given end user so that
// RLS policies are enforced by PostgreSQL itself.
func (d *DB) WithUser(ctx context.Context, id Identity, fn func(pgx.Tx) error) error {
	if id.UserID == "" {
		return errors.New("database: WithUser requires a user id")
	}
	claims, _ := json.Marshal(map[string]string{
		"sub":   id.UserID,
		"email": id.Email,
		"role":  "authenticated",
		"aud":   "authenticated",
	})
	return pgx.BeginFunc(ctx, d.Pool, func(tx pgx.Tx) error {
		// One statement (= SET LOCAL ROLE authenticated + SET LOCAL
		// request.jwt.claims): with a hosted database every statement is a
		// network round trip, and this runs on every API request.
		if _, err := tx.Exec(ctx, "select set_config('role', 'authenticated', true), set_config('request.jwt.claims', $1, true)",
			string(claims)); err != nil {
			return fmt.Errorf("set role and claims: %w", err)
		}
		return fn(tx)
	})
}

// WithSystem executes fn in a transaction as the service role (RLS bypassed).
func (d *DB) WithSystem(ctx context.Context, fn func(pgx.Tx) error) error {
	return pgx.BeginFunc(ctx, d.Pool, fn)
}

// SetLocal sets a transaction-local configuration value (e.g. app.audit_reason)
// that the audit / price-history / stock-movement triggers read.
func SetLocal(ctx context.Context, q Querier, key, value string) error {
	_, err := q.Exec(ctx, "select set_config($1, $2, true)", key, value)
	return err
}

// ── Error classification ────────────────────────────────────────────────────

// PgCode returns the SQLSTATE of a PostgreSQL error, or "".
func PgCode(err error) string {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code
	}
	return ""
}

// PgConstraint returns the violated constraint name, or "".
func PgConstraint(err error) string {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.ConstraintName
	}
	return ""
}

const (
	CodeUniqueViolation     = "23505"
	CodeForeignKeyViolation = "23503"
	CodeCheckViolation      = "23514"
	CodeNotNullViolation    = "23502"
	CodeInsufficientPriv    = "42501" // includes RLS "new row violates row-level security policy"
	CodeInvalidText         = "22P02"
)

func IsNotFound(err error) bool { return errors.Is(err, pgx.ErrNoRows) }
