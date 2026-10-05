// Package services implements business logic on top of repositories.
// Every user-initiated operation runs in database.WithUser so PostgreSQL RLS
// enforces tenant isolation in addition to the RBAC middleware.
package services

import (
	"context"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/rishabh26raj/priceiq/backend-go/clients"
	"github.com/rishabh26raj/priceiq/backend-go/config"
	"github.com/rishabh26raj/priceiq/backend-go/database"
	"github.com/rishabh26raj/priceiq/backend-go/middleware"
)

type Service struct {
	Cfg      *config.Config
	DB       *database.DB
	Cache    clients.Cache
	AI       *clients.AIClient
	Roles    *middleware.RoleResolver
	Verifier *middleware.Verifier
	Mailer   *clients.Mailer
}

// userTx runs fn as the user, attaching an optional audit reason.
func (s *Service) userTx(ctx context.Context, id database.Identity, reason string, fn func(pgx.Tx) error) error {
	return s.DB.WithUser(ctx, id, func(tx pgx.Tx) error {
		if r := strings.TrimSpace(reason); r != "" {
			if err := database.SetLocal(ctx, tx, "app.audit_reason", truncate(r, 500)); err != nil {
				return err
			}
		}
		return fn(tx)
	})
}

// invalidate bumps the store's cache version after a write.
func (s *Service) invalidate(ctx context.Context, storeID string) {
	clients.BumpStoreVersion(ctx, s.Cache, storeID)
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

func strPtr(s string) *string { return &s }

func trimPtr(p *string) *string {
	if p == nil {
		return nil
	}
	t := strings.TrimSpace(*p)
	if t == "" {
		return nil
	}
	return &t
}

func deref[T any](p *T, def T) T {
	if p == nil {
		return def
	}
	return *p
}
