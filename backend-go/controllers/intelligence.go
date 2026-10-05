package controllers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/rishabh26raj/priceiq/backend-go/middleware"
	"github.com/rishabh26raj/priceiq/backend-go/repositories"
	"github.com/rishabh26raj/priceiq/backend-go/services"
	"github.com/rishabh26raj/priceiq/backend-go/utils"
)

// ── Pricing ─────────────────────────────────────────────────────────────────

func (h *H) Recommend(c *gin.Context) {
	var in struct {
		ProductID string `json:"product_id" binding:"required,uuid"`
	}
	if !utils.Bind(c, &in) {
		return
	}
	r, err := h.S.GenerateRecommendation(c.Request.Context(), middleware.Identity(c), middleware.StoreID(c), in.ProductID)
	if !fail(c, err) {
		created(c, r)
	}
}

func (h *H) BatchRecommend(c *gin.Context) {
	var in struct {
		ProductIDs []string `json:"product_ids" binding:"max=200,dive,uuid"`
		Scope      string   `json:"scope" binding:"omitempty,oneof=all at_risk"`
	}
	if !utils.Bind(c, &in) {
		return
	}
	ids := in.ProductIDs
	if len(ids) == 0 {
		inv, err := h.S.InventoryOverview(c.Request.Context(), middleware.Identity(c), middleware.StoreID(c))
		if fail(c, err) {
			return
		}
		for _, p := range inv.Products {
			if in.Scope == "at_risk" && len(p.Statuses) == 0 {
				continue
			}
			ids = append(ids, p.ProductID)
			if len(ids) == 200 {
				break
			}
		}
	}
	ok(c, h.S.BatchRecommend(c.Request.Context(), middleware.Identity(c), middleware.StoreID(c), ids, 4))
}

func (h *H) Recommendations(c *gin.Context) {
	page, size, offset := utils.Pagination(c, 25, 200)
	status := c.Query("status")
	switch status {
	case "", "PENDING", "APPROVED", "REJECTED", "APPLIED", "EXPIRED", "SUPERSEDED":
	default:
		utils.Respond(c, utils.BadRequest("invalid status filter"))
		return
	}
	pid := c.Query("product_id")
	if pid != "" {
		if _, err := uuid.Parse(pid); err != nil {
			utils.Respond(c, utils.BadRequest("product_id must be a UUID"))
			return
		}
	}
	res, err := h.S.ListRecommendations(c.Request.Context(), middleware.Identity(c), middleware.StoreID(c),
		repositories.RecFilter{Status: status, ProductID: pid, Limit: size, Offset: offset})
	if !fail(c, err) {
		res.Page, res.PageSize = page, size
		ok(c, res)
	}
}

func (h *H) Recommendation(c *gin.Context) {
	rid, okk := uuidParam(c, "rec_id")
	if !okk {
		return
	}
	r, err := h.S.GetRecommendation(c.Request.Context(), middleware.Identity(c), middleware.StoreID(c), rid)
	if !fail(c, err) {
		ok(c, r)
	}
}

type reviewBody struct {
	Note     string `json:"note" binding:"max=500"`
	ApplyNow bool   `json:"apply_now"`
}

func (h *H) Approve(c *gin.Context) {
	rid, okk := uuidParam(c, "rec_id")
	if !okk {
		return
	}
	var in reviewBody
	if c.Request.ContentLength > 0 && !utils.Bind(c, &in) {
		return
	}
	r, err := h.S.ReviewRecommendation(c.Request.Context(), middleware.Identity(c), middleware.StoreID(c), rid, true, in.Note, in.ApplyNow)
	if !fail(c, err) {
		ok(c, r)
	}
}

func (h *H) Reject(c *gin.Context) {
	rid, okk := uuidParam(c, "rec_id")
	if !okk {
		return
	}
	var in reviewBody
	if c.Request.ContentLength > 0 && !utils.Bind(c, &in) {
		return
	}
	r, err := h.S.ReviewRecommendation(c.Request.Context(), middleware.Identity(c), middleware.StoreID(c), rid, false, in.Note, false)
	if !fail(c, err) {
		ok(c, r)
	}
}

func (h *H) Apply(c *gin.Context) {
	rid, okk := uuidParam(c, "rec_id")
	if !okk {
		return
	}
	var in reviewBody
	if c.Request.ContentLength > 0 && !utils.Bind(c, &in) {
		return
	}
	r, err := h.S.ApplyRecommendation(c.Request.Context(), middleware.Identity(c), middleware.StoreID(c), rid, in.Note)
	if !fail(c, err) {
		ok(c, r)
	}
}

func (h *H) Simulate(c *gin.Context) {
	var in services.SimulationRequest
	if !utils.Bind(c, &in) {
		return
	}
	out, err := h.S.Simulate(c.Request.Context(), middleware.Identity(c), middleware.StoreID(c), in)
	if !fail(c, err) {
		ok(c, out)
	}
}

