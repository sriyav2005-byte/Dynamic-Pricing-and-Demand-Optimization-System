package services

import (
	"context"
	"math"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/rishabh26raj/priceiq/backend-go/clients"
	"github.com/rishabh26raj/priceiq/backend-go/database"
	"github.com/rishabh26raj/priceiq/backend-go/models"
	"github.com/rishabh26raj/priceiq/backend-go/repositories"
	"github.com/rishabh26raj/priceiq/backend-go/utils"
)

const (
	serviceLevelZ     = 1.65 // ≈95% cycle service level
	reviewPeriodDays  = 7
	minDaysForStats   = 7 // days with sales in the 28-day window needed for σ-based metrics
	velocityWindowDay = 28
)

// ProductInventory is the per-product inventory intelligence record.
type ProductInventory struct {
	ProductID    string  `json:"product_id"`
	Name         string  `json:"name"`
	SKU          string  `json:"sku"`
	Category     *string `json:"category"`
	Stock        int     `json:"stock"`
	CostPrice    float64 `json:"cost_price"`
	SellingPrice float64 `json:"selling_price"`

	AvgDailyUnits    float64    `json:"avg_daily_units"`
	StdDailyUnits    float64    `json:"std_daily_units"`
	DaysWithSales28d int        `json:"days_with_sales_28d"`
	DataSufficiency  string     `json:"data_sufficiency"` // OK | LIMITED | NONE
	LastSoldAt       *time.Time `json:"last_sold_at"`
	LeadTimeDays     int        `json:"lead_time_days"`

	DaysOfCover       *float64 `json:"days_of_cover"`
	PredictedStockout *string  `json:"predicted_stockout_date"`
	SafetyStockRec    *int     `json:"recommended_safety_stock"`
	ReorderPoint      *int     `json:"reorder_point"`
	ReorderQty        int      `json:"recommended_reorder_qty"`
	ConfiguredReorder int      `json:"configured_reorder_level"`
	ConfiguredSafety  int      `json:"configured_safety_stock"`

	ExpiryDate            *string  `json:"expiry_date"`
	DaysToExpiry          *int     `json:"days_to_expiry"`
	ExpectedSalesToExpiry *float64 `json:"expected_sales_before_expiry"`
	UnitsAtExpiryRisk     *int     `json:"units_at_expiry_risk"`
	ExpiryRisk            string   `json:"expiry_risk"` // NONE | LOW | MEDIUM | HIGH | CRITICAL | EXPIRED
	// Wastage risk = share of the stock on hand that is not expected to sell
	// before the batch expires at the current sales velocity (0–100).
	WastageRiskPct *float64 `json:"wastage_risk_pct"`
	IsPerishable   bool     `json:"is_perishable"`
	ShelfLifeDays  *int     `json:"shelf_life_days"`

	ValueAtCost   float64 `json:"value_at_cost"`
	ValueAtRetail float64 `json:"value_at_retail"`

	Statuses []string `json:"statuses"` // OUT_OF_STOCK, LOW_STOCK, PREDICTED_STOCKOUT, OVERSTOCK, DEAD_STOCK, EXPIRY_RISK
}

type InventoryOverview struct {
	ReferenceTime    time.Time           `json:"reference_time"`
	DataMode         string              `json:"data_mode"`
	TotalProducts    int                 `json:"total_products"`
	TotalUnits       int                 `json:"total_units"`
	ValueAtCost      float64             `json:"value_at_cost"`
	ValueAtRetail    float64             `json:"value_at_retail"`
	ExpiryRiskValue  float64             `json:"expiry_risk_value_at_cost"`
	StatusCounts     map[string]int      `json:"status_counts"`
	ExpiryRiskCounts map[string]int      `json:"expiry_risk_counts"`
	Categories       []CategoryInventory `json:"categories"`
	Products         []ProductInventory  `json:"products"`
}

type CategoryInventory struct {
	Category    string  `json:"category"`
	Products    int     `json:"products"`
	Units       int     `json:"units"`
	ValueAtCost float64 `json:"value_at_cost"`
	AtRisk      int     `json:"at_risk"`
	HealthPct   float64 `json:"health_pct"`
}

