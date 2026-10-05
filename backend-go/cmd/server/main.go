// Command server runs the PriceIQ Go API.
//
//	go run ./cmd/server
//
// Configuration comes from environment variables / .env (see .env.example).
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/rishabh26raj/priceiq/backend-go/clients"
	"github.com/rishabh26raj/priceiq/backend-go/config"
	"github.com/rishabh26raj/priceiq/backend-go/database"
	"github.com/rishabh26raj/priceiq/backend-go/middleware"
	"github.com/rishabh26raj/priceiq/backend-go/routes"
	"github.com/rishabh26raj/priceiq/backend-go/services"
	"github.com/rishabh26raj/priceiq/backend-go/workers"
)

func main() {
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})))
	cfg, err := config.Load()
	if err != nil {
		slog.Error("configuration", "err", err)
		os.Exit(1)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	db, err := database.Connect(ctx, cfg.DatabaseURL, cfg.DBMaxConns)
	if err != nil {
		slog.Error("database", "err", err)
		os.Exit(1)
	}
	defer db.Close()

	cache, err := clients.NewCache(cfg.RedisURL)
	if err != nil {
		slog.Warn("redis unavailable — falling back to in-memory cache", "err", err)
		cache, _ = clients.NewCache("")
	}
	defer cache.Close()

	verifier, err := middleware.NewVerifier(ctx, cfg)
	if err != nil {
		slog.Error("auth", "err", err)
		os.Exit(1)
	}
	svc := &services.Service{
		Cfg: cfg, DB: db, Cache: cache, Verifier: verifier,
		AI:     clients.NewAIClient(cfg.AIServiceURL, cfg.AIServiceToken, cfg.AITimeout),
		Roles:  &middleware.RoleResolver{DB: db, Cache: cache},
		Mailer: &clients.Mailer{Host: cfg.SMTPHost, Port: cfg.SMTPPort, User: cfg.SMTPUser, Password: cfg.SMTPPassword, From: cfg.SMTPFrom},
	}

	if cfg.Env == "production" {
		gin.SetMode(gin.ReleaseMode)
	}
	r := gin.New()
	r.MaxMultipartMemory = 12 << 20
	_ = r.SetTrustedProxies(nil)
	r.Use(middleware.Recovery(), middleware.RequestLogger(), middleware.CORS(cfg.CORSOrigins))
	routes.Register(r, svc)
	r.NoRoute(func(c *gin.Context) {
		c.JSON(http.StatusNotFound, gin.H{"error": gin.H{"code": "not_found", "message": "Route not found"}})
	})

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       60 * time.Second,
		WriteTimeout:      180 * time.Second, // copilot and batch pricing can be slow
		IdleTimeout:       120 * time.Second,
	}

	jobs := &workers.Runner{S: svc}
	if cfg.WorkersEnabled {
		jobs.Start(ctx)
	}

	go func() {
		slog.Info("PriceIQ API listening", "addr", srv.Addr, "auth", cfg.AuthProvider, "cache", cache.Kind(), "ai", cfg.AIServiceURL)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("server", "err", err)
			stop()
		}
	}()
	<-ctx.Done()
	slog.Info("shutting down…")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdownCtx)
	jobs.Wait()
}
