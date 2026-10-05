package services

import (
	"bytes"
	"context"
	"encoding/csv"
	"fmt"
	"io"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/xuri/excelize/v2"

	"github.com/rishabh26raj/priceiq/backend-go/database"
	"github.com/rishabh26raj/priceiq/backend-go/models"
	"github.com/rishabh26raj/priceiq/backend-go/repositories"
	"github.com/rishabh26raj/priceiq/backend-go/utils"
)

const (
	MaxImportRows  = 5000
	MaxImportBytes = 10 << 20 // upload size limit
	// An .xlsx is a zip archive: bound what it may expand to (zip-bomb guard).
	maxXLSXUnzipBytes = 64 << 20
)

// SafeCSV guards exported reports against CSV/formula injection: a text cell
// that a spreadsheet would evaluate (leading = + - @, tab or CR) is prefixed
// with an apostrophe. Plain numbers such as "-12.50" are left untouched.
func SafeCSV(rows [][]string) [][]string {
	for _, row := range rows {
		for i, cell := range row {
			if cell == "" || !strings.ContainsRune("=+-@\t\r", rune(cell[0])) {
				continue
			}
			if _, err := strconv.ParseFloat(cell, 64); err == nil {
				continue
			}
			row[i] = "'" + cell
		}
	}
	return rows
}

// ImportColumns lists accepted headers (first entry is canonical).
var ImportColumns = [][]string{
	{"sku", "item_code", "product_code"},
	{"name", "product_name", "item_name"},
	{"barcode", "ean", "upc", "gtin"},
	{"brand"},
	{"category"},
	{"subcategory", "sub_category"},
	{"supplier", "vendor"},
	{"image_url", "image"},
	{"cost_price", "cost", "purchase_price"},
	{"selling_price", "price", "sale_price"},
	{"mrp"},
	{"stock", "quantity", "qty", "stock_level"},
	{"reorder_level", "reorder_point"},
	{"safety_stock"},
	{"expiry_date", "expiry", "best_before"},
	{"batch_number", "batch", "lot"},
	{"is_perishable", "perishable"},
	{"pack_size", "pack", "unit"},
	{"shelf_life_days", "shelf_life"},
	{"seasonal_sensitivity"},
	{"festival_sensitivity"},
	{"weather_sensitivity"},
}

type ImportRowError struct {
	Row    int               `json:"row"` // 1-based data row (header excluded)
	SKU    string            `json:"sku"`
	Errors map[string]string `json:"errors"`
}

type ImportResult struct {
	DryRun    bool             `json:"dry_run"`
	TotalRows int              `json:"total_rows"`
	Created   int              `json:"created"`
	Updated   int              `json:"updated"`
	Skipped   int              `json:"skipped"`
	Errors    []ImportRowError `json:"errors"`
	Committed bool             `json:"committed"`
}

type ImportOptions struct {
	DryRun         bool
	UpdateExisting bool // upsert by SKU; otherwise existing SKUs are errors
	SkipInvalid    bool // commit valid rows even if some rows fail
}

// ParseImportFile reads CSV or XLSX (first sheet) into header-keyed records.
func ParseImportFile(filename string, r io.Reader) ([]map[string]string, error) {
	var table [][]string
	lower := strings.ToLower(filename)
	switch {
	case strings.HasSuffix(lower, ".xlsx"):
		f, err := excelize.OpenReader(r, excelize.Options{UnzipSizeLimit: maxXLSXUnzipBytes, UnzipXMLSizeLimit: 16 << 20})
		if err != nil {
			return nil, utils.BadRequest("Could not read Excel file: " + err.Error())
		}
		defer f.Close()
		sheets := f.GetSheetList()
		if len(sheets) == 0 {
			return nil, utils.BadRequest("Excel file has no sheets")
		}
		if table, err = f.GetRows(sheets[0]); err != nil {
			return nil, utils.BadRequest("Could not read Excel sheet: " + err.Error())
		}
	case strings.HasSuffix(lower, ".csv"):
		raw, err := io.ReadAll(io.LimitReader(r, MaxImportBytes))
		if err != nil {
			return nil, err
		}
		raw = bytes.TrimPrefix(raw, []byte("\xef\xbb\xbf")) // UTF-8 BOM from Excel exports
		cr := csv.NewReader(bytes.NewReader(raw))
		cr.FieldsPerRecord = -1
		cr.TrimLeadingSpace = true
		if table, err = cr.ReadAll(); err != nil {
			return nil, utils.BadRequest("Invalid CSV: " + err.Error())
		}
	default:
		return nil, utils.BadRequest("Unsupported file type — upload .csv or .xlsx")
	}
	if len(table) < 2 {
		return nil, utils.BadRequest("File must contain a header row and at least one data row")
	}
	if len(table)-1 > MaxImportRows {
		return nil, utils.BadRequest(fmt.Sprintf("At most %d rows per import", MaxImportRows))
	}

	alias := map[string]string{}
	for _, names := range ImportColumns {
		for _, n := range names {
			alias[n] = names[0]
		}
	}
	headers := make([]string, len(table[0]))
	seen := map[string]bool{}
	for i, h := range table[0] {
		key := strings.ToLower(strings.TrimSpace(strings.ReplaceAll(h, " ", "_")))
		if canon, ok := alias[key]; ok && !seen[canon] {
			headers[i] = canon
			seen[canon] = true
		}
	}
	for _, req := range []string{"sku", "name", "cost_price", "selling_price", "mrp"} {
		if !seen[req] {
			return nil, utils.BadRequest("Missing required column: " + req)
		}
	}

	var out []map[string]string
	for _, rec := range table[1:] {
		m := map[string]string{}
		empty := true
		for i, v := range rec {
			if i < len(headers) && headers[i] != "" {
				v = strings.TrimSpace(v)
				m[headers[i]] = v
				if v != "" {
					empty = false
				}
			}
		}
		if !empty {
			out = append(out, m)
		}
	}
	return out, nil
}

