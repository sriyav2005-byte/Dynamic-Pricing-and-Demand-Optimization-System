// Package controllers translates HTTP requests into service calls.
package controllers

import (
	"bytes"
	"context"
	"encoding/csv"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/rishabh26raj/priceiq/backend-go/middleware"
	"github.com/rishabh26raj/priceiq/backend-go/models"
	"github.com/rishabh26raj/priceiq/backend-go/repositories"
	"github.com/rishabh26raj/priceiq/backend-go/services"
	"github.com/rishabh26raj/priceiq/backend-go/utils"
)

type H struct {
	S *services.Service
}

func ok(c *gin.Context, v any)      { c.JSON(http.StatusOK, v) }
func created(c *gin.Context, v any) { c.JSON(http.StatusCreated, v) }

func fail(c *gin.Context, err error) bool {
	if err != nil {
		utils.Respond(c, err)
		return true
	}
	return false
}

func uuidParam(c *gin.Context, name string) (string, bool) {
	v := c.Param(name)
	if _, err := uuid.Parse(v); err != nil {
		utils.Respond(c, utils.BadRequest(name+" must be a UUID"))
		return "", false
	}
	return v, true
}

// ── Health ──────────────────────────────────────────────────────────────────

func (h *H) Health(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 3*time.Second)
	defer cancel()
	status := gin.H{"service": "priceiq-api", "status": "ok", "time": time.Now()}
	deps := gin.H{}
	if err := h.S.DB.Pool.Ping(ctx); err != nil {
		// Unauthenticated endpoint: the driver error (host, user, …) goes to the log only.
		slog.Warn("health: database ping failed", "err", err)
		deps["database"] = "down"
		status["status"] = "degraded"
	} else {
		deps["database"] = "ok"
	}
	if err := h.S.Cache.Ping(ctx); err != nil {
		deps["cache"] = "down"
		status["status"] = "degraded"
	} else {
		deps["cache"] = h.S.Cache.Kind()
	}
	if err := h.S.AI.Health(ctx); err != nil {
		deps["ai_service"] = "unreachable"
		status["status"] = "degraded"
	} else {
		deps["ai_service"] = "ok"
	}
	status["dependencies"] = deps
	status["auth_provider"] = h.S.Cfg.AuthProvider
	c.JSON(http.StatusOK, status)
}

func (h *H) AuthConfig(c *gin.Context) {
	ok(c, gin.H{"provider": h.S.Cfg.AuthProvider, "supabase_url": h.S.Cfg.SupabaseURL})
}

// ── Auth (local provider) & profile ─────────────────────────────────────────

func (h *H) LocalRegister(c *gin.Context) {
	var in services.RegisterInput
	if !utils.Bind(c, &in) {
		return
	}
	s, err := h.S.LocalRegister(c.Request.Context(), in)
	if !fail(c, err) {
		created(c, s)
	}
}

func (h *H) LocalLogin(c *gin.Context) {
	var in services.LoginInput
	if !utils.Bind(c, &in) {
		return
	}
	s, err := h.S.LocalLogin(c.Request.Context(), in)
	if !fail(c, err) {
		ok(c, s)
	}
}

func (h *H) Me(c *gin.Context) {
	me, err := h.S.Me(c.Request.Context(), middleware.Identity(c))
	if !fail(c, err) {
		ok(c, me)
	}
}

func (h *H) UpdateMe(c *gin.Context) {
	var in struct {
		FullName *string `json:"full_name" binding:"omitempty,max=120"`
		Phone    *string `json:"phone" binding:"omitempty,max=20"`
	}
	if !utils.Bind(c, &in) {
		return
	}
	me, err := h.S.UpdateMe(c.Request.Context(), middleware.Identity(c), in.FullName, in.Phone)
	if !fail(c, err) {
		ok(c, me)
	}
}

func (h *H) Notifications(c *gin.Context) {
	out, err := h.S.ListNotifications(c.Request.Context(), middleware.Identity(c), c.Query("unread") == "true", utils.QueryInt(c, "limit", 30))
	if !fail(c, err) {
		ok(c, out)
	}
}