func (h *H) PriceHistory(c *gin.Context) {
	pid, okk := uuidParam(c, "product_id")
	if !okk {
		return
	}
	days := utils.QueryInt(c, "days", 90)
	if days < 1 || days > 3660 {
		days = 90
	}
	out, err := h.S.PriceHistory(c.Request.Context(), middleware.Identity(c), middleware.StoreID(c), pid, days)
	if !fail(c, err) {
		ok(c, out)
	}
}

func (h *H) Elasticity(c *gin.Context) {
	pid, okk := uuidParam(c, "product_id")
	if !okk {
		return
	}
	out, err := h.S.Elasticity(c.Request.Context(), middleware.Identity(c), middleware.StoreID(c), pid)
	if !fail(c, err) {
		ok(c, out)
	}
}

func (h *H) CrossEffects(c *gin.Context) {
	pid, okk := uuidParam(c, "product_id")
	if !okk {
		return
	}
	out, err := h.S.CrossEffects(c.Request.Context(), middleware.Identity(c), middleware.StoreID(c), pid)
	if !fail(c, err) {
		ok(c, out)
	}
}

// ── Forecasting ─────────────────────────────────────────────────────────────

func (h *H) Forecast(c *gin.Context) {
	pid, okk := uuidParam(c, "product_id")
	if !okk {
		return
	}
	out, err := h.S.Forecast(c.Request.Context(), middleware.Identity(c), middleware.StoreID(c), pid, utils.QueryInt(c, "horizon", 7))
	if !fail(c, err) {
		ok(c, out)
	}
}

func (h *H) ForecastOverview(c *gin.Context) {
	out, err := h.S.ForecastOverview(c.Request.Context(), middleware.StoreID(c), utils.QueryInt(c, "horizon", 7))
	if !fail(c, err) {
		ok(c, out)
	}
}

// ── Competitors ─────────────────────────────────────────────────────────────

func (h *H) Platforms(c *gin.Context) {
	out, err := h.S.Platforms(c.Request.Context(), middleware.Identity(c))
	if !fail(c, err) {
		ok(c, out)
	}
}

func (h *H) CompetitorOverview(c *gin.Context) {
	out, err := h.S.CompetitorOverview(c.Request.Context(), middleware.Identity(c), middleware.StoreID(c))
	if !fail(c, err) {
		ok(c, out)
	}
}

func (h *H) ProductCompetitors(c *gin.Context) {
	pid, okk := uuidParam(c, "product_id")
	if !okk {
		return
	}
	out, err := h.S.ProductCompetitors(c.Request.Context(), middleware.Identity(c), middleware.StoreID(c), pid)
	if !fail(c, err) {
		ok(c, out)
	}
}

func (h *H) CompetitorHistory(c *gin.Context) {
	pid, okk := uuidParam(c, "product_id")
	if !okk {
		return
	}
	out, err := h.S.CompetitorHistory(c.Request.Context(), middleware.Identity(c), middleware.StoreID(c), pid, c.DefaultQuery("range", "7d"))
	if !fail(c, err) {
		ok(c, out)
	}
}

func (h *H) RefreshCompetitors(c *gin.Context) {
	pid, okk := uuidParam(c, "product_id")
	if !okk {
		return
	}
	out, err := h.S.RefreshCompetitors(c.Request.Context(), middleware.Identity(c), middleware.StoreID(c), pid)
	if !fail(c, err) {
		ok(c, out)
	}
}

func (h *H) ManualCompetitorPrice(c *gin.Context) {
	pid, okk := uuidParam(c, "product_id")
	if !okk {
		return
	}
	var in services.ManualObservation
	if !utils.Bind(c, &in) {
		return
	}
	out, err := h.S.RecordManualObservation(c.Request.Context(), middleware.Identity(c), middleware.StoreID(c), pid, in)
	if !fail(c, err) {
		created(c, out)
	}
}

func (h *H) LinkCompetitor(c *gin.Context) {
	pid, okk := uuidParam(c, "product_id")
	if !okk {
		return
	}
	var in services.LinkRequest
	if !utils.Bind(c, &in) {
		return
	}
	out, err := h.S.LinkCompetitorProduct(c.Request.Context(), middleware.Identity(c), middleware.StoreID(c), pid, in)
	if !fail(c, err) {
		ok(c, out)
	}
}

func (h *H) CompetitorSearch(c *gin.Context) {
	out, err := h.S.SearchCompetitors(c.Request.Context(), middleware.StoreID(c), c.Query("q"))
	if !fail(c, err) {
		ok(c, out)
	}
}

// ── Alerts / audit / seasonal / models ──────────────────────────────────────

func (h *H) Alerts(c *gin.Context) {
	page, size, offset := utils.Pagination(c, 50, 200)
	res, err := h.S.ListAlerts(c.Request.Context(), middleware.Identity(c), middleware.StoreID(c),
		c.Query("status"), c.Query("severity"), c.Query("type"), size, offset)
	if !fail(c, err) {
		res.Page, res.PageSize = page, size
		ok(c, res)
	}
}

func (h *H) UpdateAlert(c *gin.Context) {
	aid, okk := uuidParam(c, "alert_id")
	if !okk {
		return
	}
	var in struct {
		Status string `json:"status" binding:"required"`
	}
	if !utils.Bind(c, &in) {
		return
	}
	if !fail(c, h.S.UpdateAlertStatus(c.Request.Context(), middleware.Identity(c), middleware.StoreID(c), aid, in.Status)) {
		c.Status(http.StatusNoContent)
	}
}

