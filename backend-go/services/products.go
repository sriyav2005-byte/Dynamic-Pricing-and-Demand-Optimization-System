package services

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/rishabh26raj/priceiq/backend-go/database"
	"github.com/rishabh26raj/priceiq/backend-go/models"
	"github.com/rishabh26raj/priceiq/backend-go/repositories"
	"github.com/rishabh26raj/priceiq/backend-go/utils"
)

var (
	skuPattern     = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._/\-]{0,63}$`)
	barcodePattern = regexp.MustCompile(`^[A-Za-z0-9\-]{6,32}$`)
	digitsOnly     = regexp.MustCompile(`^[0-9]+$`)
)

// ValidGTIN verifies the check digit of EAN-8, UPC-A, EAN-13 and GTIN-14 codes.
func ValidGTIN(code string) bool {
	n := len(code)
	if !digitsOnly.MatchString(code) || (n != 8 && n != 12 && n != 13 && n != 14) {
		return false
	}
	sum := 0
	for i := 0; i < n-1; i++ {
		d := int(code[n-2-i] - '0')
		if i%2 == 0 {
			d *= 3
		}
		sum += d
	}
	return (10-sum%10)%10 == int(code[n-1]-'0')
}

// ValidateProductRow enforces data-integrity rules beyond DB constraints.
// isNew relaxes nothing; oldExpiry lets an unchanged past expiry be kept.
func ValidateProductRow(r repositories.ProductRow, isNew bool, oldExpiry *string, allowBelowCost bool) map[string]string {
	errs := map[string]string{}
	if strings.TrimSpace(r.Name) == "" {
		errs["name"] = "is required"
	} else if len(r.Name) > 200 {
		errs["name"] = "must be at most 200 characters"
	}
	if !skuPattern.MatchString(r.SKU) {
		errs["sku"] = "must be 1–64 characters: letters, digits, . _ / -"
	}
	if r.Barcode != nil {
		bc := *r.Barcode
		switch {
		case !barcodePattern.MatchString(bc):
			errs["barcode"] = "must be 6–32 letters/digits"
		case digitsOnly.MatchString(bc) && (len(bc) == 8 || len(bc) == 12 || len(bc) == 13 || len(bc) == 14) && !ValidGTIN(bc):
			errs["barcode"] = "has an invalid GTIN/EAN check digit"
		}
	}
	if r.CostPrice < 0 {
		errs["cost_price"] = "cannot be negative"
	}
	if r.SellingPrice <= 0 {
		errs["selling_price"] = "must be greater than zero"
	}
	if r.MRP <= 0 {
		errs["mrp"] = "must be greater than zero"
	}
	if r.MRP > 0 && r.SellingPrice > r.MRP {
		errs["selling_price"] = "cannot exceed MRP"
	}
	if r.MRP > 0 && r.CostPrice > r.MRP {
		errs["cost_price"] = "cannot exceed MRP"
	}
	if !allowBelowCost && r.SellingPrice > 0 && r.SellingPrice < r.CostPrice {
		errs["selling_price"] = "is below cost price (enable below-cost clearance in settings to allow)"
	}
	if r.Stock < 0 {
		errs["stock"] = "cannot be negative"
	}
	if r.ReorderLevel < 0 {
		errs["reorder_level"] = "cannot be negative"
	}
	if r.SafetyStock < 0 {
		errs["safety_stock"] = "cannot be negative"
	}
	if r.SeasonFactor < 0.1 || r.SeasonFactor > 5 {
		errs["season_factor"] = "must be between 0.1 and 5"
	}
	if r.ExpiryDate != nil {
		d, err := time.Parse("2006-01-02", *r.ExpiryDate)
		today := time.Now().UTC().Truncate(24 * time.Hour)
		switch {
		case err != nil:
			errs["expiry_date"] = "must be a date in YYYY-MM-DD format"
		case d.After(today.AddDate(15, 0, 0)):
			errs["expiry_date"] = "is unrealistically far in the future"
		case d.Before(today) && (isNew || oldExpiry == nil || *oldExpiry != *r.ExpiryDate):
			errs["expiry_date"] = "cannot be in the past"
		}
	}
	if r.ShelfLifeDays != nil && (*r.ShelfLifeDays < 1 || *r.ShelfLifeDays > 3650) {
		errs["shelf_life_days"] = "must be between 1 and 3650 days"
	}
	for field, v := range map[string]*float64{"seasonal_sensitivity": r.SeasonalSensitivity,
		"festival_sensitivity": r.FestivalSensitivity, "weather_sensitivity": r.WeatherSensitivity} {
		if v != nil && (*v < 0 || *v > 1) {
			errs[field] = "must be between 0 and 1"
		}
	}
	if r.PackSize != nil && len(*r.PackSize) > 40 {
		errs["pack_size"] = "must be at most 40 characters"
	}
	if r.CategoryID != nil {
		if _, err := uuid.Parse(*r.CategoryID); err != nil {
			errs["category_id"] = "must be a UUID"
		}
	}
	if r.SupplierID != nil {
		if _, err := uuid.Parse(*r.SupplierID); err != nil {
			errs["supplier_id"] = "must be a UUID"
		}
	}
	return errs
}

// mergeProduct applies an input onto an existing row (or zero row for create).
func (s *Service) mergeProduct(ctx context.Context, tx pgx.Tx, storeID string, base repositories.ProductRow, in models.ProductInput) (repositories.ProductRow, error) {
	r := base
	if in.SKU != nil {
		r.SKU = strings.TrimSpace(*in.SKU)
	}
	if in.Name != nil {
		r.Name = strings.TrimSpace(*in.Name)
	}
	if in.Barcode != nil {
		r.Barcode = trimPtr(in.Barcode)
	}
	if in.Brand != nil {
		r.Brand = trimPtr(in.Brand)
	}
	if in.Subcategory != nil {
		r.Subcategory = trimPtr(in.Subcategory)
	}
	if in.ImageURL != nil {
		r.ImageURL = trimPtr(in.ImageURL)
	}
	if in.BatchNumber != nil {
		r.BatchNumber = trimPtr(in.BatchNumber)
	}
	if in.ExpiryDate != nil {
		r.ExpiryDate = trimPtr(in.ExpiryDate)
	}
	if in.CostPrice != nil {
		r.CostPrice = utils.Round2(*in.CostPrice)
	}
	if in.SellingPrice != nil {
		r.SellingPrice = utils.Round2(*in.SellingPrice)
	}
	if in.MRP != nil {
		r.MRP = utils.Round2(*in.MRP)
	}
	if in.Stock != nil {
		r.Stock = *in.Stock
	}
	if in.ReorderLevel != nil {
		r.ReorderLevel = *in.ReorderLevel
	}
	if in.SafetyStock != nil {
		r.SafetyStock = *in.SafetyStock
	}
	if in.SeasonFactor != nil {
		r.SeasonFactor = *in.SeasonFactor
	}
	if in.IsPerishable != nil {
		r.IsPerishable = *in.IsPerishable
	}
	if in.IsActive != nil {
		r.IsActive = *in.IsActive
	}
	if in.PackSize != nil {
		r.PackSize = trimPtr(in.PackSize)
	}
	// Optional numeric attributes: a negative value clears the attribute.
	if in.ShelfLifeDays != nil {
		r.ShelfLifeDays = in.ShelfLifeDays
		if *in.ShelfLifeDays < 0 {
			r.ShelfLifeDays = nil
		}
	}
	for _, f := range []struct {
		in  *float64
		dst **float64
	}{{in.SeasonalSensitivity, &r.SeasonalSensitivity}, {in.FestivalSensitivity, &r.FestivalSensitivity}, {in.WeatherSensitivity, &r.WeatherSensitivity}} {
		if f.in != nil {
			*f.dst = f.in
			if *f.in < 0 {
				*f.dst = nil
			}
		}
	}

	needOrg := (in.Category != nil && trimPtr(in.Category) != nil) || (in.Supplier != nil && trimPtr(in.Supplier) != nil)
	var orgID string
	if needOrg {
		var err error
		if orgID, err = repositories.StoreOrg(ctx, tx, storeID); err != nil {
			return r, err
		}
	}
	switch {
	case in.CategoryID != nil:
		r.CategoryID = trimPtr(in.CategoryID)
	case in.Category != nil:
		if name := trimPtr(in.Category); name != nil {
			id, err := repositories.EnsureCategory(ctx, tx, orgID, *name)
			if err != nil {
				return r, err
			}
			r.CategoryID = &id
		} else {
			r.CategoryID = nil
		}
	}
	switch {
	case in.SupplierID != nil:
		r.SupplierID = trimPtr(in.SupplierID)
	case in.Supplier != nil:
		if name := trimPtr(in.Supplier); name != nil {
			id, err := repositories.EnsureSupplier(ctx, tx, orgID, *name)
			if err != nil {
				return r, err
			}
			r.SupplierID = &id
		} else {
			r.SupplierID = nil
		}
	}
	return r, nil
}

func rowFromProduct(p models.Product) repositories.ProductRow {
	return repositories.ProductRow{
		SKU: p.SKU, Name: p.Name, Barcode: p.Barcode, Brand: p.Brand, CategoryID: p.CategoryID,
		Subcategory: p.Subcategory, SupplierID: p.SupplierID, ImageURL: p.ImageURL, ExpiryDate: p.ExpiryDate,
		BatchNumber: p.BatchNumber, CostPrice: p.CostPrice, SellingPrice: p.SellingPrice, MRP: p.MRP,
		SeasonFactor: p.SeasonFactor, Stock: p.Stock, ReorderLevel: p.ReorderLevel, SafetyStock: p.SafetyStock,
		IsPerishable: p.IsPerishable, IsActive: p.IsActive,
		PackSize: p.PackSize, ShelfLifeDays: p.ShelfLifeDays, SeasonalSensitivity: p.SeasonalSensitivity,
		FestivalSensitivity: p.FestivalSensitivity, WeatherSensitivity: p.WeatherSensitivity,
	}
}

func (s *Service) allowBelowCost(ctx context.Context, q database.Querier, storeID string) bool {
	var allow bool
	_ = q.QueryRow(ctx, "select allow_below_cost_clearance from store_settings where store_id=$1", storeID).Scan(&allow)
	return allow
}

func (s *Service) ListProducts(ctx context.Context, id database.Identity, storeID string, f repositories.ProductFilter) (models.Page[models.Product], error) {
	var page models.Page[models.Product]
	err := s.DB.WithUser(ctx, id, func(tx pgx.Tx) error {
		var err error
		page.Data, page.Total, err = repositories.ListProducts(ctx, tx, storeID, f)
		return err
	})
	return page, err
}

func (s *Service) GetProduct(ctx context.Context, id database.Identity, storeID, productID string) (models.Product, error) {
	var p models.Product
	err := s.DB.WithUser(ctx, id, func(tx pgx.Tx) error {
		var err error
		p, err = repositories.GetProduct(ctx, tx, storeID, productID)
		return err
	})
	if database.IsNotFound(err) {
		return p, utils.NotFound("Product")
	}
	return p, err
}

func (s *Service) CreateProduct(ctx context.Context, id database.Identity, storeID string, in models.ProductInput) (models.Product, error) {
	var out models.Product
	err := s.userTx(ctx, id, deref(in.Reason, "product created"), func(tx pgx.Tx) error {
		base := repositories.ProductRow{SeasonFactor: 1, IsActive: true}
		missing := map[string]string{}
		for field, v := range map[string]bool{"sku": in.SKU == nil, "name": in.Name == nil, "cost_price": in.CostPrice == nil,
			"selling_price": in.SellingPrice == nil, "mrp": in.MRP == nil} {
			if v {
				missing[field] = "is required"
			}
		}
		if len(missing) > 0 {
			return utils.Unprocessable("Missing required fields", missing)
		}
		row, err := s.mergeProduct(ctx, tx, storeID, base, in)
		if err != nil {
			return err
		}
		if errs := ValidateProductRow(row, true, nil, s.allowBelowCost(ctx, tx, storeID)); len(errs) > 0 {
			return utils.Unprocessable("Invalid product", errs)
		}
		if err := database.SetLocal(ctx, tx, "app.price_source", "MANUAL"); err != nil {
			return err
		}
		if err := database.SetLocal(ctx, tx, "app.stock_reason", "RESTOCK"); err != nil {
			return err
		}
		newID, err := repositories.InsertProduct(ctx, tx, storeID, row)
		if err != nil {
			return err
		}
		out, err = repositories.GetProduct(ctx, tx, storeID, newID)
		return err
	})
	if err == nil {
		s.invalidate(ctx, storeID)
	}
	return out, err
}

func (s *Service) UpdateProduct(ctx context.Context, id database.Identity, storeID, productID string, in models.ProductInput) (models.Product, error) {
	var out models.Product
	err := s.userTx(ctx, id, deref(in.Reason, ""), func(tx pgx.Tx) error {
		cur, err := repositories.GetProductForUpdate(ctx, tx, storeID, productID)
		if err != nil {
			return err
		}
		row, err := s.mergeProduct(ctx, tx, storeID, rowFromProduct(cur), in)
		if err != nil {
			return err
		}
		if errs := ValidateProductRow(row, false, cur.ExpiryDate, s.allowBelowCost(ctx, tx, storeID)); len(errs) > 0 {
			return utils.Unprocessable("Invalid product", errs)
		}
		if row.SellingPrice != cur.SellingPrice {
			if err := database.SetLocal(ctx, tx, "app.price_source", "MANUAL"); err != nil {
				return err
			}
		}
		if row.Stock != cur.Stock {
			if err := database.SetLocal(ctx, tx, "app.stock_reason", "ADJUSTMENT"); err != nil {
				return err
			}
		}
		if err := repositories.UpdateProduct(ctx, tx, storeID, productID, row); err != nil {
			return err
		}
		out, err = repositories.GetProduct(ctx, tx, storeID, productID)
		return err
	})
	if database.IsNotFound(err) {
		return out, utils.NotFound("Product")
	}
	if err == nil {
		s.invalidate(ctx, storeID)
	}
	return out, err
}

func (s *Service) DeleteProduct(ctx context.Context, id database.Identity, storeID, productID, reason string) error {
	err := s.userTx(ctx, id, reason, func(tx pgx.Tx) error {
		return repositories.DeleteProduct(ctx, tx, storeID, productID)
	})
	if database.IsNotFound(err) {
		return utils.NotFound("Product")
	}
	if err == nil {
		s.invalidate(ctx, storeID)
	}
	return err
}

// AdjustStock records a manual stock movement (restock, waste, correction…).
func (s *Service) AdjustStock(ctx context.Context, id database.Identity, storeID, productID string, change int, reason, note string) (int, error) {
	valid := map[string]bool{"RESTOCK": true, "ADJUSTMENT": true, "WASTE": true, "RETURN": true}
	if !valid[reason] {
		return 0, utils.Unprocessable("Invalid reason", map[string]string{"reason": "must be RESTOCK, ADJUSTMENT, WASTE or RETURN"})
	}
	if change == 0 {
		return 0, utils.Unprocessable("Invalid change", map[string]string{"change": "must be non-zero"})
	}
	if (reason == "RESTOCK" || reason == "RETURN") && change < 0 || reason == "WASTE" && change > 0 {
		return 0, utils.Unprocessable("Invalid change", map[string]string{"change": fmt.Sprintf("sign does not match reason %s", reason)})
	}
	var stock int
	err := s.userTx(ctx, id, note, func(tx pgx.Tx) error {
		if err := database.SetLocal(ctx, tx, "app.stock_reason", reason); err != nil {
			return err
		}
		var err error
		stock, err = repositories.AdjustStock(ctx, tx, storeID, productID, change)
		if database.PgCode(err) == database.CodeCheckViolation {
			return utils.Unprocessable("Stock cannot go below zero", nil)
		}
		return err
	})
	if database.IsNotFound(err) {
		return 0, utils.NotFound("Product")
	}
	if err == nil {
		s.invalidate(ctx, storeID)
	}
	return stock, err
}

func (s *Service) ListCategories(ctx context.Context, id database.Identity, storeID string) ([]models.Category, error) {
	var out []models.Category
	err := s.DB.WithUser(ctx, id, func(tx pgx.Tx) error {
		var err error
		out, err = repositories.ListCategories(ctx, tx, storeID)
		return err
	})
	if out == nil {
		out = []models.Category{}
	}
	return out, err
}

func (s *Service) ListSuppliers(ctx context.Context, id database.Identity, storeID string) ([]models.Supplier, error) {
	var out []models.Supplier
	err := s.DB.WithUser(ctx, id, func(tx pgx.Tx) error {
		var err error
		out, err = repositories.ListSuppliers(ctx, tx, storeID)
		return err
	})
	if out == nil {
		out = []models.Supplier{}
	}
	return out, err
}

func (s *Service) CreateSupplier(ctx context.Context, id database.Identity, storeID string, in models.Supplier) (models.Supplier, error) {
	var out models.Supplier
	err := s.userTx(ctx, id, "supplier created", func(tx pgx.Tx) error {
		org, err := repositories.StoreOrg(ctx, tx, storeID)
		if err != nil {
			return err
		}
		out, err = repositories.CreateSupplier(ctx, tx, org, in)
		return err
	})
	return out, err
}
