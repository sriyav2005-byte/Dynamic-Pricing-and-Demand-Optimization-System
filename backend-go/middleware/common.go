package middleware

import (
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/rishabh26raj/priceiq/backend-go/clients"
	"github.com/rishabh26raj/priceiq/backend-go/utils"
)

// RequestLogger assigns an X-Request-ID and logs one line per request.
func RequestLogger() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		rid := c.GetHeader("X-Request-ID")
		if rid == "" {
			rid = uuid.NewString()
		}
		c.Header("X-Request-ID", rid)
		c.Next()
		level := slog.LevelInfo
		if c.Writer.Status() >= 500 {
			level = slog.LevelError
		}
		slog.Log(c.Request.Context(), level, "request",
			"id", rid, "method", c.Request.Method, "path", c.Request.URL.Path,
			"status", c.Writer.Status(), "ms", time.Since(start).Milliseconds())
	}
}

// Recovery converts panics into 500 responses in the standard error format.
func Recovery() gin.HandlerFunc {
	return gin.CustomRecovery(func(c *gin.Context, rec any) {
		slog.Error("panic", "path", c.Request.URL.Path, "err", rec)
		utils.Respond(c, fmt.Errorf("panic: %v", rec))
	})
}

// CORS allows the configured frontend origins.
func CORS(origins []string) gin.HandlerFunc {
	allowed := map[string]bool{}
	for _, o := range origins {
		allowed[o] = true
	}
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		if origin != "" && allowed[origin] {
			h := c.Writer.Header()
			h.Set("Access-Control-Allow-Origin", origin)
			h.Set("Vary", "Origin")
			h.Set("Access-Control-Allow-Credentials", "true")
			h.Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Request-ID")
			h.Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			h.Set("Access-Control-Expose-Headers", "X-Request-ID, Content-Disposition, X-RateLimit-Remaining")
			h.Set("Access-Control-Max-Age", "600")
		}
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}

// RateLimit is a fixed-window limiter keyed by user (or client IP when
// unauthenticated). Backed by Redis when configured.
func RateLimit(cache clients.Cache, perMinute int, bucket string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if perMinute <= 0 {
			c.Next()
			return
		}
		who := Identity(c).UserID
		if who == "" {
			who = "ip:" + c.ClientIP()
		}
		window := time.Now().Unix() / 60
		key := fmt.Sprintf("rl:%s:%s:%d", bucket, who, window)
		n, err := cache.Incr(c.Request.Context(), key, 2*time.Minute)
		if err == nil {
			remaining := perMinute - int(n)
			if remaining < 0 {
				remaining = 0
			}
			c.Header("X-RateLimit-Remaining", strconv.Itoa(remaining))
			if int(n) > perMinute {
				c.Header("Retry-After", strconv.Itoa(int(60-time.Now().Unix()%60)))
				utils.Respond(c, utils.NewError(http.StatusTooManyRequests, "rate_limited", "Too many requests, please slow down"))
				return
			}
		}
		c.Next()
	}
}
