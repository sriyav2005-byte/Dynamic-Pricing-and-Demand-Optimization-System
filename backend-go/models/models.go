// Package models defines the API/domain types shared by repositories,
// services and controllers.
package models

import (
	"encoding/json"
	"time"
)

// ── Roles ───────────────────────────────────────────────────────────────────

type Role string

const (
	RoleViewer       Role = "VIEWER"
	RoleAnalyst      Role = "ANALYST"
	RoleStoreManager Role = "STORE_MANAGER"
	RoleAdmin        Role = "ADMIN"
	RoleSuperAdmin   Role = "SUPER_ADMIN"
)

var roleRank = map[Role]int{RoleViewer: 1, RoleAnalyst: 2, RoleStoreManager: 3, RoleAdmin: 4, RoleSuperAdmin: 5}

// Rank orders roles; unknown roles rank 0.
func (r Role) Rank() int { return roleRank[r] }

// AtLeast reports whether r grants at least the privileges of min.
func (r Role) AtLeast(min Role) bool { return r.Rank() > 0 && r.Rank() >= min.Rank() }

func (r Role) Valid() bool { _, ok := roleRank[r]; return ok }

// ── Tenancy ─────────────────────────────────────────────────────────────────

type Profile struct {
	ID           string    `json:"id"`
	Email        *string   `json:"email"`
	FullName     *string   `json:"full_name"`
	Phone        *string   `json:"phone"`
	IsSuperAdmin bool      `json:"is_super_admin"`
	CreatedAt    time.Time `json:"created_at"`
}

type StoreAccess struct {
	StoreID          string  `json:"store_id"`
	StoreName        string  `json:"store_name"`
	StoreCode        string  `json:"store_code"`
	City             *string `json:"city"`
	DataMode         string  `json:"data_mode"`
	OrganizationID   string  `json:"organization_id"`
	OrganizationName string  `json:"organization_name"`
	Role             Role    `json:"role"`
}

type Me struct {
	Profile Profile       `json:"profile"`
	Stores  []StoreAccess `json:"stores"`
}

type Store struct {
	ID             string    `json:"id"`
	OrganizationID string    `json:"organization_id"`
	Name           string    `json:"name"`
	Code           string    `json:"code"`
	City           *string   `json:"city"`
	State          *string   `json:"state"`
	Pincode        *string   `json:"pincode"`
	Latitude       *float64  `json:"latitude"`
	Longitude      *float64  `json:"longitude"`
	Timezone       string    `json:"timezone"`
	DataMode       string    `json:"data_mode"`
	IsActive       bool      `json:"is_active"`
	CreatedAt      time.Time `json:"created_at"`
}

type Member struct {
	MembershipID string  `json:"membership_id"`
	UserID       string  `json:"user_id"`
	Email        *string `json:"email"`
	FullName     *string `json:"full_name"`
	StoreID      *string `json:"store_id"`
	StoreName    *string `json:"store_name"`
	Role         Role    `json:"role"`
}

type StoreSettings struct {
	StoreID                 string          `json:"store_id"`
	PricingMode             string          `json:"pricing_mode"`
	MinMarginPct            float64         `json:"min_margin_pct"`
	MaxPriceChangePct       float64         `json:"max_price_change_pct"`
	ApprovalThresholdPct    float64         `json:"approval_threshold_pct"`
	ExpiryMarkdownDays      int             `json:"expiry_markdown_days"`
	MaxExpiryMarkdownPct    float64         `json:"max_expiry_markdown_pct"`
	AllowBelowCostClearance bool            `json:"allow_below_cost_clearance"`
	LowStockCoverDays       int             `json:"low_stock_cover_days"`
	OverstockCoverDays      int             `json:"overstock_cover_days"`
	DeadStockDays           int             `json:"dead_stock_days"`
	CompetitorUndercutPct   float64         `json:"competitor_undercut_pct"`
	Rules                   json.RawMessage `json:"rules"`
	UpdatedAt               time.Time       `json:"updated_at"`
}

// ── Catalogue ───────────────────────────────────────────────────────────────

