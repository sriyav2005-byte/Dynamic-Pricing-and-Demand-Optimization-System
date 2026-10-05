// Package middleware contains Gin middleware: authentication, store-scoped
// RBAC, rate limiting and request logging.
package middleware

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/MicahParks/keyfunc/v3"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"

	"github.com/rishabh26raj/priceiq/backend-go/config"
	"github.com/rishabh26raj/priceiq/backend-go/database"
	"github.com/rishabh26raj/priceiq/backend-go/utils"
)

const (
	ctxIdentity = "priceiq.identity"
	ctxToken    = "priceiq.token"
	LocalIssuer = "priceiq-local"
)

// Claims mirrors the relevant part of a Supabase Auth access token.
type Claims struct {
	Email string `json:"email"`
	Role  string `json:"role"`
	jwt.RegisteredClaims
}

// Verifier validates bearer tokens.
type Verifier struct {
	provider config.AuthProvider
	hsSecret []byte
	jwks     keyfunc.Keyfunc
	audience string
}

// NewVerifier builds a verifier for the configured provider. For Supabase,
// HS256 tokens are checked with SUPABASE_JWT_SECRET (legacy projects) and
// asymmetric tokens (ES256/RS256, newer projects) against the project's JWKS.
func NewVerifier(ctx context.Context, cfg *config.Config) (*Verifier, error) {
	v := &Verifier{provider: cfg.AuthProvider, audience: cfg.SupabaseJWTAud}
	switch cfg.AuthProvider {
	case config.AuthLocal:
		v.hsSecret = []byte(cfg.LocalJWTSecret)
		v.audience = "authenticated"
	case config.AuthSupabase:
		if cfg.SupabaseJWTSecret != "" {
			v.hsSecret = []byte(cfg.SupabaseJWTSecret)
		}
		if cfg.SupabaseURL != "" {
			jwks, err := keyfunc.NewDefaultCtx(ctx, []string{cfg.SupabaseURL + "/auth/v1/.well-known/jwks.json"})
			if err != nil {
				if v.hsSecret == nil {
					return nil, fmt.Errorf("load Supabase JWKS: %w", err)
				}
			} else {
				v.jwks = jwks
			}
		}
	}
	return v, nil
}

func (v *Verifier) keyFunc(t *jwt.Token) (any, error) {
	if t.Method.Alg() == jwt.SigningMethodHS256.Alg() {
		if v.hsSecret == nil {
			return nil, errors.New("HS256 tokens not accepted")
		}
		return v.hsSecret, nil
	}
	if v.jwks != nil && v.provider == config.AuthSupabase {
		return v.jwks.Keyfunc(t)
	}
	return nil, fmt.Errorf("unexpected signing method %s", t.Method.Alg())
}

// Verify parses and validates a token, returning the caller identity.
func (v *Verifier) Verify(token string) (database.Identity, error) {
	claims := &Claims{}
	opts := []jwt.ParserOption{
		jwt.WithValidMethods([]string{"HS256", "ES256", "RS256"}),
		jwt.WithExpirationRequired(),
		jwt.WithLeeway(30 * time.Second),
	}
	if v.audience != "" {
		opts = append(opts, jwt.WithAudience(v.audience))
	}
	if v.provider == config.AuthLocal {
		opts = append(opts, jwt.WithIssuer(LocalIssuer))
	}
	if _, err := jwt.ParseWithClaims(token, claims, v.keyFunc, opts...); err != nil {
		return database.Identity{}, err
	}
	if claims.Role != "authenticated" {
		return database.Identity{}, errors.New("token role is not 'authenticated'")
	}
	if _, err := uuid.Parse(claims.Subject); err != nil {
		return database.Identity{}, errors.New("token subject is not a user id")
	}
	return database.Identity{UserID: claims.Subject, Email: claims.Email}, nil
}

// IssueLocal signs a Supabase-shaped access token (local provider only).
func (v *Verifier) IssueLocal(userID, email string, ttl time.Duration) (string, time.Time, error) {
	if v.provider != config.AuthLocal {
		return "", time.Time{}, errors.New("local token issuing is disabled")
	}
	exp := time.Now().Add(ttl)
	claims := Claims{
		Email: email,
		Role:  "authenticated",
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID,
			Issuer:    LocalIssuer,
			Audience:  jwt.ClaimStrings{"authenticated"},
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			ExpiresAt: jwt.NewNumericDate(exp),
		},
	}
	s, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(v.hsSecret)
	return s, exp, err
}

// RequireAuth rejects requests without a valid bearer token.
//
// Authentication flow: the frontend signs in with Supabase Auth (or, in local
// development, POST /auth/local/login) and sends the access token on every
// request. The token is verified here — signature, expiry, audience and the
// "authenticated" role claim — and only the user id and e-mail are kept. Roles
// are deliberately NOT read from the token: they are looked up per store in
// the memberships table (RoleResolver), so revoking access takes effect
// within the 60-second role cache instead of waiting for token expiry.
func RequireAuth(v *Verifier) gin.HandlerFunc {
	return func(c *gin.Context) {
		h := c.GetHeader("Authorization")
		token, ok := strings.CutPrefix(h, "Bearer ")
		if !ok || token == "" {
			utils.Respond(c, utils.Unauthorized("Missing bearer token"))
			return
		}
		id, err := v.Verify(token)
		if err != nil {
			utils.Respond(c, utils.Unauthorized("Invalid or expired session"))
			return
		}
		c.Set(ctxIdentity, id)
		c.Set(ctxToken, token)
		c.Next()
	}
}

// Identity returns the authenticated caller (RequireAuth must have run).
func Identity(c *gin.Context) database.Identity {
	id, _ := c.Get(ctxIdentity)
	v, _ := id.(database.Identity)
	return v
}

// Token returns the raw bearer token (forwarded to the AI service).
func Token(c *gin.Context) string { return c.GetString(ctxToken) }