func (h *H) ReadNotifications(c *gin.Context) {
	id := c.Param("id")
	if id != "" && id != "all" {
		if _, err := uuid.Parse(id); err != nil {
			utils.Respond(c, utils.BadRequest("id must be a UUID or 'all'"))
			return
		}
	} else {
		id = ""
	}
	if !fail(c, h.S.MarkNotificationsRead(c.Request.Context(), middleware.Identity(c), id)) {
		c.Status(http.StatusNoContent)
	}
}

// ── Organization ────────────────────────────────────────────────────────────

func (h *H) Members(c *gin.Context) {
	org, okk := uuidParam(c, "org_id")
	if !okk {
		return
	}
	out, err := h.S.ListMembers(c.Request.Context(), middleware.Identity(c), org)
	if !fail(c, err) {
		ok(c, out)
	}
}

func (h *H) AddMember(c *gin.Context) {
	org, okk := uuidParam(c, "org_id")
	if !okk {
		return
	}
	var in services.MemberInput
	if !utils.Bind(c, &in) {
		return
	}
	m, err := h.S.AddMember(c.Request.Context(), middleware.Identity(c), org, in)
	if !fail(c, err) {
		created(c, m)
	}
}

func (h *H) ChangeMember(c *gin.Context) {
	org, ok1 := uuidParam(c, "org_id")
	mid, ok2 := uuidParam(c, "membership_id")
	if !ok1 || !ok2 {
		return
	}
	var in struct {
		Role   string `json:"role" binding:"required"`
		Reason string `json:"reason"`
	}
	if !utils.Bind(c, &in) {
		return
	}
	if !fail(c, h.S.ChangeMemberRole(c.Request.Context(), middleware.Identity(c), org, mid, in.Role, in.Reason)) {
		c.Status(http.StatusNoContent)
	}
}

func (h *H) RemoveMember(c *gin.Context) {
	org, ok1 := uuidParam(c, "org_id")
	mid, ok2 := uuidParam(c, "membership_id")
	if !ok1 || !ok2 {
		return
	}
	if !fail(c, h.S.RemoveMember(c.Request.Context(), middleware.Identity(c), org, mid, c.Query("reason"))) {
		c.Status(http.StatusNoContent)
	}
}

func (h *H) CreateStore(c *gin.Context) {
	org, okk := uuidParam(c, "org_id")
	if !okk {
		return
	}
	var in services.StoreInput
	if !utils.Bind(c, &in) {
		return
	}
	st, err := h.S.CreateStore(c.Request.Context(), middleware.Identity(c), org, in)
	if !fail(c, err) {
		created(c, st)
	}
}

func (h *H) OrgAnalytics(c *gin.Context) {
	org, okk := uuidParam(c, "org_id")
	if !okk {
		return
	}
	out, err := h.S.OrganizationAnalytics(c.Request.Context(), middleware.Identity(c), org, utils.QueryInt(c, "days", 30))
	if !fail(c, err) {
		ok(c, out)
	}
}

// ── Store & settings ────────────────────────────────────────────────────────

func (h *H) Store(c *gin.Context) {
	st, err := h.S.GetStore(c.Request.Context(), middleware.Identity(c), middleware.StoreID(c))
	if !fail(c, err) {
		ok(c, gin.H{"store": st, "role": middleware.StoreRole(c)})
	}
}

func (h *H) UpdateStore(c *gin.Context) {
	var in services.StoreInput
	if !utils.Bind(c, &in) {
		return
	}
	st, err := h.S.UpdateStore(c.Request.Context(), middleware.Identity(c), middleware.StoreID(c), in)
	if !fail(c, err) {
		ok(c, st)
	}
}

func (h *H) Settings(c *gin.Context) {
	st, err := h.S.GetSettings(c.Request.Context(), middleware.Identity(c), middleware.StoreID(c))
	if !fail(c, err) {
		ok(c, st)
	}
}

func (h *H) SaveSettings(c *gin.Context) {
	var in struct {
		models.StoreSettings
		Reason string `json:"reason"`
	}
	if !utils.Bind(c, &in) {
		return
	}
	st, err := h.S.SaveSettings(c.Request.Context(), middleware.Identity(c), middleware.StoreID(c), in.StoreSettings, in.Reason)
	if !fail(c, err) {
		ok(c, st)
	}
}

