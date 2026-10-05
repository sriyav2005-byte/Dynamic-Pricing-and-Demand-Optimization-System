package services

import (
	"context"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/rishabh26raj/priceiq/backend-go/database"
	"github.com/rishabh26raj/priceiq/backend-go/utils"
)

// Seasonal considerations
//
// A consideration is a planning assumption entered by store staff ("during
// Diwali week, demand for Sweets is expected to rise 40% and supply is
// limited"). Workflow:
//
//  1. A STORE_MANAGER+ creates/edits it here (RLS re-checks the role; the
//     audit trigger records who changed what).
//  2. The store's cache version is bumped so cached AI responses (forecast,
//     expiry optimization, …) are recomputed.
//  3. The Python AI service reads the active considerations that overlap the
//     planning horizon and applies them as a labelled demand adjustment when
//     it evaluates candidate prices (backend/app/services/considerations.py).
//  4. The resulting price still goes through PriceBounds/Enforce in this API —
//     a consideration can move a recommendation inside the band, never past it.

type Consideration struct {
	ID                 string    `json:"id"`
	StoreID            string    `json:"store_id"`
	Name               string    `json:"name"`
	Kind               string    `json:"kind"` // SEASON | FESTIVAL | EVENT | WEATHER
	ProductID          *string   `json:"product_id"`
	ProductName        *string   `json:"product_name"`
	CategoryID         *string   `json:"category_id"`
	CategoryName       *string   `json:"category_name"`
	Scope              string    `json:"scope"` // PRODUCT | CATEGORY | STORE
	StartDate          string    `json:"start_date"`
	EndDate            string    `json:"end_date"`
	DemandChangePct    float64   `json:"expected_demand_change_pct"`
	SupplyCondition    string    `json:"supply_condition"` // NORMAL | SURPLUS | LIMITED | SHORTAGE
	WeatherSensitivity *string   `json:"weather_sensitivity"`
	FestivalSens       *string   `json:"festival_sensitivity"`
	Notes              *string   `json:"notes"`
	IsActive           bool      `json:"is_active"`
	Phase              string    `json:"phase"` // UPCOMING | ACTIVE | ENDED (relative to today)
	DaysUntil          int       `json:"days_until"`
	CreatedByEmail     *string   `json:"created_by_email"`
	CreatedAt          time.Time `json:"created_at"`
	UpdatedAt          time.Time `json:"updated_at"`
}

// ConsiderationInput is used for create (all required fields present) and
// update (full replacement of the editable fields).
type ConsiderationInput struct {
	Name               string  `json:"name" binding:"required,max=120"`
	Kind               string  `json:"kind" binding:"required,oneof=SEASON FESTIVAL EVENT WEATHER"`
	ProductID          *string `json:"product_id" binding:"omitempty,uuid"`
	CategoryID         *string `json:"category_id" binding:"omitempty,uuid"`
	StartDate          string  `json:"start_date" binding:"required"`
	EndDate            string  `json:"end_date" binding:"required"`
	DemandChangePct    float64 `json:"expected_demand_change_pct" binding:"gte=-90,lte=300"`
	SupplyCondition    string  `json:"supply_condition" binding:"omitempty,oneof=NORMAL SURPLUS LIMITED SHORTAGE"`
	WeatherSensitivity *string `json:"weather_sensitivity" binding:"omitempty,oneof=LOW MEDIUM HIGH"`
	FestivalSens       *string `json:"festival_sensitivity" binding:"omitempty,oneof=LOW MEDIUM HIGH"`
	Notes              string  `json:"notes" binding:"max=1000"`
	IsActive           *bool   `json:"is_active"`
}