func parseImportDate(s string) (string, bool) {
	for _, layout := range []string{"2006-01-02", "02/01/2006", "02-01-2006", "2006/01/02", "01-02-06", "2-Jan-2006", "02 Jan 2006"} {
		if t, err := time.Parse(layout, s); err == nil {
			return t.Format("2006-01-02"), true
		}
	}
	// Excel serial date (days since 1899-12-30)
	if n, err := strconv.ParseFloat(s, 64); err == nil && n > 20000 && n < 80000 {
		return time.Date(1899, 12, 30, 0, 0, 0, 0, time.UTC).AddDate(0, 0, int(n)).Format("2006-01-02"), true
	}
	return "", false
}

// recordToInput converts a parsed record into a ProductInput, collecting
// type errors.
func recordToInput(rec map[string]string) (models.ProductInput, map[string]string) {
	errs := map[string]string{}
	in := models.ProductInput{}
	str := func(k string) *string {
		if v, ok := rec[k]; ok && v != "" {
			return &v
		}
		return nil
	}
	num := func(k string, required bool) *float64 {
		v, ok := rec[k]
		if !ok || v == "" {
			if required {
				errs[k] = "is required"
			}
			return nil
		}
		f, err := strconv.ParseFloat(strings.NewReplacer(",", "", "₹", "", "Rs.", "", "Rs", "").Replace(v), 64)
		if err != nil {
			errs[k] = "must be a number"
			return nil
		}
		return &f
	}
	integer := func(k string) *int {
		f := num(k, false)
		if f == nil {
			return nil
		}
		if *f != float64(int(*f)) {
			errs[k] = "must be a whole number"
			return nil
		}
		i := int(*f)
		return &i
	}
	in.SKU, in.Name, in.Barcode, in.Brand = str("sku"), str("name"), str("barcode"), str("brand")
	in.Category, in.Subcategory, in.Supplier, in.ImageURL = str("category"), str("subcategory"), str("supplier"), str("image_url")
	in.BatchNumber, in.PackSize = str("batch_number"), str("pack_size")
	in.ShelfLifeDays = integer("shelf_life_days")
	in.SeasonalSensitivity, in.FestivalSensitivity, in.WeatherSensitivity =
		num("seasonal_sensitivity", false), num("festival_sensitivity", false), num("weather_sensitivity", false)
	// In a PATCH a negative value means "clear"; an import must not clear by accident.
	if in.ShelfLifeDays != nil && *in.ShelfLifeDays < 0 {
		errs["shelf_life_days"] = "cannot be negative"
	}
	for k, v := range map[string]*float64{"seasonal_sensitivity": in.SeasonalSensitivity,
		"festival_sensitivity": in.FestivalSensitivity, "weather_sensitivity": in.WeatherSensitivity} {
		if v != nil && *v < 0 {
			errs[k] = "must be between 0 and 1"
		}
	}
	in.CostPrice, in.SellingPrice, in.MRP = num("cost_price", true), num("selling_price", true), num("mrp", true)
	in.Stock, in.ReorderLevel, in.SafetyStock = integer("stock"), integer("reorder_level"), integer("safety_stock")
	if in.SKU == nil {
		errs["sku"] = "is required"
	}
	if in.Name == nil {
		errs["name"] = "is required"
	}
	if v := str("expiry_date"); v != nil {
		if d, ok := parseImportDate(*v); ok {
			in.ExpiryDate = &d
		} else {
			errs["expiry_date"] = "unrecognised date (use YYYY-MM-DD)"
		}
	}
	if v := str("is_perishable"); v != nil {
		b := map[string]bool{"true": true, "yes": true, "y": true, "1": true}[strings.ToLower(*v)]
		in.IsPerishable = &b
	}
	return in, errs
}