// ── Products ────────────────────────────────────────────────────────────────

func (h *H) Products(c *gin.Context) {
	page, size, offset := utils.Pagination(c, 25, 200)
	f := repositories.ProductFilter{
		Query: c.Query("q"), CategoryID: c.Query("category_id"), Category: c.Query("category"),
		SupplierID: c.Query("supplier_id"), StockStatus: c.Query("stock_status"), Expired: c.Query("expired") == "true",
		IncludeInactive: c.Query("include_inactive") == "true", Sort: c.Query("sort"), Order: c.Query("order"),
		Limit: size, Offset: offset,
	}
	if v := c.Query("expiring_within"); v != "" {
		n := utils.QueryInt(c, "expiring_within", -1)
		if n < 0 || n > 3650 {
			utils.Respond(c, utils.BadRequest("expiring_within must be 0–3650 days"))
			return
		}
		f.ExpiringWithin = &n
	}
	for _, idf := range []string{f.CategoryID, f.SupplierID} {
		if idf != "" {
			if _, err := uuid.Parse(idf); err != nil {
				utils.Respond(c, utils.BadRequest("category_id/supplier_id must be UUIDs"))
				return
			}
		}
	}
	switch f.StockStatus {
	case "", "out", "low", "over", "in":
	default:
		utils.Respond(c, utils.BadRequest("stock_status must be out, low, over or in"))
		return
	}
	res, err := h.S.ListProducts(c.Request.Context(), middleware.Identity(c), middleware.StoreID(c), f)
	if fail(c, err) {
		return
	}
	res.Page, res.PageSize = page, size
	ok(c, res)
}

func (h *H) Product(c *gin.Context) {
	pid, okk := uuidParam(c, "product_id")
	if !okk {
		return
	}
	p, err := h.S.GetProduct(c.Request.Context(), middleware.Identity(c), middleware.StoreID(c), pid)
	if !fail(c, err) {
		ok(c, p)
	}
}

func (h *H) CreateProduct(c *gin.Context) {
	var in models.ProductInput
	if !utils.Bind(c, &in) {
		return
	}
	p, err := h.S.CreateProduct(c.Request.Context(), middleware.Identity(c), middleware.StoreID(c), in)
	if !fail(c, err) {
		created(c, p)
	}
}

func (h *H) UpdateProduct(c *gin.Context) {
	pid, okk := uuidParam(c, "product_id")
	if !okk {
		return
	}
	var in models.ProductInput
	if !utils.Bind(c, &in) {
		return
	}
	p, err := h.S.UpdateProduct(c.Request.Context(), middleware.Identity(c), middleware.StoreID(c), pid, in)
	if !fail(c, err) {
		ok(c, p)
	}
}

func (h *H) DeleteProduct(c *gin.Context) {
	pid, okk := uuidParam(c, "product_id")
	if !okk {
		return
	}
	if !fail(c, h.S.DeleteProduct(c.Request.Context(), middleware.Identity(c), middleware.StoreID(c), pid, c.Query("reason"))) {
		c.Status(http.StatusNoContent)
	}
}

// ImportProducts accepts a CSV/XLSX upload. Defences, in order: the request
// body is capped before multipart parsing, the file size is checked, the
// parser limits rows and (for XLSX, a zip) the decompressed size, and every
// row is validated and written inside one RLS-scoped transaction.
func (h *H) ImportProducts(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, services.MaxImportBytes+(1<<20))
	file, err := c.FormFile("file")
	if err != nil {
		utils.Respond(c, utils.BadRequest("Upload a file in the 'file' form field"))
		return
	}
	if file.Size > services.MaxImportBytes {
		utils.Respond(c, utils.BadRequest("File too large (max 10 MB)"))
		return
	}
	f, err := file.Open()
	if fail(c, err) {
		return
	}
	defer f.Close()
	records, err := services.ParseImportFile(file.Filename, f)
	if fail(c, err) {
		return
	}
	res, err := h.S.ImportProducts(c.Request.Context(), middleware.Identity(c), middleware.StoreID(c), records, services.ImportOptions{
		DryRun: c.PostForm("dry_run") == "true", UpdateExisting: c.PostForm("update_existing") == "true",
		SkipInvalid: c.PostForm("skip_invalid") == "true",
	})
	if !fail(c, err) {
		ok(c, res)
	}
}