func (in *ConsiderationInput) validate() error {
	errs := map[string]string{}
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" {
		errs["name"] = "is required"
	}
	a, err1 := time.Parse("2006-01-02", in.StartDate)
	b, err2 := time.Parse("2006-01-02", in.EndDate)
	switch {
	case err1 != nil:
		errs["start_date"] = "must be a date in YYYY-MM-DD format"
	case err2 != nil:
		errs["end_date"] = "must be a date in YYYY-MM-DD format"
	case b.Before(a):
		errs["end_date"] = "must be on or after the start date"
	case b.Sub(a) > 366*24*time.Hour:
		errs["end_date"] = "a consideration can span at most one year"
	}
	if in.ProductID != nil && in.CategoryID != nil {
		errs["category_id"] = "choose a product or a category, not both"
	}
	if in.SupplyCondition == "" {
		in.SupplyCondition = "NORMAL"
	}
	if in.DemandChangePct == 0 && in.SupplyCondition == "NORMAL" {
		errs["expected_demand_change_pct"] = "enter an expected demand change or a non-normal supply condition — otherwise the consideration has no effect"
	}
	if len(errs) > 0 {
		return utils.Unprocessable("Invalid seasonal consideration", errs)
	}
	return nil
}

const considerationSelect = `
select sc.id, sc.store_id, sc.name, sc.kind, sc.product_id, p.name, sc.category_id, c.name,
       to_char(sc.start_date,'YYYY-MM-DD'), to_char(sc.end_date,'YYYY-MM-DD'),
       sc.expected_demand_change_pct::float8, sc.supply_condition, sc.weather_sensitivity, sc.festival_sensitivity,
       sc.notes, sc.is_active, (sc.start_date - current_date), (sc.end_date - current_date),
       pr.email, sc.created_at, sc.updated_at
from seasonal_considerations sc
left join products p on p.id = sc.product_id
left join categories c on c.id = sc.category_id
left join profiles pr on pr.id = sc.created_by`

func scanConsideration(row pgx.Row) (Consideration, error) {
	var c Consideration
	var untilStart, untilEnd int
	err := row.Scan(&c.ID, &c.StoreID, &c.Name, &c.Kind, &c.ProductID, &c.ProductName, &c.CategoryID, &c.CategoryName,
		&c.StartDate, &c.EndDate, &c.DemandChangePct, &c.SupplyCondition, &c.WeatherSensitivity, &c.FestivalSens,
		&c.Notes, &c.IsActive, &untilStart, &untilEnd, &c.CreatedByEmail, &c.CreatedAt, &c.UpdatedAt)
	if err != nil {
		return c, err
	}
	c.DaysUntil = untilStart
	switch {
	case c.ProductID != nil:
		c.Scope = "PRODUCT"
	case c.CategoryID != nil:
		c.Scope = "CATEGORY"
	default:
		c.Scope = "STORE"
	}
	switch {
	case untilEnd < 0:
		c.Phase = "ENDED"
	case untilStart > 0:
		c.Phase = "UPCOMING"
	default:
		c.Phase = "ACTIVE"
	}
	return c, nil
}

// ListConsiderations returns a store's considerations; ended ones are
// included only when includeEnded is set (kept for 90 days in the default view).
func (s *Service) ListConsiderations(ctx context.Context, id database.Identity, storeID string, includeEnded bool) ([]Consideration, error) {
	out := []Consideration{}
	err := s.DB.WithUser(ctx, id, func(tx pgx.Tx) error {
		q := considerationSelect + " where sc.store_id = $1"
		if !includeEnded {
			q += " and sc.end_date >= current_date - 90"
		}
		rows, err := tx.Query(ctx, q+" order by sc.start_date, sc.name", storeID)
		if err != nil {
			return err
		}
		out, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (Consideration, error) { return scanConsideration(r) })
		return err
	})
	return out, err
}

func (s *Service) getConsideration(ctx context.Context, tx pgx.Tx, storeID, cid string) (Consideration, error) {
	c, err := scanConsideration(tx.QueryRow(ctx, considerationSelect+" where sc.store_id = $1 and sc.id = $2", storeID, cid))
	if database.IsNotFound(err) {
		return c, utils.NotFound("Seasonal consideration")
	}
	return c, err
}