func (h *H) ScanAlerts(c *gin.Context) {
	res, err := h.S.ScanStore(c.Request.Context(), middleware.StoreID(c))
	if !fail(c, err) {
		ok(c, res)
	}
}

func (h *H) Anomalies(c *gin.Context) {
	out, err := h.S.Anomalies(c.Request.Context(), middleware.StoreID(c))
	if !fail(c, err) {
		ok(c, out)
	}
}

func (h *H) Audit(c *gin.Context) {
	page, size, offset := utils.Pagination(c, 50, 200)
	res, err := h.S.AuditLog(c.Request.Context(), middleware.Identity(c), middleware.StoreID(c),
		c.Query("entity_type"), c.Query("entity_id"), c.Query("action"), size, offset)
	if !fail(c, err) {
		res.Page, res.PageSize = page, size
		ok(c, res)
	}
}

func (h *H) SeasonalEvents(c *gin.Context) {
	out, err := h.S.SeasonalEvents(c.Request.Context(), middleware.Identity(c), middleware.StoreID(c), c.Query("from"), c.Query("to"))
	if !fail(c, err) {
		ok(c, out)
	}
}

func (h *H) CreateSeasonalEvent(c *gin.Context) {
	var in services.EventInput
	if !utils.Bind(c, &in) {
		return
	}
	if !fail(c, h.S.CreateSeasonalEvent(c.Request.Context(), middleware.Identity(c), middleware.StoreID(c), in)) {
		c.Status(http.StatusCreated)
	}
}

func (h *H) Considerations(c *gin.Context) {
	out, err := h.S.ListConsiderations(c.Request.Context(), middleware.Identity(c), middleware.StoreID(c), c.Query("include_ended") == "true")
	if !fail(c, err) {
		ok(c, out)
	}
}

func (h *H) CreateConsideration(c *gin.Context) {
	var in services.ConsiderationInput
	if !utils.Bind(c, &in) {
		return
	}
	out, err := h.S.CreateConsideration(c.Request.Context(), middleware.Identity(c), middleware.StoreID(c), in)
	if !fail(c, err) {
		created(c, out)
	}
}

func (h *H) UpdateConsideration(c *gin.Context) {
	cid, okk := uuidParam(c, "consideration_id")
	if !okk {
		return
	}
	var in services.ConsiderationInput
	if !utils.Bind(c, &in) {
		return
	}
	out, err := h.S.UpdateConsideration(c.Request.Context(), middleware.Identity(c), middleware.StoreID(c), cid, in)
	if !fail(c, err) {
		ok(c, out)
	}
}

func (h *H) DeleteConsideration(c *gin.Context) {
	cid, okk := uuidParam(c, "consideration_id")
	if !okk {
		return
	}
	if !fail(c, h.S.DeleteConsideration(c.Request.Context(), middleware.Identity(c), middleware.StoreID(c), cid)) {
		c.Status(http.StatusNoContent)
	}
}

func (h *H) SeasonalInsights(c *gin.Context) {
	out, err := h.S.SeasonalInsights(c.Request.Context(), middleware.StoreID(c))
	if !fail(c, err) {
		ok(c, out)
	}
}

func (h *H) Weather(c *gin.Context) {
	out, err := h.S.Weather(c.Request.Context(), middleware.StoreID(c))
	if !fail(c, err) {
		ok(c, out)
	}
}

func (h *H) Models(c *gin.Context) {
	out, err := h.S.ModelInfo(c.Request.Context())
	if !fail(c, err) {
		ok(c, out)
	}
}

// ── Copilot ─────────────────────────────────────────────────────────────────

func (h *H) Chat(c *gin.Context) {
	var in services.ChatInput
	if !utils.Bind(c, &in) {
		return
	}
	out, err := h.S.Chat(c.Request.Context(), middleware.Identity(c), middleware.Token(c), middleware.StoreID(c),
		string(middleware.StoreRole(c)), in)
	if !fail(c, err) {
		ok(c, out)
	}
}

func (h *H) Conversations(c *gin.Context) {
	out, err := h.S.Conversations(c.Request.Context(), middleware.Identity(c), middleware.StoreID(c))
	if !fail(c, err) {
		ok(c, out)
	}
}

func (h *H) ConversationMessages(c *gin.Context) {
	cid, okk := uuidParam(c, "conversation_id")
	if !okk {
		return
	}
	out, err := h.S.ConversationMessages(c.Request.Context(), middleware.Identity(c), middleware.StoreID(c), cid)
	if !fail(c, err) {
		ok(c, out)
	}
}

func (h *H) UnlinkCompetitor(c *gin.Context) {
	pid, okk := uuidParam(c, "product_id")
	if !okk {
		return
	}
	if !fail(c, h.S.UnlinkCompetitorProduct(c.Request.Context(), middleware.Identity(c), middleware.StoreID(c), pid, c.Param("competitor_key"))) {
		c.Status(http.StatusNoContent)
	}
}