func (h *H) ImportTemplate(c *gin.Context) {
	c.Header("Content-Disposition", `attachment; filename="priceiq-product-import-template.csv"`)
	c.Data(http.StatusOK, "text/csv; charset=utf-8", services.ImportTemplateCSV())
}

func (h *H) Categories(c *gin.Context) {
	out, err := h.S.ListCategories(c.Request.Context(), middleware.Identity(c), middleware.StoreID(c))
	if !fail(c, err) {
		ok(c, out)
	}
}

func (h *H) Suppliers(c *gin.Context) {
	out, err := h.S.ListSuppliers(c.Request.Context(), middleware.Identity(c), middleware.StoreID(c))
	if !fail(c, err) {
		ok(c, out)
	}
}

func (h *H) CreateSupplier(c *gin.Context) {
	var in struct {
		Name         string  `json:"name" binding:"required,max=120"`
		ContactEmail *string `json:"contact_email" binding:"omitempty,email"`
		Phone        *string `json:"phone" binding:"omitempty,max=20"`
		LeadTimeDays int     `json:"lead_time_days" binding:"omitempty,min=0,max=365"`
	}
	if !utils.Bind(c, &in) {
		return
	}
	if in.LeadTimeDays == 0 {
		in.LeadTimeDays = 3
	}
	out, err := h.S.CreateSupplier(c.Request.Context(), middleware.Identity(c), middleware.StoreID(c),
		models.Supplier{Name: strings.TrimSpace(in.Name), ContactEmail: in.ContactEmail, Phone: in.Phone, LeadTimeDays: in.LeadTimeDays})
	if !fail(c, err) {
		created(c, out)
	}
}

// ── Inventory ───────────────────────────────────────────────────────────────

func (h *H) InventoryOverview(c *gin.Context) {
	out, err := h.S.InventoryOverview(c.Request.Context(), middleware.Identity(c), middleware.StoreID(c))
	if !fail(c, err) {
		ok(c, out)
	}
}

func (h *H) ProductInventory(c *gin.Context) {
	pid, okk := uuidParam(c, "product_id")
	if !okk {
		return
	}
	out, err := h.S.ProductInventoryDetail(c.Request.Context(), middleware.Identity(c), middleware.StoreID(c), pid)
	if !fail(c, err) {
		ok(c, out)
	}
}

func (h *H) AdjustStock(c *gin.Context) {
	pid, okk := uuidParam(c, "product_id")
	if !okk {
		return
	}
	var in struct {
		Change int    `json:"change" binding:"required"`
		Reason string `json:"reason" binding:"required"`
		Note   string `json:"note" binding:"max=500"`
	}
	if !utils.Bind(c, &in) {
		return
	}
	stock, err := h.S.AdjustStock(c.Request.Context(), middleware.Identity(c), middleware.StoreID(c), pid, in.Change, in.Reason, in.Note)
	if !fail(c, err) {
		ok(c, gin.H{"product_id": pid, "stock": stock})
	}
}

func (h *H) Movements(c *gin.Context) {
	page, size, offset := utils.Pagination(c, 50, 200)
	pid := c.Query("product_id")
	if pid != "" {
		if _, err := uuid.Parse(pid); err != nil {
			utils.Respond(c, utils.BadRequest("product_id must be a UUID"))
			return
		}
	}
	res, err := h.S.InventoryMovements(c.Request.Context(), middleware.Identity(c), middleware.StoreID(c), pid, size, offset)
	if !fail(c, err) {
		res.Page, res.PageSize = page, size
		ok(c, res)
	}
}

func (h *H) ExpiryOptimization(c *gin.Context) {
	out, err := h.S.ExpiryOptimization(c.Request.Context(), middleware.StoreID(c))
	if !fail(c, err) {
		ok(c, out)
	}
}

// ── Sales & analytics ───────────────────────────────────────────────────────