// considerationWriteErr maps integrity-trigger failures to field errors.
func considerationWriteErr(err error) error {
	switch database.PgCode(err) {
	case database.CodeCheckViolation, database.CodeForeignKeyViolation:
		return utils.Unprocessable("Invalid seasonal consideration",
			map[string]string{"scope": "the product or category does not belong to this store"})
	}
	return err
}

func (s *Service) CreateConsideration(ctx context.Context, id database.Identity, storeID string, in ConsiderationInput) (Consideration, error) {
	if err := in.validate(); err != nil {
		return Consideration{}, err
	}
	var out Consideration
	err := s.userTx(ctx, id, "seasonal consideration created", func(tx pgx.Tx) error {
		var cid string
		err := tx.QueryRow(ctx, `insert into seasonal_considerations(store_id, name, kind, product_id, category_id, start_date, end_date,
				expected_demand_change_pct, supply_condition, weather_sensitivity, festival_sensitivity, notes, is_active, created_by)
			values ($1,$2,$3,$4,$5,$6::date,$7::date,$8,$9,$10,$11,nullif($12,''),$13,$14) returning id`,
			storeID, in.Name, in.Kind, in.ProductID, in.CategoryID, in.StartDate, in.EndDate, in.DemandChangePct,
			in.SupplyCondition, in.WeatherSensitivity, in.FestivalSens, strings.TrimSpace(in.Notes), deref(in.IsActive, true), id.UserID).Scan(&cid)
		if err != nil {
			return considerationWriteErr(err)
		}
		out, err = s.getConsideration(ctx, tx, storeID, cid)
		return err
	})
	if err == nil {
		s.invalidate(ctx, storeID) // cached AI results depend on considerations
	}
	return out, err
}

func (s *Service) UpdateConsideration(ctx context.Context, id database.Identity, storeID, cid string, in ConsiderationInput) (Consideration, error) {
	if err := in.validate(); err != nil {
		return Consideration{}, err
	}
	var out Consideration
	err := s.userTx(ctx, id, "seasonal consideration updated", func(tx pgx.Tx) error {
		cur, err := s.getConsideration(ctx, tx, storeID, cid)
		if err != nil {
			return err
		}
		tag, err := tx.Exec(ctx, `update seasonal_considerations set name=$3, kind=$4, product_id=$5, category_id=$6,
				start_date=$7::date, end_date=$8::date, expected_demand_change_pct=$9, supply_condition=$10,
				weather_sensitivity=$11, festival_sensitivity=$12, notes=nullif($13,''), is_active=$14
			where store_id=$1 and id=$2`,
			storeID, cid, in.Name, in.Kind, in.ProductID, in.CategoryID, in.StartDate, in.EndDate, in.DemandChangePct,
			in.SupplyCondition, in.WeatherSensitivity, in.FestivalSens, strings.TrimSpace(in.Notes), deref(in.IsActive, cur.IsActive))
		if err != nil {
			return considerationWriteErr(err)
		}
		if tag.RowsAffected() == 0 { // RLS filtered the row out
			return utils.NotFound("Seasonal consideration")
		}
		out, err = s.getConsideration(ctx, tx, storeID, cid)
		return err
	})
	if err == nil {
		s.invalidate(ctx, storeID)
	}
	return out, err
}

func (s *Service) DeleteConsideration(ctx context.Context, id database.Identity, storeID, cid string) error {
	err := s.userTx(ctx, id, "seasonal consideration deleted", func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, "delete from seasonal_considerations where store_id=$1 and id=$2", storeID, cid)
		if err == nil && tag.RowsAffected() == 0 {
			return utils.NotFound("Seasonal consideration")
		}
		return err
	})
	if err == nil {
		s.invalidate(ctx, storeID)
	}
	return err
}
