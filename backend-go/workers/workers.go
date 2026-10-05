// Package workers runs periodic background jobs:
//
//   - alert scan          detect inventory / competitor / demand / pricing alerts
//   - competitor refresh  re-fetch prices for linked competitor listings
//   - automatic pricing   generate & apply low-risk prices for AUTOMATIC stores
//   - ML refresh          recompute elasticities and cross-product effects
//
// Each job takes a cache lock per tick so that several API instances sharing
// Redis do not run the same job concurrently.
package workers

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/rishabh26raj/priceiq/backend-go/database"
	"github.com/rishabh26raj/priceiq/backend-go/services"
)

type Runner struct {
	S  *services.Service
	wg sync.WaitGroup
}

// Start launches all jobs; they stop when ctx is cancelled.
func (r *Runner) Start(ctx context.Context) {
	cfg := r.S.Cfg
	r.every(ctx, "alert-scan", cfg.AlertScanInterval, 30*time.Second, r.alertScan)
	r.every(ctx, "competitor-refresh", cfg.CompetitorRefreshInterval, 2*time.Minute, r.competitorRefresh)
	r.every(ctx, "auto-pricing", cfg.AutoPricingInterval, 3*time.Minute, r.autoPricing)
	r.every(ctx, "ml-refresh", cfg.MLRefreshInterval, 90*time.Second, r.mlRefresh)
}

// Wait blocks until all jobs have returned.
func (r *Runner) Wait() { r.wg.Wait() }

// every runs job on a fixed interval after an initial delay. The cache lock
// (TTL = half the interval) makes the job single-flight across API instances
// that share Redis; with the in-memory cache it only guards this process.
func (r *Runner) every(ctx context.Context, name string, interval, initialDelay time.Duration, job func(context.Context) error) {
	if interval <= 0 {
		return
	}
	r.wg.Add(1)
	go func() {
		defer r.wg.Done()
		timer := time.NewTimer(initialDelay)
		defer timer.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-timer.C:
			}
			if ok, _ := r.S.Cache.Lock(ctx, "lock:job:"+name, interval/2); ok {
				start := time.Now()
				jctx, cancel := context.WithTimeout(ctx, interval)
				err := job(jctx)
				cancel()
				if err != nil && ctx.Err() == nil {
					slog.Warn("job failed", "job", name, "err", err, "ms", time.Since(start).Milliseconds())
				} else {
					slog.Info("job done", "job", name, "ms", time.Since(start).Milliseconds())
				}
			}
			timer.Reset(interval)
		}
	}()
}

func (r *Runner) activeStores(ctx context.Context, where string) ([]string, error) {
	var ids []string
	err := r.S.DB.WithSystem(ctx, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, "select s.id from stores s join store_settings ss on ss.store_id = s.id where s.is_active "+where)
		if err != nil {
			return err
		}
		ids, err = pgx.CollectRows(rows, pgx.RowTo[string])
		return err
	})
	return ids, err
}

func (r *Runner) alertScan(ctx context.Context) error {
	stores, err := r.activeStores(ctx, "")
	if err != nil {
		return err
	}
	for _, id := range stores {
		res, err := r.S.ScanStore(ctx, id)
		if err != nil {
			slog.Warn("alert scan failed", "store", id, "err", err)
			continue
		}
		slog.Info("alert scan", "store", id, "detected", res.Detected, "created", res.Created, "resolved", res.Resolved)
	}
	return nil
}

func (r *Runner) competitorRefresh(ctx context.Context) error {
	var pairs [][2]string
	err := r.S.DB.WithSystem(ctx, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `select distinct cp.store_id, cp.product_id from competitor_products cp
			join stores s on s.id = cp.store_id where s.is_active and cp.url is not null`)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var a, b string
			if err := rows.Scan(&a, &b); err != nil {
				return err
			}
			pairs = append(pairs, [2]string{a, b})
		}
		return rows.Err()
	})
	if err != nil {
		return err
	}
	sem := make(chan struct{}, 4) // bounded concurrency towards the scraper
	var wg sync.WaitGroup
	for _, p := range pairs {
		wg.Add(1)
		go func(storeID, productID string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			if err := r.S.AI.Post(ctx, "/v1/competitors/refresh", map[string]any{"store_id": storeID, "product_id": productID}, nil, ""); err != nil {
				slog.Warn("competitor refresh failed", "product", productID, "err", err)
			}
		}(p[0], p[1])
	}
	wg.Wait()
	return nil
}

// autoPricing generates recommendations for AUTOMATIC stores. It acts as the
// store's first org admin so every generated row is attributable and still
// passes RLS; low-risk changes are then applied by the system.
func (r *Runner) autoPricing(ctx context.Context) error {
	stores, err := r.activeStores(ctx, "and ss.pricing_mode = 'AUTOMATIC'")
	if err != nil {
		return err
	}
	for _, storeID := range stores {
		var actor, email string
		var productIDs []string
		err := r.S.DB.WithSystem(ctx, func(tx pgx.Tx) error {
			if err := tx.QueryRow(ctx, `select m.user_id, coalesce(p.email,'') from memberships m join stores s on s.organization_id = m.organization_id
				join profiles p on p.id = m.user_id
				where s.id = $1 and m.store_id is null and m.role >= 'ADMIN' order by m.created_at limit 1`, storeID).Scan(&actor, &email); err != nil {
				return err
			}
			rows, err := tx.Query(ctx, `select p.id from products p where p.store_id=$1 and p.is_active and p.stock > 0
				and not exists (select 1 from pricing_recommendations r where r.product_id = p.id and r.created_at > now() - interval '6 hours')`, storeID)
			if err != nil {
				return err
			}
			productIDs, err = pgx.CollectRows(rows, pgx.RowTo[string])
			return err
		})
		if err != nil {
			slog.Warn("auto pricing skipped", "store", storeID, "err", err)
			continue
		}
		res := r.S.BatchRecommend(ctx, database.Identity{UserID: actor, Email: email}, storeID, productIDs, 3)
		slog.Info("auto pricing", "store", storeID, "generated", res.Generated, "failed", len(res.Failed))
	}
	return nil
}

func (r *Runner) mlRefresh(ctx context.Context) error {
	stores, err := r.activeStores(ctx, "")
	if err != nil {
		return err
	}
	for _, id := range stores {
		if err := r.S.AI.Post(ctx, "/v1/ml/refresh", map[string]any{"store_id": id}, nil, ""); err != nil {
			slog.Warn("ml refresh failed", "store", id, "err", err)
		}
	}
	return nil
}
