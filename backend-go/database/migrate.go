package database

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
)

// Migrate applies every *.sql file in dir (lexical order) that has not been
// recorded in public.schema_migrations. Each file runs in its own transaction.
//
// The same files live in supabase/migrations, so `supabase db push` can be
// used instead of this runner — but pick one per database, not both.
func (d *DB) Migrate(ctx context.Context, dir string) ([]string, error) {
	if _, err := d.Pool.Exec(ctx, `create table if not exists public.schema_migrations (
		version text primary key, applied_at timestamptz not null default now())`); err != nil {
		return nil, fmt.Errorf("create schema_migrations: %w", err)
	}
	files, err := filepath.Glob(filepath.Join(dir, "*.sql"))
	if err != nil {
		return nil, err
	}
	if len(files) == 0 {
		return nil, fmt.Errorf("no migrations found in %s", dir)
	}
	sort.Strings(files)

	var applied []string
	for _, f := range files {
		version := strings.TrimSuffix(filepath.Base(f), ".sql")
		var exists bool
		if err := d.Pool.QueryRow(ctx, "select exists(select 1 from public.schema_migrations where version=$1)", version).Scan(&exists); err != nil {
			return applied, err
		}
		if exists {
			continue
		}
		body, err := os.ReadFile(f)
		if err != nil {
			return applied, err
		}
		err = pgx.BeginFunc(ctx, d.Pool, func(tx pgx.Tx) error {
			// Simple protocol so a file may contain many statements.
			if _, err := tx.Exec(ctx, string(body), pgx.QueryExecModeSimpleProtocol); err != nil {
				return err
			}
			_, err := tx.Exec(ctx, "insert into public.schema_migrations(version) values ($1)", version)
			return err
		})
		if err != nil {
			return applied, fmt.Errorf("migration %s: %w", version, err)
		}
		slog.Info("migration applied", "version", version)
		applied = append(applied, version)
	}
	return applied, nil
}

// ApplyFile runs a SQL file once outside the migration ledger (used for the
// local auth shim, which must never be applied to Supabase).
func (d *DB) ApplyFile(ctx context.Context, path string) error {
	body, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	_, err = d.Pool.Exec(ctx, string(body), pgx.QueryExecModeSimpleProtocol)
	return err
}