func (h *H) rangeFrom(c *gin.Context) (services.Range, bool) {
	r, err := h.S.ResolveRange(c.Request.Context(), middleware.Identity(c), middleware.StoreID(c), c.Query("from"), c.Query("to"), utils.QueryInt(c, "days", 30))
	return r, !fail(c, err)
}

func (h *H) Sales(c *gin.Context) {
	r, okk := h.rangeFrom(c)
	if !okk {
		return
	}
	page, size, offset := utils.Pagination(c, 50, 500)
	pid := c.Query("product_id")
	if pid != "" {
		if _, err := uuid.Parse(pid); err != nil {
			utils.Respond(c, utils.BadRequest("product_id must be a UUID"))
			return
		}
	}
	res, err := h.S.ListSales(c.Request.Context(), middleware.Identity(c), middleware.StoreID(c), pid, r.From, r.To, size, offset)
	if !fail(c, err) {
		res.Page, res.PageSize = page, size
		ok(c, res)
	}
}

func (h *H) RecordSale(c *gin.Context) {
	var in models.SaleInput
	if !utils.Bind(c, &in) {
		return
	}
	s, err := h.S.RecordSale(c.Request.Context(), middleware.Identity(c), middleware.StoreID(c), in)
	if !fail(c, err) {
		created(c, s)
	}
}

func (h *H) Summary(c *gin.Context) {
	r, okk := h.rangeFrom(c)
	if !okk {
		return
	}
	out, err := h.S.Summary(c.Request.Context(), middleware.Identity(c), middleware.StoreID(c), r)
	if !fail(c, err) {
		ok(c, out)
	}
}

func (h *H) Trends(c *gin.Context) {
	r, okk := h.rangeFrom(c)
	if !okk {
		return
	}
	pid := c.Query("product_id")
	if pid != "" {
		if _, err := uuid.Parse(pid); err != nil {
			utils.Respond(c, utils.BadRequest("product_id must be a UUID"))
			return
		}
	}
	out, err := h.S.Trend(c.Request.Context(), middleware.Identity(c), middleware.StoreID(c), pid, r)
	if !fail(c, err) {
		ok(c, gin.H{"range": r, "points": out})
	}
}

func (h *H) CategoryPerformance(c *gin.Context) {
	r, okk := h.rangeFrom(c)
	if !okk {
		return
	}
	out, err := h.S.CategoryPerformance(c.Request.Context(), middleware.Identity(c), middleware.StoreID(c), r)
	if !fail(c, err) {
		ok(c, gin.H{"range": r, "categories": out})
	}
}

func (h *H) ProductPerformance(c *gin.Context) {
	r, okk := h.rangeFrom(c)
	if !okk {
		return
	}
	limit := utils.QueryInt(c, "limit", 10)
	if limit < 1 || limit > 100 {
		limit = 10
	}
	out, err := h.S.ProductPerformance(c.Request.Context(), middleware.Identity(c), middleware.StoreID(c), r,
		c.DefaultQuery("sort", "revenue"), c.DefaultQuery("order", "desc") == "desc", limit)
	if !fail(c, err) {
		ok(c, gin.H{"range": r, "products": out})
	}
}

func (h *H) Report(c *gin.Context) {
	r, okk := h.rangeFrom(c)
	if !okk {
		return
	}
	kind := c.Param("kind")
	rows, err := h.S.ReportCSV(c.Request.Context(), middleware.Identity(c), middleware.StoreID(c), kind, r)
	if fail(c, err) {
		return
	}
	var buf bytes.Buffer
	buf.WriteString("\xef\xbb\xbf") // BOM so Excel opens UTF-8 (₹) correctly
	w := csv.NewWriter(&buf)
	_ = w.WriteAll(services.SafeCSV(rows))
	name := fmt.Sprintf("priceiq-%s-%s-to-%s.csv", kind, r.From.Format("20060102"), r.To.AddDate(0, 0, -1).Format("20060102"))
	c.Header("Content-Disposition", `attachment; filename="`+name+`"`)
	c.Data(http.StatusOK, "text/csv; charset=utf-8", buf.Bytes())
}
