package repositories

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/rishabh26raj/priceiq/backend-go/database"
	"github.com/rishabh26raj/priceiq/backend-go/models"
)

func GetProfile(ctx context.Context, q database.Querier, userID string) (models.Profile, error) {
	var p models.Profile
	err := q.QueryRow(ctx, "select id, email, full_name, phone, is_super_admin, created_at from profiles where id=$1", userID).
		Scan(&p.ID, &p.Email, &p.FullName, &p.Phone, &p.IsSuperAdmin, &p.CreatedAt)
	return p, err
}

func UpdateProfile(ctx context.Context, q database.Querier, userID string, fullName, phone *string) error {
	_, err := q.Exec(ctx, "update profiles set full_name = coalesce($2, full_name), phone = coalesce($3, phone) where id=$1",
		userID, fullName, phone)
	return err
}

// AccessibleStores lists every store the user can access with the effective role.
func AccessibleStores(ctx context.Context, q database.Querier, userID string) ([]models.StoreAccess, error) {
	rows, err := q.Query(ctx, `
		select s.id, s.name, s.code, s.city, s.data_mode, o.id, o.name,
		       case when p.is_super_admin then 'SUPER_ADMIN' else max(m.role)::text end
		from stores s
		join organizations o on o.id = s.organization_id
		join profiles p on p.id = $1
		left join memberships m on m.organization_id = s.organization_id and m.user_id = $1
		                        and (m.store_id is null or m.store_id = s.id)
		where s.is_active and (p.is_super_admin or m.id is not null)
		group by s.id, o.id, p.is_super_admin
		order by o.name, s.name`, userID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (models.StoreAccess, error) {
		var a models.StoreAccess
		var role string
		err := r.Scan(&a.StoreID, &a.StoreName, &a.StoreCode, &a.City, &a.DataMode, &a.OrganizationID, &a.OrganizationName, &role)
		a.Role = models.Role(role)
		return a, err
	})
}

const storeCols = `id, organization_id, name, code, city, state, pincode, latitude, longitude, timezone, data_mode, is_active, created_at`

func scanStore(r pgx.Row) (models.Store, error) {
	var s models.Store
	err := r.Scan(&s.ID, &s.OrganizationID, &s.Name, &s.Code, &s.City, &s.State, &s.Pincode, &s.Latitude, &s.Longitude,
		&s.Timezone, &s.DataMode, &s.IsActive, &s.CreatedAt)
	return s, err
}

func GetStore(ctx context.Context, q database.Querier, storeID string) (models.Store, error) {
	return scanStore(q.QueryRow(ctx, "select "+storeCols+" from stores where id=$1", storeID))
}

func ListOrgStores(ctx context.Context, q database.Querier, orgID string) ([]models.Store, error) {
	rows, err := q.Query(ctx, "select "+storeCols+" from stores where organization_id=$1 order by name", orgID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (models.Store, error) { return scanStore(r) })
}

func CreateStore(ctx context.Context, q database.Querier, s models.Store) (models.Store, error) {
	return scanStore(q.QueryRow(ctx, `insert into stores(organization_id, name, code, city, state, pincode, latitude, longitude)
		values ($1,$2,$3,$4,$5,$6,$7,$8) returning `+storeCols,
		s.OrganizationID, s.Name, s.Code, s.City, s.State, s.Pincode, s.Latitude, s.Longitude))
}

func UpdateStore(ctx context.Context, q database.Querier, s models.Store) (models.Store, error) {
	return scanStore(q.QueryRow(ctx, `update stores set name=$2, city=$3, state=$4, pincode=$5, latitude=$6, longitude=$7, is_active=$8
		where id=$1 returning `+storeCols, s.ID, s.Name, s.City, s.State, s.Pincode, s.Latitude, s.Longitude, s.IsActive))
}

// ── Settings ────────────────────────────────────────────────────────────────

func GetSettings(ctx context.Context, q database.Querier, storeID string) (models.StoreSettings, error) {
	var s models.StoreSettings
	err := q.QueryRow(ctx, `select store_id, pricing_mode::text, min_margin_pct::float8, max_price_change_pct::float8,
			approval_threshold_pct::float8, expiry_markdown_days, max_expiry_markdown_pct::float8,
			allow_below_cost_clearance, low_stock_cover_days, overstock_cover_days, dead_stock_days,
			competitor_undercut_pct::float8, rules, updated_at
		from store_settings where store_id=$1`, storeID).
		Scan(&s.StoreID, &s.PricingMode, &s.MinMarginPct, &s.MaxPriceChangePct, &s.ApprovalThresholdPct,
			&s.ExpiryMarkdownDays, &s.MaxExpiryMarkdownPct, &s.AllowBelowCostClearance, &s.LowStockCoverDays,
			&s.OverstockCoverDays, &s.DeadStockDays, &s.CompetitorUndercutPct, &s.Rules, &s.UpdatedAt)
	return s, err
}

