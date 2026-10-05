// Package repositories contains all SQL. Functions take a database.Querier so
// they run inside RLS-scoped user transactions or system transactions alike.
package repositories

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/rishabh26raj/priceiq/backend-go/database"
	"github.com/rishabh26raj/priceiq/backend-go/models"
)

const productSelect = `
select p.id, p.store_id, p.legacy_product_id, p.sku, p.barcode, p.name, p.brand,
       p.category_id, c.name, p.subcategory, p.supplier_id, sup.name, p.image_url,
       p.cost_price::float8, p.selling_price::float8, p.mrp::float8,
       p.stock, p.reorder_level, p.safety_stock,
       to_char(p.expiry_date, 'YYYY-MM-DD'), (p.expiry_date - current_date),
       p.batch_number, p.season_factor::float8, p.is_perishable, p.is_active, p.is_synthetic,
       p.created_at, p.updated_at, p.pack_size, p.shelf_life_days,
       p.seasonal_sensitivity::float8, p.festival_sensitivity::float8, p.weather_sensitivity::float8`

const productFrom = `
from products p
left join categories c on c.id = p.category_id
left join suppliers sup on sup.id = p.supplier_id`

func scanProduct(row pgx.Row, extra ...any) (models.Product, error) {
	var p models.Product
	dest := []any{&p.ID, &p.StoreID, &p.LegacyProductID, &p.SKU, &p.Barcode, &p.Name, &p.Brand,
		&p.CategoryID, &p.Category, &p.Subcategory, &p.SupplierID, &p.Supplier, &p.ImageURL,
		&p.CostPrice, &p.SellingPrice, &p.MRP, &p.Stock, &p.ReorderLevel, &p.SafetyStock,
		&p.ExpiryDate, &p.DaysToExpiry, &p.BatchNumber, &p.SeasonFactor, &p.IsPerishable, &p.IsActive,
		&p.IsSynthetic, &p.CreatedAt, &p.UpdatedAt, &p.PackSize, &p.ShelfLifeDays,
		&p.SeasonalSensitivity, &p.FestivalSensitivity, &p.WeatherSensitivity}
	err := row.Scan(append(dest, extra...)...)
	if err == nil && p.CostPrice > 0 {
		p.MarginPct = (p.SellingPrice - p.CostPrice) / p.SellingPrice * 100
	}
	return p, err
}

// ProductFilter captures list query options.
type ProductFilter struct {
	Query           string
	CategoryID      string
	Category        string
	SupplierID      string
	StockStatus     string // out | low | over | in
	ExpiringWithin  *int   // days
	Expired         bool
	IncludeInactive bool
	Sort            string
	Order           string
	Limit, Offset   int
}

var productSorts = map[string]string{
	"name":          "lower(p.name)",
	"sku":           "p.sku",
	"selling_price": "p.selling_price",
	"cost_price":    "p.cost_price",
	"stock":         "p.stock",
	"expiry_date":   "p.expiry_date",
	"margin":        "(p.selling_price - p.cost_price) / p.selling_price",
	"updated_at":    "p.updated_at",
	"created_at":    "p.created_at",
	"category":      "lower(c.name)",
}

func ListProducts(ctx context.Context, q database.Querier, storeID string, f ProductFilter) ([]models.Product, int, error) {
	where := []string{"p.store_id = $1"}
	args := []any{storeID}
	arg := func(v any) string { args = append(args, v); return fmt.Sprintf("$%d", len(args)) }
	join := ""

	if !f.IncludeInactive {
		where = append(where, "p.is_active")
	}
	if s := strings.TrimSpace(f.Query); s != "" {
		like := arg("%" + strings.ReplaceAll(strings.ReplaceAll(s, "%", `\%`), "_", `\_`) + "%")
		where = append(where, fmt.Sprintf("(p.name ilike %[1]s or p.sku ilike %[1]s or p.barcode ilike %[1]s or p.brand ilike %[1]s)", like))
	}
	if f.CategoryID != "" {
		where = append(where, "p.category_id = "+arg(f.CategoryID))
	}
	if f.Category != "" {
		where = append(where, "lower(c.name) = lower("+arg(f.Category)+")")
	}
	if f.SupplierID != "" {
		where = append(where, "p.supplier_id = "+arg(f.SupplierID))
	}
	if f.ExpiringWithin != nil {
		where = append(where, "p.expiry_date is not null and p.expiry_date <= current_date + "+arg(*f.ExpiringWithin)+"::int")
	}
	if f.Expired {
		where = append(where, "p.expiry_date < current_date")
	}
	switch f.StockStatus {
	case "out":
		where = append(where, "p.stock = 0")
	case "in":
		where = append(where, "p.stock > 0")
	case "low", "over":
		join = ` join product_inventory_metrics m on m.product_id = p.id
		         join store_settings ss on ss.store_id = p.store_id`
		if f.StockStatus == "low" {
			where = append(where, `p.stock > 0 and (
				(p.reorder_level > 0 and p.stock <= p.reorder_level)
				or (m.avg_daily_units > 0 and p.stock / m.avg_daily_units < ss.low_stock_cover_days))`)
		} else {
			where = append(where, `m.avg_daily_units > 0 and p.stock / m.avg_daily_units > ss.overstock_cover_days`)
		}
	}

	order := productSorts[f.Sort]
	if order == "" {
		order = "lower(p.name)"
	}
	dir := "asc"
	if strings.EqualFold(f.Order, "desc") {
		dir = "desc"
	}
	sql := productSelect + ", count(*) over () " + productFrom + join +
		" where " + strings.Join(where, " and ") +
		fmt.Sprintf(" order by %s %s nulls last, p.id limit %s offset %s", order, dir, arg(f.Limit), arg(f.Offset))

	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []models.Product{}
	total := 0
	for rows.Next() {
		p, err := scanProduct(rows, &total)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, p)
	}
	return out, total, rows.Err()
}