// ImportProducts validates and (unless dry-run) writes the rows in a single
// transaction. By default any invalid row aborts the whole import.
func (s *Service) ImportProducts(ctx context.Context, id database.Identity, storeID string, records []map[string]string, opt ImportOptions) (ImportResult, error) {
	res := ImportResult{DryRun: opt.DryRun, TotalRows: len(records), Errors: []ImportRowError{}}
	errAbort := fmt.Errorf("abort")

	err := s.userTx(ctx, id, "bulk import", func(tx pgx.Tx) error {
		skus, barcodes, err := repositories.ExistingIdentifiers(ctx, tx, storeID)
		if err != nil {
			return err
		}
		allowBelow := s.allowBelowCost(ctx, tx, storeID)
		if err := database.SetLocal(ctx, tx, "app.price_source", "IMPORT"); err != nil {
			return err
		}
		if err := database.SetLocal(ctx, tx, "app.stock_reason", "IMPORT"); err != nil {
			return err
		}
		fileSKUs, fileBarcodes := map[string]int{}, map[string]int{}

		for i, rec := range records {
			rowNo := i + 1
			in, errs := recordToInput(rec)
			sku := deref(in.SKU, "")
			skuKey := strings.ToLower(strings.TrimSpace(sku))
			if prev, dup := fileSKUs[skuKey]; dup && skuKey != "" {
				errs["sku"] = fmt.Sprintf("duplicate of row %d in this file", prev)
			}
			fileSKUs[skuKey] = rowNo
			if in.Barcode != nil {
				if prev, dup := fileBarcodes[*in.Barcode]; dup {
					errs["barcode"] = fmt.Sprintf("duplicate of row %d in this file", prev)
				}
				fileBarcodes[*in.Barcode] = rowNo
			}
			existingID, exists := skus[skuKey]
			if exists && !opt.UpdateExisting {
				errs["sku"] = "already exists in this store"
			}
			if in.Barcode != nil {
				if owner, taken := barcodes[*in.Barcode]; taken && owner != existingID {
					errs["barcode"] = "already used by another product in this store"
				}
			}
			if len(errs) == 0 {
				base := repositories.ProductRow{SeasonFactor: 1, IsActive: true}
				var oldExpiry *string
				if exists {
					cur, err := repositories.GetProductForUpdate(ctx, tx, storeID, existingID)
					if err != nil {
						return err
					}
					base, oldExpiry = rowFromProduct(cur), cur.ExpiryDate
				}
				row, err := s.mergeProduct(ctx, tx, storeID, base, in)
				if err != nil {
					return err
				}
				if verr := ValidateProductRow(row, !exists, oldExpiry, allowBelow); len(verr) > 0 {
					errs = verr
				} else if exists {
					if err := repositories.UpdateProduct(ctx, tx, storeID, existingID, row); err != nil {
						return err
					}
					res.Updated++
				} else {
					if _, err := repositories.InsertProduct(ctx, tx, storeID, row); err != nil {
						return err
					}
					res.Created++
				}
			}
			if len(errs) > 0 {
				res.Errors = append(res.Errors, ImportRowError{Row: rowNo, SKU: sku, Errors: errs})
				res.Skipped++
			}
		}
		if opt.DryRun || (len(res.Errors) > 0 && !opt.SkipInvalid) {
			return errAbort // roll back
		}
		return nil
	})
	if err == errAbort {
		return res, nil
	}
	if err != nil {
		return res, err
	}
	res.Committed = true
	s.invalidate(ctx, storeID)
	return res, nil
}

// ImportTemplateCSV is offered as a download on the Products page.
func ImportTemplateCSV() []byte {
	var b bytes.Buffer
	w := csv.NewWriter(&b)
	_ = w.Write([]string{"sku", "name", "barcode", "brand", "category", "subcategory", "supplier", "image_url",
		"cost_price", "selling_price", "mrp", "stock", "reorder_level", "safety_stock", "expiry_date", "batch_number", "is_perishable",
		"pack_size", "shelf_life_days", "seasonal_sensitivity", "festival_sensitivity", "weather_sensitivity"})
	_ = w.Write([]string{"SKU-0001", "Example Toned Milk 500ml", "", "ExampleBrand", "Dairy", "Milk", "Example Dairy Co", "",
		"24.50", "27.00", "29.00", "40", "10", "5", time.Now().AddDate(0, 0, 2).Format("2006-01-02"), "B2401", "yes",
		"500 ml", "2", "0.1", "0.5", "0.2"})
	w.Flush()
	return b.Bytes()
}