type Product struct {
	ID              string  `json:"id"`
	StoreID         string  `json:"store_id"`
	LegacyProductID *int    `json:"legacy_product_id"`
	SKU             string  `json:"sku"`
	Barcode         *string `json:"barcode"`
	Name            string  `json:"name"`
	Brand           *string `json:"brand"`
	CategoryID      *string `json:"category_id"`
	Category        *string `json:"category"`
	Subcategory     *string `json:"subcategory"`
	SupplierID      *string `json:"supplier_id"`
	Supplier        *string `json:"supplier"`
	ImageURL        *string `json:"image_url"`
	CostPrice       float64 `json:"cost_price"`
	SellingPrice    float64 `json:"selling_price"`
	MRP             float64 `json:"mrp"`
	Stock           int     `json:"stock"`
	ReorderLevel    int     `json:"reorder_level"`
	SafetyStock     int     `json:"safety_stock"`
	ExpiryDate      *string `json:"expiry_date"`
	DaysToExpiry    *int    `json:"days_to_expiry"`
	BatchNumber     *string `json:"batch_number"`
	SeasonFactor    float64 `json:"season_factor"`
	IsPerishable    bool    `json:"is_perishable"`
	// Perishable / sensitivity attributes (nil = not assessed). Sensitivities
	// are 0–1 and scale store- or category-wide seasonal considerations.
	PackSize            *string   `json:"pack_size"`
	ShelfLifeDays       *int      `json:"shelf_life_days"`
	SeasonalSensitivity *float64  `json:"seasonal_sensitivity"`
	FestivalSensitivity *float64  `json:"festival_sensitivity"`
	WeatherSensitivity  *float64  `json:"weather_sensitivity"`
	IsActive            bool      `json:"is_active"`
	IsSynthetic         bool      `json:"is_synthetic"`
	MarginPct           float64   `json:"margin_pct"`
	CreatedAt           time.Time `json:"created_at"`
	UpdatedAt           time.Time `json:"updated_at"`
}

// ProductInput is used for create (all required fields validated in service)
// and, with pointer semantics, for partial updates.
type ProductInput struct {
	SKU          *string  `json:"sku"`
	Barcode      *string  `json:"barcode"`
	Name         *string  `json:"name"`
	Brand        *string  `json:"brand"`
	CategoryID   *string  `json:"category_id"`
	Category     *string  `json:"category"` // name; created on demand
	Subcategory  *string  `json:"subcategory"`
	SupplierID   *string  `json:"supplier_id"`
	Supplier     *string  `json:"supplier"` // name; created on demand
	ImageURL     *string  `json:"image_url"`
	CostPrice    *float64 `json:"cost_price"`
	SellingPrice *float64 `json:"selling_price"`
	MRP          *float64 `json:"mrp"`
	Stock        *int     `json:"stock"`
	ReorderLevel *int     `json:"reorder_level"`
	SafetyStock  *int     `json:"safety_stock"`
	ExpiryDate   *string  `json:"expiry_date"`
	BatchNumber  *string  `json:"batch_number"`
	SeasonFactor *float64 `json:"season_factor"`
	IsPerishable *bool    `json:"is_perishable"`
	PackSize     *string  `json:"pack_size"`
	// Optional numeric attributes: omitted/null leaves the value unchanged,
	// a negative number clears it.
	ShelfLifeDays       *int     `json:"shelf_life_days"`
	SeasonalSensitivity *float64 `json:"seasonal_sensitivity"`
	FestivalSensitivity *float64 `json:"festival_sensitivity"`
	WeatherSensitivity  *float64 `json:"weather_sensitivity"`
	IsActive            *bool    `json:"is_active"`
	Reason              *string  `json:"reason"` // recorded in audit / price history
}

type Category struct {
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	ParentID *string `json:"parent_id"`
	Products int     `json:"products"`
}

type Supplier struct {
	ID           string  `json:"id"`
	Name         string  `json:"name"`
	ContactEmail *string `json:"contact_email"`
	Phone        *string `json:"phone"`
	LeadTimeDays int     `json:"lead_time_days"`
}

// ── Sales & inventory ───────────────────────────────────────────────────────

type Sale struct {
	ID               string    `json:"id"`
	StoreID          string    `json:"store_id"`
	ProductID        string    `json:"product_id"`
	ProductName      string    `json:"product_name"`
	Quantity         int       `json:"quantity"`
	UnitPrice        float64   `json:"unit_price"`
	UnitCost         float64   `json:"unit_cost"`
	Revenue          float64   `json:"revenue"`
	Profit           float64   `json:"profit"`
	RecommendationID *string   `json:"recommendation_id"`
	Source           string    `json:"source"`
	SoldAt           time.Time `json:"sold_at"`
}

type SaleInput struct {
	ProductID        string     `json:"product_id" binding:"required,uuid"`
	Quantity         int        `json:"quantity" binding:"required,gt=0,lte=100000"`
	UnitPrice        *float64   `json:"unit_price" binding:"omitempty,gte=0"`
	RecommendationID *string    `json:"recommendation_id" binding:"omitempty,uuid"`
	SoldAt           *time.Time `json:"sold_at"`
	Source           string     `json:"source" binding:"omitempty,oneof=POS MANUAL IMPORT"`
}

type InventoryMovement struct {
	ID          string    `json:"id"`
	ProductID   string    `json:"product_id"`
	ProductName string    `json:"product_name"`
	Change      int       `json:"change"`
	Reason      string    `json:"reason"`
	StockAfter  int       `json:"stock_after"`
	Note        *string   `json:"note"`
	CreatedBy   *string   `json:"created_by"`
	CreatedAt   time.Time `json:"created_at"`
}

// ── Common envelopes ────────────────────────────────────────────────────────

type Page[T any] struct {
	Data     []T `json:"data"`
	Page     int `json:"page"`
	PageSize int `json:"page_size"`
	Total    int `json:"total"`
}