func GetProduct(ctx context.Context, q database.Querier, storeID, id string) (models.Product, error) {
	return scanProduct(q.QueryRow(ctx, productSelect+productFrom+" where p.store_id = $1 and p.id = $2", storeID, id))
}

// GetProductForUpdate locks the row for the remainder of the transaction.
func GetProductForUpdate(ctx context.Context, q database.Querier, storeID, id string) (models.Product, error) {
	return scanProduct(q.QueryRow(ctx, productSelect+productFrom+" where p.store_id = $1 and p.id = $2 for update of p", storeID, id))
}

// ProductRow is a fully resolved row for insert/update.
type ProductRow struct {
	SKU, Name                                           string
	Barcode, Brand, CategoryID, Subcategory, SupplierID *string
	ImageURL, ExpiryDate, BatchNumber                   *string
	CostPrice, SellingPrice, MRP, SeasonFactor          float64
	Stock, ReorderLevel, SafetyStock                    int
	IsPerishable, IsActive                              bool
	PackSize                                            *string
	ShelfLifeDays                                       *int
	SeasonalSensitivity, FestivalSensitivity            *float64
	WeatherSensitivity                                  *float64
}

func InsertProduct(ctx context.Context, q database.Querier, storeID string, r ProductRow) (string, error) {
	var id string
	err := q.QueryRow(ctx, `insert into products(store_id, sku, barcode, name, brand, category_id, subcategory,
			supplier_id, image_url, cost_price, selling_price, mrp, stock, reorder_level, safety_stock,
			expiry_date, batch_number, season_factor, is_perishable, is_active,
			pack_size, shelf_life_days, seasonal_sensitivity, festival_sensitivity, weather_sensitivity)
		values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::date,$17,$18,$19,$20,$21,$22,$23,$24,$25) returning id`,
		storeID, r.SKU, r.Barcode, r.Name, r.Brand, r.CategoryID, r.Subcategory, r.SupplierID, r.ImageURL,
		r.CostPrice, r.SellingPrice, r.MRP, r.Stock, r.ReorderLevel, r.SafetyStock, r.ExpiryDate,
		r.BatchNumber, r.SeasonFactor, r.IsPerishable, r.IsActive,
		r.PackSize, r.ShelfLifeDays, r.SeasonalSensitivity, r.FestivalSensitivity, r.WeatherSensitivity).Scan(&id)
	return id, err
}

func UpdateProduct(ctx context.Context, q database.Querier, storeID, id string, r ProductRow) error {
	tag, err := q.Exec(ctx, `update products set sku=$3, barcode=$4, name=$5, brand=$6, category_id=$7,
			subcategory=$8, supplier_id=$9, image_url=$10, cost_price=$11, selling_price=$12, mrp=$13,
			stock=$14, reorder_level=$15, safety_stock=$16, expiry_date=$17::date, batch_number=$18,
			season_factor=$19, is_perishable=$20, is_active=$21, pack_size=$22, shelf_life_days=$23,
			seasonal_sensitivity=$24, festival_sensitivity=$25, weather_sensitivity=$26
		where store_id=$1 and id=$2`,
		storeID, id, r.SKU, r.Barcode, r.Name, r.Brand, r.CategoryID, r.Subcategory, r.SupplierID,
		r.ImageURL, r.CostPrice, r.SellingPrice, r.MRP, r.Stock, r.ReorderLevel, r.SafetyStock,
		r.ExpiryDate, r.BatchNumber, r.SeasonFactor, r.IsPerishable, r.IsActive,
		r.PackSize, r.ShelfLifeDays, r.SeasonalSensitivity, r.FestivalSensitivity, r.WeatherSensitivity)
	if err == nil && tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return err
}