// ComputeInventory derives inventory intelligence for one product. It is a
// pure function so it can be unit tested.
//
// ref anchors the historical windows (dead stock); now anchors projections
// (predicted stockout date). They differ only for SYNTHETIC stores.
func ComputeInventory(p models.Product, avg, std float64, daysWithSales int, lastSold *time.Time, lead int,
	ref, now time.Time, st models.StoreSettings) ProductInventory {

	pi := ProductInventory{
		ProductID: p.ID, Name: p.Name, SKU: p.SKU, Category: p.Category, Stock: p.Stock,
		CostPrice: p.CostPrice, SellingPrice: p.SellingPrice,
		AvgDailyUnits: utils.Round2(avg), StdDailyUnits: utils.Round2(std), DaysWithSales28d: daysWithSales,
		LastSoldAt: lastSold, LeadTimeDays: lead, ConfiguredReorder: p.ReorderLevel, ConfiguredSafety: p.SafetyStock,
		ExpiryDate: p.ExpiryDate, DaysToExpiry: p.DaysToExpiry,
		ValueAtCost: utils.Round2(float64(p.Stock) * p.CostPrice), ValueAtRetail: utils.Round2(float64(p.Stock) * p.SellingPrice),
		ExpiryRisk: "NONE", Statuses: []string{},
		IsPerishable: p.IsPerishable, ShelfLifeDays: p.ShelfLifeDays,
	}
	switch {
	case daysWithSales >= minDaysForStats:
		pi.DataSufficiency = "OK"
	case daysWithSales > 0:
		pi.DataSufficiency = "LIMITED"
	default:
		pi.DataSufficiency = "NONE"
	}

	if avg > 0 {
		cover := float64(p.Stock) / avg
		pi.DaysOfCover = ptr(utils.Round2(cover))
		d := now.Add(time.Duration(cover * 24 * float64(time.Hour))).Format("2006-01-02")
		pi.PredictedStockout = &d
	}
	// σ-based safety stock only when there is enough history; never invented.
	safety := p.SafetyStock
	if pi.DataSufficiency == "OK" {
		rec := int(math.Ceil(serviceLevelZ * std * math.Sqrt(float64(lead))))
		pi.SafetyStockRec = &rec
		if safety == 0 {
			safety = rec
		}
	}
	if avg > 0 {
		rop := int(math.Ceil(avg*float64(lead))) + safety
		if p.ReorderLevel > 0 {
			rop = p.ReorderLevel
		}
		pi.ReorderPoint = &rop
		target := avg*float64(lead+reviewPeriodDays) + float64(safety)
		if q := int(math.Ceil(target)) - p.Stock; q > 0 && p.Stock <= rop {
			pi.ReorderQty = q
		}
	} else if p.ReorderLevel > 0 {
		pi.ReorderPoint = &p.ReorderLevel
	}

	// Stock statuses
	switch {
	case p.Stock == 0:
		pi.Statuses = append(pi.Statuses, "OUT_OF_STOCK")
	case pi.ReorderPoint != nil && p.Stock <= *pi.ReorderPoint,
		pi.DaysOfCover != nil && *pi.DaysOfCover < float64(st.LowStockCoverDays):
		pi.Statuses = append(pi.Statuses, "LOW_STOCK")
	}
	if p.Stock > 0 && pi.DaysOfCover != nil && *pi.DaysOfCover < float64(lead) {
		pi.Statuses = append(pi.Statuses, "PREDICTED_STOCKOUT")
	}
	if pi.DaysOfCover != nil && *pi.DaysOfCover > float64(st.OverstockCoverDays) {
		pi.Statuses = append(pi.Statuses, "OVERSTOCK")
	}
	deadCutoff := ref.AddDate(0, 0, -st.DeadStockDays)
	if p.Stock > 0 && (lastSold == nil || lastSold.Before(deadCutoff)) {
		pi.Statuses = append(pi.Statuses, "DEAD_STOCK")
	}

	// Expiry risk: units not expected to sell before expiry at current velocity.
	if p.DaysToExpiry != nil && p.Stock > 0 {
		dte := *p.DaysToExpiry
		if dte < 0 {
			pi.ExpiryRisk = "EXPIRED"
			pi.UnitsAtExpiryRisk = &p.Stock
		} else {
			expected := avg * float64(dte)
			pi.ExpectedSalesToExpiry = ptr(utils.Round2(expected))
			atRisk := p.Stock - int(math.Floor(expected))
			if atRisk < 0 {
				atRisk = 0
			}
			pi.UnitsAtExpiryRisk = &atRisk
			switch {
			case atRisk == 0 && dte <= st.ExpiryMarkdownDays:
				pi.ExpiryRisk = "LOW"
			case atRisk == 0:
				pi.ExpiryRisk = "NONE"
			case dte <= 3:
				pi.ExpiryRisk = "CRITICAL"
			case dte <= st.ExpiryMarkdownDays:
				pi.ExpiryRisk = "HIGH"
			default:
				pi.ExpiryRisk = "MEDIUM"
			}
		}
		if pi.UnitsAtExpiryRisk != nil {
			pi.WastageRiskPct = ptr(utils.Round2(100 * float64(*pi.UnitsAtExpiryRisk) / float64(p.Stock)))
		}
		if pi.ExpiryRisk != "NONE" && pi.ExpiryRisk != "LOW" {
			pi.Statuses = append(pi.Statuses, "EXPIRY_RISK")
		}
	}
	return pi
}

func ptr[T any](v T) *T { return &v }

