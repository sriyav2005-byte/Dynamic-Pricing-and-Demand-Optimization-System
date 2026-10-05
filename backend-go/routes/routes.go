// Package routes wires HTTP routes to controllers with the required
// authentication and role guards.
package routes

import (
	"github.com/gin-gonic/gin"

	"github.com/rishabh26raj/priceiq/backend-go/controllers"
	"github.com/rishabh26raj/priceiq/backend-go/middleware"
	m "github.com/rishabh26raj/priceiq/backend-go/models"
	"github.com/rishabh26raj/priceiq/backend-go/services"
)

// Register builds the router.
//
// Every store-scoped request passes the same pipeline, outermost first:
//
//	RequireAuth          verify the bearer token (Supabase JWT or local dev token) → Identity
//	RateLimit            per user (per IP when unauthenticated); stricter buckets for auth and AI routes
//	RequireStore(VIEWER) resolve the caller's role on :store_id — unknown or foreign stores are 404
//	MinRole(...)         per-route minimum role
//	service              runs its SQL in database.WithUser, so PostgreSQL RLS re-checks the same
//	                     tenant rules even if a guard above were wrong (defence in depth)
//
// The browser never reaches the Python AI service: services call it through
// clients.AIClient with the internal token after authorization has succeeded.
//
// Role requirements (store scope):
//
//	VIEWER         all reads
//	ANALYST        generate recommendations / simulations, acknowledge alerts, run scans
//	STORE_MANAGER  product/inventory/sales writes, approve/reject/apply prices, competitor data,
//	               seasonal events & considerations
//	ADMIN          store settings (pricing mode & rules), store edits, org members
func Register(r *gin.Engine, s *services.Service) {
	h := &controllers.H{S: s}
	auth := middleware.RequireAuth(s.Verifier)
	rl := middleware.RateLimit(s.Cache, s.Cfg.RateLimitPerMinute, "api")
	authRL := middleware.RateLimit(s.Cache, 10, "auth")
	aiRL := middleware.RateLimit(s.Cache, 30, "ai")

	r.GET("/health", h.Health)

	v1 := r.Group("/api/v1")
	v1.GET("/auth/config", h.AuthConfig)
	v1.POST("/auth/local/register", authRL, h.LocalRegister)
	v1.POST("/auth/local/login", authRL, h.LocalLogin)

	u := v1.Group("", auth, rl)
	u.GET("/me", h.Me)
	u.PATCH("/me", h.UpdateMe)
	u.GET("/notifications", h.Notifications)
	u.POST("/notifications/:id/read", h.ReadNotifications)
	u.GET("/competitors/platforms", h.Platforms)
	u.GET("/models", h.Models)

	org := u.Group("/organizations/:org_id")
	org.GET("/members", h.Members)
	org.POST("/members", h.AddMember)
	org.PATCH("/members/:membership_id", h.ChangeMember)
	org.DELETE("/members/:membership_id", h.RemoveMember)
	org.POST("/stores", h.CreateStore)
	org.GET("/analytics", h.OrgAnalytics)

	st := u.Group("/stores/:store_id", s.Roles.RequireStore(m.RoleViewer))
	analyst := middleware.MinRole(m.RoleAnalyst)
	manager := middleware.MinRole(m.RoleStoreManager)
	admin := middleware.MinRole(m.RoleAdmin)

	st.GET("", h.Store)
	st.PATCH("", admin, h.UpdateStore)
	st.GET("/settings", h.Settings)
	st.PUT("/settings", admin, h.SaveSettings)

	// Catalogue
	st.GET("/products", h.Products)
	st.POST("/products", manager, h.CreateProduct)
	st.GET("/products/import/template", h.ImportTemplate)
	st.POST("/products/import", manager, h.ImportProducts)
	st.GET("/products/:product_id", h.Product)
	st.PATCH("/products/:product_id", manager, h.UpdateProduct)
	st.DELETE("/products/:product_id", manager, h.DeleteProduct)
	st.GET("/categories", h.Categories)
	st.GET("/suppliers", h.Suppliers)
	st.POST("/suppliers", manager, h.CreateSupplier)

	// Inventory
	st.GET("/inventory", h.InventoryOverview)
	st.GET("/inventory/movements", h.Movements)
	st.GET("/inventory/expiry-optimization", aiRL, h.ExpiryOptimization)
	st.GET("/products/:product_id/inventory", h.ProductInventory)
	st.POST("/products/:product_id/stock-adjustments", manager, h.AdjustStock)

	// Sales & analytics
	st.GET("/sales", h.Sales)
	st.POST("/sales", manager, h.RecordSale)
	st.GET("/analytics/summary", h.Summary)
	st.GET("/analytics/trends", h.Trends)
	st.GET("/analytics/categories", h.CategoryPerformance)
	st.GET("/analytics/products", h.ProductPerformance)
	st.GET("/reports/:kind", analyst, h.Report)

	// Pricing
	st.POST("/pricing/recommendations", analyst, aiRL, h.Recommend)
	st.POST("/pricing/recommendations/batch", analyst, aiRL, h.BatchRecommend)
	st.GET("/pricing/recommendations", h.Recommendations)
	st.GET("/pricing/recommendations/:rec_id", h.Recommendation)
	st.POST("/pricing/recommendations/:rec_id/approve", manager, h.Approve)
	st.POST("/pricing/recommendations/:rec_id/reject", manager, h.Reject)
	st.POST("/pricing/recommendations/:rec_id/apply", manager, h.Apply)
	st.POST("/pricing/simulate", analyst, aiRL, h.Simulate)
	st.GET("/products/:product_id/price-history", h.PriceHistory)
	st.GET("/products/:product_id/elasticity", aiRL, h.Elasticity)
	st.GET("/products/:product_id/cross-effects", aiRL, h.CrossEffects)

	// Forecasting
	st.GET("/forecast", aiRL, h.ForecastOverview)
	st.GET("/products/:product_id/forecast", aiRL, h.Forecast)

	// Competitors
	st.GET("/competitors", h.CompetitorOverview)
	st.GET("/competitors/search", aiRL, h.CompetitorSearch)
	st.GET("/products/:product_id/competitors", h.ProductCompetitors)
	st.GET("/products/:product_id/competitors/history", h.CompetitorHistory)
	st.POST("/products/:product_id/competitors/refresh", manager, aiRL, h.RefreshCompetitors)
	st.POST("/products/:product_id/competitors/observations", manager, h.ManualCompetitorPrice)
	st.POST("/products/:product_id/competitors/link", manager, h.LinkCompetitor)
	st.DELETE("/products/:product_id/competitors/:competitor_key", manager, h.UnlinkCompetitor)

	// Alerts, anomalies, audit
	st.GET("/alerts", h.Alerts)
	st.PATCH("/alerts/:alert_id", analyst, h.UpdateAlert)
	st.POST("/alerts/scan", analyst, h.ScanAlerts)
	st.GET("/anomalies", aiRL, h.Anomalies)
	st.GET("/audit-logs", manager, h.Audit)

	// Seasonal intelligence
	st.GET("/seasonal/events", h.SeasonalEvents)
	st.POST("/seasonal/events", manager, h.CreateSeasonalEvent)
	st.GET("/seasonal/insights", aiRL, h.SeasonalInsights)
	// Seasonal considerations: staff-entered demand/supply assumptions that the
	// AI service applies (labelled) when it evaluates prices.
	st.GET("/seasonal/considerations", h.Considerations)
	st.POST("/seasonal/considerations", manager, h.CreateConsideration)
	st.PUT("/seasonal/considerations/:consideration_id", manager, h.UpdateConsideration)
	st.DELETE("/seasonal/considerations/:consideration_id", manager, h.DeleteConsideration)
	st.GET("/weather", h.Weather)

	// Retail Copilot
	st.POST("/copilot/chat", aiRL, h.Chat)
	st.GET("/copilot/conversations", h.Conversations)
	st.GET("/copilot/conversations/:conversation_id", h.ConversationMessages)
}