func DeleteProduct(ctx context.Context, q database.Querier, storeID, id string) error {
	tag, err := q.Exec(ctx, "delete from products where store_id=$1 and id=$2", storeID, id)
	if err == nil && tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return err
}

// SetPrice updates only the selling price (the price-history trigger records it).
func SetPrice(ctx context.Context, q database.Querier, storeID, id string, price float64) error {
	tag, err := q.Exec(ctx, "update products set selling_price=$3 where store_id=$1 and id=$2", storeID, id, price)
	if err == nil && tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return err
}

// AdjustStock applies a delta atomically; fails (check violation) below zero.
func AdjustStock(ctx context.Context, q database.Querier, storeID, id string, delta int) (int, error) {
	var stock int
	err := q.QueryRow(ctx, "update products set stock = stock + $3 where store_id=$1 and id=$2 returning stock",
		storeID, id, delta).Scan(&stock)
	return stock, err
}

// ── Categories & suppliers ──────────────────────────────────────────────────

func StoreOrg(ctx context.Context, q database.Querier, storeID string) (string, error) {
	var org string
	err := q.QueryRow(ctx, "select organization_id from stores where id=$1", storeID).Scan(&org)
	return org, err
}

func ListCategories(ctx context.Context, q database.Querier, storeID string) ([]models.Category, error) {
	rows, err := q.Query(ctx, `select c.id, c.name, c.parent_id,
			(select count(*) from products p where p.category_id = c.id and p.store_id = $1)::int
		from categories c where c.organization_id = (select organization_id from stores where id = $1)
		order by lower(c.name)`, storeID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (models.Category, error) {
		var c models.Category
		return c, r.Scan(&c.ID, &c.Name, &c.ParentID, &c.Products)
	})
}

// EnsureCategory returns the id of the named category, creating it if needed.
func EnsureCategory(ctx context.Context, q database.Querier, orgID, name string) (string, error) {
	name = strings.TrimSpace(name)
	var id string
	err := q.QueryRow(ctx, "select id from categories where organization_id=$1 and lower(name)=lower($2) and parent_id is null",
		orgID, name).Scan(&id)
	if err == pgx.ErrNoRows {
		err = q.QueryRow(ctx, "insert into categories(organization_id, name) values ($1,$2) returning id", orgID, name).Scan(&id)
	}
	return id, err
}

func ListSuppliers(ctx context.Context, q database.Querier, storeID string) ([]models.Supplier, error) {
	rows, err := q.Query(ctx, `select id, name, contact_email, phone, lead_time_days from suppliers
		where organization_id = (select organization_id from stores where id = $1) order by lower(name)`, storeID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (models.Supplier, error) {
		var s models.Supplier
		return s, r.Scan(&s.ID, &s.Name, &s.ContactEmail, &s.Phone, &s.LeadTimeDays)
	})
}

func EnsureSupplier(ctx context.Context, q database.Querier, orgID, name string) (string, error) {
	name = strings.TrimSpace(name)
	var id string
	err := q.QueryRow(ctx, "select id from suppliers where organization_id=$1 and lower(name)=lower($2)", orgID, name).Scan(&id)
	if err == pgx.ErrNoRows {
		err = q.QueryRow(ctx, "insert into suppliers(organization_id, name) values ($1,$2) returning id", orgID, name).Scan(&id)
	}
	return id, err
}

func CreateSupplier(ctx context.Context, q database.Querier, orgID string, s models.Supplier) (models.Supplier, error) {
	err := q.QueryRow(ctx, `insert into suppliers(organization_id, name, contact_email, phone, lead_time_days)
		values ($1,$2,$3,$4,$5) returning id`, orgID, s.Name, s.ContactEmail, s.Phone, s.LeadTimeDays).Scan(&s.ID)
	return s, err
}

// SKUs / barcodes already present in a store (for import duplicate checks).
func ExistingIdentifiers(ctx context.Context, q database.Querier, storeID string) (map[string]string, map[string]string, error) {
	rows, err := q.Query(ctx, "select id, sku, barcode from products where store_id=$1", storeID)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	skus, barcodes := map[string]string{}, map[string]string{}
	for rows.Next() {
		var id, sku string
		var bc *string
		if err := rows.Scan(&id, &sku, &bc); err != nil {
			return nil, nil, err
		}
		skus[strings.ToLower(sku)] = id
		if bc != nil {
			barcodes[*bc] = id
		}
	}
	return skus, barcodes, rows.Err()
}