// InventoryOverview computes intelligence for every active product in a store.
// Results are cached per store version (invalidated on any write).
func (s *Service) InventoryOverview(ctx context.Context, id database.Identity, storeID string) (InventoryOverview, error) {
	return s.inventoryOverview(ctx, func(fn func(pgx.Tx) error) error { return s.DB.WithUser(ctx, id, fn) }, storeID)
}

// runner executes fn in either a user or a system transaction.
type runner func(fn func(pgx.Tx) error) error

func (s *Service) systemRunner(ctx context.Context) runner {
	return func(fn func(pgx.Tx) error) error { return s.DB.WithSystem(ctx, fn) }
}

func (s *Service) inventoryOverview(ctx context.Context, run runner, storeID string) (InventoryOverview, error) {
	key := "inv:" + storeID + ":" + clients.StoreVersion(ctx, s.Cache, storeID)
	var ov InventoryOverview
	if clients.GetJSON(ctx, s.Cache, key, &ov) {
		return ov, nil
	}
	err := run(func(tx pgx.Tx) error {
		st, err := repositories.GetSettings(ctx, tx, storeID)
		if err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, "select app.store_reference_time($1), data_mode from stores where id=$1", storeID).
			Scan(&ov.ReferenceTime, &ov.DataMode); err != nil {
			return err
		}
		products, _, err := repositories.ListProducts(ctx, tx, storeID, repositories.ProductFilter{Limit: 100000})
		if err != nil {
			return err
		}
		metrics, err := repositories.InventoryMetrics(ctx, tx, storeID)
		if err != nil {
			return err
		}
		ov.StatusCounts = map[string]int{}
		ov.ExpiryRiskCounts = map[string]int{}
		cats := map[string]*CategoryInventory{}
		for _, p := range products {
			m := metrics[p.ID]
			pi := ComputeInventory(p, m.Avg, m.Std, m.DaysWithSales, m.LastSold, m.LeadTime, ov.ReferenceTime, time.Now(), st)
			ov.Products = append(ov.Products, pi)
			ov.TotalProducts++
			ov.TotalUnits += p.Stock
			ov.ValueAtCost += pi.ValueAtCost
			ov.ValueAtRetail += pi.ValueAtRetail
			for _, s := range pi.Statuses {
				ov.StatusCounts[s]++
			}
			ov.ExpiryRiskCounts[pi.ExpiryRisk]++
			if pi.UnitsAtExpiryRisk != nil {
				ov.ExpiryRiskValue += float64(*pi.UnitsAtExpiryRisk) * p.CostPrice
			}
			cname := "Uncategorised"
			if p.Category != nil {
				cname = *p.Category
			}
			c := cats[cname]
			if c == nil {
				c = &CategoryInventory{Category: cname}
				cats[cname] = c
			}
			c.Products++
			c.Units += p.Stock
			c.ValueAtCost += pi.ValueAtCost
			if len(pi.Statuses) > 0 {
				c.AtRisk++
			}
		}
		for _, c := range cats {
			c.ValueAtCost = utils.Round2(c.ValueAtCost)
			c.HealthPct = utils.Round2(100 * float64(c.Products-c.AtRisk) / float64(c.Products))
			ov.Categories = append(ov.Categories, *c)
		}
		sort.Slice(ov.Categories, func(i, j int) bool { return ov.Categories[i].HealthPct < ov.Categories[j].HealthPct })
		ov.ValueAtCost, ov.ValueAtRetail = utils.Round2(ov.ValueAtCost), utils.Round2(ov.ValueAtRetail)
		ov.ExpiryRiskValue = utils.Round2(ov.ExpiryRiskValue)
		if ov.Products == nil {
			ov.Products = []ProductInventory{}
		}
		return nil
	})
	if err == nil {
		clients.SetJSON(ctx, s.Cache, key, ov, 5*time.Minute)
	}
	return ov, err
}

// ProductInventoryDetail returns intelligence for one product.
func (s *Service) ProductInventoryDetail(ctx context.Context, id database.Identity, storeID, productID string) (ProductInventory, error) {
	ov, err := s.InventoryOverview(ctx, id, storeID)
	if err != nil {
		return ProductInventory{}, err
	}
	for _, p := range ov.Products {
		if p.ProductID == productID {
			return p, nil
		}
	}
	return ProductInventory{}, utils.NotFound("Product")
}

func (s *Service) InventoryMovements(ctx context.Context, id database.Identity, storeID, productID string, limit, offset int) (models.Page[models.InventoryMovement], error) {
	var page models.Page[models.InventoryMovement]
	err := s.DB.WithUser(ctx, id, func(tx pgx.Tx) error {
		var err error
		page.Data, page.Total, err = repositories.ListMovements(ctx, tx, storeID, productID, limit, offset)
		return err
	})
	return page, err
}
