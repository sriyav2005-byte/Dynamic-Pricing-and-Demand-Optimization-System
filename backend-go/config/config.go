// Package config loads runtime configuration from environment variables
// (optionally from a .env file in the working directory).
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

// AuthProvider selects how bearer tokens are issued and verified.
type AuthProvider string

const (
	// AuthSupabase verifies Supabase Auth access tokens (HS256 secret or JWKS).
	AuthSupabase AuthProvider = "supabase"
	// AuthLocal issues and verifies HS256 tokens itself against auth.users.
	// Intended for local development when no Supabase project is available.
	AuthLocal AuthProvider = "local"
)

type Config struct {
	Env  string
	Port string

	DatabaseURL   string
	DBMaxConns    int32
	MigrationsDir string

	RedisURL string

	AuthProvider      AuthProvider
	SupabaseURL       string
	SupabaseJWTSecret string
	SupabaseJWTAud    string
	LocalJWTSecret    string
	LocalTokenTTL     time.Duration

	AIServiceURL   string
	AIServiceToken string
	AITimeout      time.Duration

	CORSOrigins []string

	RateLimitPerMinute int

	SMTPHost, SMTPPort, SMTPUser, SMTPPassword, SMTPFrom string

	WorkersEnabled            bool
	AlertScanInterval         time.Duration
	CompetitorRefreshInterval time.Duration
	AutoPricingInterval       time.Duration
	MLRefreshInterval         time.Duration
}

// Load reads configuration. A .env file is loaded when present; real
// environment variables take precedence.
func Load() (*Config, error) {
	_ = godotenv.Load()

	c := &Config{
		Env:                       get("APP_ENV", "development"),
		Port:                      get("PORT", "8080"),
		DatabaseURL:               os.Getenv("DATABASE_URL"),
		DBMaxConns:                int32(getInt("DB_MAX_CONNS", 10)),
		MigrationsDir:             get("MIGRATIONS_DIR", "../supabase/migrations"),
		RedisURL:                  os.Getenv("REDIS_URL"),
		AuthProvider:              AuthProvider(strings.ToLower(get("AUTH_PROVIDER", "supabase"))),
		SupabaseURL:               strings.TrimRight(os.Getenv("SUPABASE_URL"), "/"),
		SupabaseJWTSecret:         os.Getenv("SUPABASE_JWT_SECRET"),
		SupabaseJWTAud:            get("SUPABASE_JWT_AUD", "authenticated"),
		LocalJWTSecret:            os.Getenv("LOCAL_JWT_SECRET"),
		LocalTokenTTL:             getDuration("LOCAL_TOKEN_TTL", 12*time.Hour),
		AIServiceURL:              strings.TrimRight(get("AI_SERVICE_URL", "http://localhost:8000"), "/"),
		AIServiceToken:            os.Getenv("AI_SERVICE_TOKEN"),
		AITimeout:                 getDuration("AI_TIMEOUT", 60*time.Second),
		CORSOrigins:               splitCSV(get("CORS_ORIGINS", "http://localhost:3000")),
		RateLimitPerMinute:        getInt("RATE_LIMIT_PER_MINUTE", 300),
		SMTPHost:                  os.Getenv("SMTP_HOST"),
		SMTPPort:                  get("SMTP_PORT", "587"),
		SMTPUser:                  os.Getenv("SMTP_USER"),
		SMTPPassword:              os.Getenv("SMTP_PASSWORD"),
		SMTPFrom:                  os.Getenv("SMTP_FROM"),
		WorkersEnabled:            getBool("WORKERS_ENABLED", true),
		AlertScanInterval:         getDuration("ALERT_SCAN_INTERVAL", 15*time.Minute),
		CompetitorRefreshInterval: getDuration("COMPETITOR_REFRESH_INTERVAL", 6*time.Hour),
		AutoPricingInterval:       getDuration("AUTO_PRICING_INTERVAL", time.Hour),
		MLRefreshInterval:         getDuration("ML_REFRESH_INTERVAL", 24*time.Hour),
	}
	return c, c.validate()
}

func (c *Config) validate() error {
	if c.DatabaseURL == "" {
		return fmt.Errorf("DATABASE_URL is required")
	}
	switch c.AuthProvider {
	case AuthSupabase:
		if c.SupabaseJWTSecret == "" && c.SupabaseURL == "" {
			return fmt.Errorf("AUTH_PROVIDER=supabase requires SUPABASE_JWT_SECRET or SUPABASE_URL (for JWKS)")
		}
	case AuthLocal:
		if len(c.LocalJWTSecret) < 32 {
			return fmt.Errorf("AUTH_PROVIDER=local requires LOCAL_JWT_SECRET of at least 32 characters")
		}
		if c.Env == "production" {
			return fmt.Errorf("AUTH_PROVIDER=local must not be used with APP_ENV=production")
		}
	default:
		return fmt.Errorf("AUTH_PROVIDER must be 'supabase' or 'local', got %q", c.AuthProvider)
	}
	if c.AIServiceToken == "" {
		return fmt.Errorf("AI_SERVICE_TOKEN is required (shared secret for the Python AI service)")
	}
	// The internal token is the only thing protecting the AI service, which
	// runs with the database service role — never ship the example value.
	if c.Env == "production" && (len(c.AIServiceToken) < 32 || strings.HasPrefix(c.AIServiceToken, "change-me")) {
		return fmt.Errorf("AI_SERVICE_TOKEN must be a random secret of at least 32 characters in production")
	}
	for _, o := range c.CORSOrigins {
		if o == "*" {
			return fmt.Errorf("CORS_ORIGINS must list explicit origins ('*' is not allowed with credentialed requests)")
		}
	}
	return nil
}

func get(key, def string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return def
}

func getInt(key string, def int) int {
	if v, err := strconv.Atoi(os.Getenv(key)); err == nil {
		return v
	}
	return def
}

func getBool(key string, def bool) bool {
	if v, err := strconv.ParseBool(os.Getenv(key)); err == nil {
		return v
	}
	return def
}

func getDuration(key string, def time.Duration) time.Duration {
	if v, err := time.ParseDuration(os.Getenv(key)); err == nil {
		return v
	}
	return def
}

func splitCSV(s string) []string {
	var out []string
	for _, p := range strings.Split(s, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}