func SaveSettings(ctx context.Context, q database.Querier, s models.StoreSettings, userID string) error {
	tag, err := q.Exec(ctx, `update store_settings set pricing_mode=$2::pricing_mode, min_margin_pct=$3, max_price_change_pct=$4,
			approval_threshold_pct=$5, expiry_markdown_days=$6, max_expiry_markdown_pct=$7,
			allow_below_cost_clearance=$8, low_stock_cover_days=$9, overstock_cover_days=$10, dead_stock_days=$11,
			competitor_undercut_pct=$12, rules=$13, updated_by=$14
		where store_id=$1`,
		s.StoreID, s.PricingMode, s.MinMarginPct, s.MaxPriceChangePct, s.ApprovalThresholdPct, s.ExpiryMarkdownDays,
		s.MaxExpiryMarkdownPct, s.AllowBelowCostClearance, s.LowStockCoverDays, s.OverstockCoverDays, s.DeadStockDays,
		s.CompetitorUndercutPct, s.Rules, userID)
	if err == nil && tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return err
}

// ── Members ─────────────────────────────────────────────────────────────────

func ListMembers(ctx context.Context, q database.Querier, orgID string) ([]models.Member, error) {
	rows, err := q.Query(ctx, `select m.id, m.user_id, p.email, p.full_name, m.store_id, s.name, m.role::text
		from memberships m join profiles p on p.id = m.user_id left join stores s on s.id = m.store_id
		where m.organization_id=$1 order by p.email, s.name nulls first`, orgID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (models.Member, error) {
		var m models.Member
		var role string
		err := r.Scan(&m.MembershipID, &m.UserID, &m.Email, &m.FullName, &m.StoreID, &m.StoreName, &role)
		m.Role = models.Role(role)
		return m, err
	})
}

// FindUserByEmail looks up a profile by e-mail (system context: the invitee
// is not yet visible to the inviting admin under RLS).
func FindUserByEmail(ctx context.Context, q database.Querier, email string) (string, error) {
	var id string
	err := q.QueryRow(ctx, "select id from profiles where lower(email) = lower($1)", email).Scan(&id)
	return id, err
}

func UpsertMembership(ctx context.Context, q database.Querier, userID, orgID string, storeID *string, role models.Role) (string, error) {
	var id string
	err := q.QueryRow(ctx, `insert into memberships(user_id, organization_id, store_id, role) values ($1,$2,$3,$4)
		on conflict (user_id, organization_id, store_id) do update set role = excluded.role returning id`,
		userID, orgID, storeID, string(role)).Scan(&id)
	return id, err
}

func UpdateMembershipRole(ctx context.Context, q database.Querier, orgID, membershipID string, role models.Role) (string, error) {
	var userID string
	err := q.QueryRow(ctx, "update memberships set role=$3 where organization_id=$1 and id=$2 returning user_id",
		orgID, membershipID, string(role)).Scan(&userID)
	return userID, err
}

func DeleteMembership(ctx context.Context, q database.Querier, orgID, membershipID string) (string, error) {
	var userID string
	err := q.QueryRow(ctx, "delete from memberships where organization_id=$1 and id=$2 returning user_id", orgID, membershipID).Scan(&userID)
	return userID, err
}

// CountOrgAdmins guards against removing the last administrator.
func CountOrgAdmins(ctx context.Context, q database.Querier, orgID string) (int, error) {
	var n int
	err := q.QueryRow(ctx, "select count(*) from memberships where organization_id=$1 and store_id is null and role >= 'ADMIN'", orgID).Scan(&n)
	return n, err
}

// ── Inventory metrics / movements ───────────────────────────────────────────

type ProductMetrics struct {
	Avg, Std      float64
	DaysWithSales int
	LastSold      *time.Time
	LeadTime      int
}

func InventoryMetrics(ctx context.Context, q database.Querier, storeID string) (map[string]ProductMetrics, error) {
	rows, err := q.Query(ctx, `select product_id, avg_daily_units::float8, std_daily_units::float8, days_with_sales_28d,
		last_sold_at, lead_time_days from product_inventory_metrics where store_id=$1`, storeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]ProductMetrics{}
	for rows.Next() {
		var id string
		var m ProductMetrics
		if err := rows.Scan(&id, &m.Avg, &m.Std, &m.DaysWithSales, &m.LastSold, &m.LeadTime); err != nil {
			return nil, err
		}
		out[id] = m
	}
	return out, rows.Err()
}

func ListMovements(ctx context.Context, q database.Querier, storeID, productID string, limit, offset int) ([]models.InventoryMovement, int, error) {
	rows, err := q.Query(ctx, `select m.id, m.product_id, p.name, m.change, m.reason, m.stock_after, m.note,
			pr.email, m.created_at, count(*) over ()
		from inventory_movements m join products p on p.id = m.product_id
		left join profiles pr on pr.id = m.created_by
		where m.store_id=$1 and ($2 = '' or m.product_id::text = $2)
		order by m.created_at desc limit $3 offset $4`, storeID, productID, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []models.InventoryMovement{}
	total := 0
	for rows.Next() {
		var m models.InventoryMovement
		if err := rows.Scan(&m.ID, &m.ProductID, &m.ProductName, &m.Change, &m.Reason, &m.StockAfter, &m.Note,
			&m.CreatedBy, &m.CreatedAt, &total); err != nil {
			return nil, 0, err
		}
		out = append(out, m)
	}
	return out, total, rows.Err()
}
