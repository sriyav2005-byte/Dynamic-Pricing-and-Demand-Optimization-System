// Package utils holds cross-cutting helpers: API errors, response writing,
// pagination and numeric helpers.
package utils

import (
	"errors"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/go-playground/validator/v10"

	"github.com/rishabh26raj/priceiq/backend-go/database"
)

// APIError is the single error type rendered to clients:
//
//	{"error": {"code": "not_found", "message": "...", "details": ...}}
type APIError struct {
	Status  int    `json:"-"`
	Code    string `json:"code"`
	Message string `json:"message"`
	Details any    `json:"details,omitempty"`
}

func (e *APIError) Error() string { return e.Message }

func NewError(status int, code, msg string) *APIError {
	return &APIError{Status: status, Code: code, Message: msg}
}

func BadRequest(msg string) *APIError { return NewError(http.StatusBadRequest, "bad_request", msg) }
func NotFound(what string) *APIError {
	return NewError(http.StatusNotFound, "not_found", what+" not found")
}
func Forbidden(msg string) *APIError { return NewError(http.StatusForbidden, "forbidden", msg) }
func Unauthorized(msg string) *APIError {
	return NewError(http.StatusUnauthorized, "unauthorized", msg)
}
func Conflict(msg string) *APIError { return NewError(http.StatusConflict, "conflict", msg) }
func Unprocessable(msg string, details any) *APIError {
	return &APIError{Status: http.StatusUnprocessableEntity, Code: "validation_failed", Message: msg, Details: details}
}
func Unavailable(msg string) *APIError {
	return NewError(http.StatusServiceUnavailable, "service_unavailable", msg)
}

// Friendly messages for known constraint names.
var constraintMessages = map[string]string{
	"products_store_sku_ci_uq":                      "A product with this SKU already exists in this store",
	"products_store_barcode_uq":                     "A product with this barcode already exists in this store",
	"products_price_le_mrp":                         "Selling price cannot exceed MRP",
	"products_cost_le_mrp":                          "Cost price cannot exceed MRP",
	"products_stock_check":                          "Stock cannot be negative",
	"products_cost_price_check":                     "Cost price cannot be negative",
	"products_selling_price_check":                  "Selling price must be greater than zero",
	"products_mrp_check":                            "MRP must be greater than zero",
	"sales_quantity_check":                          "Sale quantity must be greater than zero",
	"stores_organization_id_code_key":               "A store with this code already exists",
	"categories_organization_id_name_parent_id_key": "Category already exists",
	"suppliers_organization_id_name_key":            "Supplier already exists",
}

// FromDB converts database errors into API errors.
func FromDB(err error) *APIError {
	if err == nil {
		return nil
	}
	var apiErr *APIError
	if errors.As(err, &apiErr) {
		return apiErr
	}
	if database.IsNotFound(err) {
		return NotFound("resource")
	}
	constraint := database.PgConstraint(err)
	msg := constraintMessages[constraint]
	switch database.PgCode(err) {
	case database.CodeUniqueViolation:
		if msg == "" {
			msg = "Resource already exists"
		}
		return &APIError{Status: http.StatusConflict, Code: "duplicate", Message: msg, Details: gin.H{"constraint": constraint}}
	case database.CodeCheckViolation, database.CodeNotNullViolation:
		if msg == "" {
			msg = "Data violates an integrity rule"
		}
		return &APIError{Status: http.StatusUnprocessableEntity, Code: "integrity_violation", Message: msg, Details: gin.H{"constraint": constraint}}
	case database.CodeForeignKeyViolation:
		return Unprocessable("Referenced record does not exist", gin.H{"constraint": constraint})
	case database.CodeInsufficientPriv:
		return Forbidden("You do not have permission to perform this action")
	case database.CodeInvalidText:
		return BadRequest("Malformed identifier or value")
	}
	return nil
}

// Respond writes an error (APIError, DB error or unexpected error).
func Respond(c *gin.Context, err error) {
	var apiErr *APIError
	if !errors.As(err, &apiErr) {
		if apiErr = FromDB(err); apiErr == nil {
			var ve validator.ValidationErrors
			if errors.As(err, &ve) {
				apiErr = Unprocessable("Invalid request body", validationDetails(ve))
			} else {
				slog.Error("unhandled error", "path", c.FullPath(), "err", err)
				apiErr = NewError(http.StatusInternalServerError, "internal", "Internal server error")
			}
		}
	}
	c.AbortWithStatusJSON(apiErr.Status, gin.H{"error": apiErr})
}

func validationDetails(ve validator.ValidationErrors) map[string]string {
	out := make(map[string]string, len(ve))
	for _, fe := range ve {
		field := strings.ToLower(fe.Field())
		switch fe.Tag() {
		case "required":
			out[field] = "is required"
		case "uuid":
			out[field] = "must be a valid UUID"
		case "oneof":
			out[field] = "must be one of: " + fe.Param()
		default:
			out[field] = fmt.Sprintf("failed %s=%s", fe.Tag(), fe.Param())
		}
	}
	return out
}

// Bind parses JSON into dst and converts binding errors into 422s.
func Bind(c *gin.Context, dst any) bool {
	if err := c.ShouldBindJSON(dst); err != nil {
		var ve validator.ValidationErrors
		if errors.As(err, &ve) {
			Respond(c, Unprocessable("Invalid request body", validationDetails(ve)))
		} else {
			Respond(c, BadRequest("Malformed JSON: "+err.Error()))
		}
		return false
	}
	return true
}

// ── Pagination & query helpers ──────────────────────────────────────────────

func Pagination(c *gin.Context, defSize, maxSize int) (page, size, offset int) {
	page, _ = strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ = strconv.Atoi(c.DefaultQuery("page_size", strconv.Itoa(defSize)))
	if page < 1 {
		page = 1
	}
	if size < 1 {
		size = defSize
	}
	if size > maxSize {
		size = maxSize
	}
	return page, size, (page - 1) * size
}

func QueryInt(c *gin.Context, key string, def int) int {
	if v, err := strconv.Atoi(c.Query(key)); err == nil {
		return v
	}
	return def
}

func QueryFloat(c *gin.Context, key string) *float64 {
	if v, err := strconv.ParseFloat(c.Query(key), 64); err == nil {
		return &v
	}
	return nil
}

// ── Numeric helpers ─────────────────────────────────────────────────────────

func Round2(v float64) float64 { return math.Round(v*100) / 100 }
func Round4(v float64) float64 { return math.Round(v*10000) / 10000 }

func Clamp(v, lo, hi float64) float64 { return math.Max(lo, math.Min(hi, v)) }
