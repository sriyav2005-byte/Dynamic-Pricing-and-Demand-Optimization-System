package services

import (
	"context"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"

	"github.com/rishabh26raj/priceiq/backend-go/config"
	"github.com/rishabh26raj/priceiq/backend-go/database"
	"github.com/rishabh26raj/priceiq/backend-go/models"
	"github.com/rishabh26raj/priceiq/backend-go/repositories"
	"github.com/rishabh26raj/priceiq/backend-go/utils"
)

var emailPattern = regexp.MustCompile(`^[^@\s]+@[^@\s]+\.[^@\s]+$`)

// ── Local authentication (development only) ─────────────────────────────────
// With AUTH_PROVIDER=supabase these endpoints are disabled; the frontend uses
// Supabase Auth (sign-up, e-mail verification, password reset) directly and
// the API only verifies the resulting access tokens.

type RegisterInput struct {
	Email     string `json:"email" binding:"required"`
	Password  string `json:"password" binding:"required"`
	FullName  string `json:"full_name" binding:"required"`
	Phone     string `json:"phone"`
	StoreName string `json:"store_name"`
	City      string `json:"city"`
	State     string `json:"state"`
	Pincode   string `json:"pincode"`
}

type LoginInput struct {
	Email    string `json:"email" binding:"required"`
	Password string `json:"password" binding:"required"`
}

type Session struct {
	AccessToken string    `json:"access_token"`
	TokenType   string    `json:"token_type"`
	ExpiresAt   time.Time `json:"expires_at"`
	User        models.Me `json:"user"`
}

// ValidatePassword enforces a minimum policy (≥8 chars, a letter and a digit).
func ValidatePassword(pw string) string {
	if len(pw) < 8 {
		return "must be at least 8 characters"
	}
	if len(pw) > 72 {
		return "must be at most 72 characters"
	}
	var letter, digit bool
	for _, r := range pw {
		letter = letter || unicode.IsLetter(r)
		digit = digit || unicode.IsDigit(r)
	}
	if !letter || !digit {
		return "must contain at least one letter and one digit"
	}
	return ""
}

func (s *Service) localEnabled() error {
	if s.Cfg.AuthProvider != config.AuthLocal {
		return utils.NotFound("Endpoint")
	}
	return nil
}

func (s *Service) LocalRegister(ctx context.Context, in RegisterInput) (Session, error) {
	if err := s.localEnabled(); err != nil {
		return Session{}, err
	}
	email := strings.ToLower(strings.TrimSpace(in.Email))
	errs := map[string]string{}
	if !emailPattern.MatchString(email) {
		errs["email"] = "must be a valid e-mail address"
	}
	if msg := ValidatePassword(in.Password); msg != "" {
		errs["password"] = msg
	}
	if strings.TrimSpace(in.FullName) == "" {
		errs["full_name"] = "is required"
	}
	if in.Pincode != "" && !regexp.MustCompile(`^[0-9]{6}$`).MatchString(in.Pincode) {
		errs["pincode"] = "must be 6 digits"
	}
	if len(errs) > 0 {
		return Session{}, utils.Unprocessable("Invalid registration", errs)
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(in.Password), 12)
	if err != nil {
		return Session{}, err
	}
	var userID string
	err = s.DB.WithSystem(ctx, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `insert into auth.users(email, encrypted_password, email_confirmed_at, raw_user_meta_data)
			values ($1, $2, now(), jsonb_build_object('full_name', $3::text, 'phone', $4::text, 'store_name', $5::text,
			        'city', $6::text, 'state', $7::text, 'pincode', $8::text)) returning id`,
			email, string(hash), strings.TrimSpace(in.FullName), in.Phone, strings.TrimSpace(in.StoreName), in.City, in.State, in.Pincode).Scan(&userID)
	})
	if database.PgCode(err) == database.CodeUniqueViolation {
		return Session{}, utils.Conflict("An account with this e-mail already exists")
	}
	if err != nil {
		return Session{}, err
	}
	return s.issueSession(ctx, userID, email)
}

func (s *Service) LocalLogin(ctx context.Context, in LoginInput) (Session, error) {
	if err := s.localEnabled(); err != nil {
		return Session{}, err
	}
	email := strings.ToLower(strings.TrimSpace(in.Email))
	var userID string
	var hash *string
	err := s.DB.Pool.QueryRow(ctx, "select id, encrypted_password from auth.users where lower(email)=$1", email).Scan(&userID, &hash)
	// Compare against a dummy hash when the user is unknown to keep timing uniform.
	h := string(dummyHash())
	if err == nil && hash != nil {
		h = *hash
	}
	if bcrypt.CompareHashAndPassword([]byte(h), []byte(in.Password)) != nil || err != nil || hash == nil {
		return Session{}, utils.Unauthorized("Invalid e-mail or password")
	}
	_, _ = s.DB.Pool.Exec(ctx, "update auth.users set last_sign_in_at=now() where id=$1", userID)
	return s.issueSession(ctx, userID, email)
}

func (s *Service) issueSession(ctx context.Context, userID, email string) (Session, error) {
	token, exp, err := s.Verifier.IssueLocal(userID, email, s.Cfg.LocalTokenTTL)
	if err != nil {
		return Session{}, err
	}
	me, err := s.Me(ctx, database.Identity{UserID: userID, Email: email})
	if err != nil {
		return Session{}, err
	}
	return Session{AccessToken: token, TokenType: "bearer", ExpiresAt: exp, User: me}, nil
}

// ── Profile & access ────────────────────────────────────────────────────────

func (s *Service) Me(ctx context.Context, id database.Identity) (models.Me, error) {
	// Supabase users normally get a profile from the auth.users trigger; this
	// idempotent upsert covers accounts created before the trigger existed.
	if err := s.DB.WithSystem(ctx, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, "insert into profiles(id, email) select $1, $2 where exists (select 1 from auth.users where id = $1) on conflict (id) do nothing",
			id.UserID, id.Email)
		return err
	}); err != nil {
		return models.Me{}, err
	}
	var me models.Me
	err := s.DB.WithUser(ctx, id, func(tx pgx.Tx) error {
		p, err := repositories.GetProfile(ctx, tx, id.UserID)
		if database.IsNotFound(err) {
			return utils.Unauthorized("No account exists for this session")
		}
		if err != nil {
			return err
		}
		me.Profile = p
		me.Stores, err = repositories.AccessibleStores(ctx, tx, id.UserID)
		return err
	})
	if me.Stores == nil {
		me.Stores = []models.StoreAccess{}
	}
	return me, err
}

func (s *Service) UpdateMe(ctx context.Context, id database.Identity, fullName, phone *string) (models.Me, error) {
	err := s.DB.WithUser(ctx, id, func(tx pgx.Tx) error {
		return repositories.UpdateProfile(ctx, tx, id.UserID, trimPtr(fullName), trimPtr(phone))
	})
	if err != nil {
		return models.Me{}, err
	}
	return s.Me(ctx, id)
}

// ── Stores & settings ───────────────────────────────────────────────────────

func (s *Service) GetStore(ctx context.Context, id database.Identity, storeID string) (models.Store, error) {
	var st models.Store
	err := s.DB.WithUser(ctx, id, func(tx pgx.Tx) error {
		var err error
		st, err = repositories.GetStore(ctx, tx, storeID)
		return err
	})
	return st, err
}

type StoreInput struct {
	Name      string   `json:"name" binding:"required,max=120"`
	Code      string   `json:"code" binding:"omitempty,max=32"`
	City      *string  `json:"city"`
	State     *string  `json:"state"`
	Pincode   *string  `json:"pincode"`
	Latitude  *float64 `json:"latitude" binding:"omitempty,gte=-90,lte=90"`
	Longitude *float64 `json:"longitude" binding:"omitempty,gte=-180,lte=180"`
	IsActive  *bool    `json:"is_active"`
}

func (s *Service) CreateStore(ctx context.Context, id database.Identity, orgID string, in StoreInput) (models.Store, error) {
	code := strings.ToUpper(strings.TrimSpace(in.Code))
	if code == "" {
		code = strings.ToUpper(regexp.MustCompile(`[^A-Za-z0-9]+`).ReplaceAllString(in.Name, "-"))
		if len(code) > 16 {
			code = code[:16]
		}
	}
	var st models.Store
	err := s.userTx(ctx, id, "store created", func(tx pgx.Tx) error {
		var err error
		st, err = repositories.CreateStore(ctx, tx, models.Store{OrganizationID: orgID, Name: strings.TrimSpace(in.Name), Code: code,
			City: trimPtr(in.City), State: trimPtr(in.State), Pincode: trimPtr(in.Pincode), Latitude: in.Latitude, Longitude: in.Longitude})
		return err
	})
	if err == nil {
		s.Roles.InvalidateUser(ctx, id.UserID)
	}
	return st, err
}

func (s *Service) UpdateStore(ctx context.Context, id database.Identity, storeID string, in StoreInput) (models.Store, error) {
	var st models.Store
	err := s.userTx(ctx, id, "store updated", func(tx pgx.Tx) error {
		cur, err := repositories.GetStore(ctx, tx, storeID)
		if err != nil {
			return err
		}
		cur.Name = strings.TrimSpace(in.Name)
		if in.City != nil {
			cur.City = trimPtr(in.City)
		}
		if in.State != nil {
			cur.State = trimPtr(in.State)
		}
		if in.Pincode != nil {
			cur.Pincode = trimPtr(in.Pincode)
		}
		if in.Latitude != nil {
			cur.Latitude = in.Latitude
		}
		if in.Longitude != nil {
			cur.Longitude = in.Longitude
		}
		if in.IsActive != nil {
			cur.IsActive = *in.IsActive
		}
		st, err = repositories.UpdateStore(ctx, tx, cur)
		if database.IsNotFound(err) {
			return utils.Forbidden("Only organization admins can edit stores")
		}
		return err
	})
	return st, err
}

func (s *Service) GetSettings(ctx context.Context, id database.Identity, storeID string) (models.StoreSettings, error) {
	var st models.StoreSettings
	err := s.DB.WithUser(ctx, id, func(tx pgx.Tx) error {
		var err error
		st, err = repositories.GetSettings(ctx, tx, storeID)
		return err
	})
	return st, err
}

func (s *Service) SaveSettings(ctx context.Context, id database.Identity, storeID string, in models.StoreSettings, reason string) (models.StoreSettings, error) {
	errs := map[string]string{}
	switch in.PricingMode {
	case "MANUAL", "SEMI_AUTOMATIC", "AUTOMATIC":
	default:
		errs["pricing_mode"] = "must be MANUAL, SEMI_AUTOMATIC or AUTOMATIC"
	}
	checkPct := func(name string, v, lo, hi float64) {
		if v < lo || v > hi {
			errs[name] = "out of range"
		}
	}
	checkPct("min_margin_pct", in.MinMarginPct, 0, 0.95)
	checkPct("max_price_change_pct", in.MaxPriceChangePct, 0.005, 1)
	checkPct("approval_threshold_pct", in.ApprovalThresholdPct, 0, 1)
	checkPct("max_expiry_markdown_pct", in.MaxExpiryMarkdownPct, 0, 0.95)
	checkPct("competitor_undercut_pct", in.CompetitorUndercutPct, 0, 1)
	if in.ExpiryMarkdownDays < 0 || in.ExpiryMarkdownDays > 365 {
		errs["expiry_markdown_days"] = "must be 0–365"
	}
	if in.LowStockCoverDays < 0 || in.OverstockCoverDays <= in.LowStockCoverDays {
		errs["overstock_cover_days"] = "must be greater than low_stock_cover_days"
	}
	if in.DeadStockDays <= 0 {
		errs["dead_stock_days"] = "must be positive"
	}
	if len(in.Rules) == 0 {
		in.Rules = []byte("{}")
	}
	if _, err := ParseRules(in.Rules); err != nil {
		errs["rules"] = err.Error()
	}
	if len(errs) > 0 {
		return models.StoreSettings{}, utils.Unprocessable("Invalid settings", errs)
	}
	in.StoreID = storeID
	err := s.userTx(ctx, id, deref(&reason, ""), func(tx pgx.Tx) error {
		err := repositories.SaveSettings(ctx, tx, in, id.UserID)
		if database.IsNotFound(err) {
			return utils.Forbidden("Only admins can change store settings")
		}
		return err
	})
	if err != nil {
		return models.StoreSettings{}, err
	}
	s.invalidate(ctx, storeID)
	return s.GetSettings(ctx, id, storeID)
}

// ── Members (organization admins) ───────────────────────────────────────────

func (s *Service) requireOrgAdmin(ctx context.Context, id database.Identity, orgID string) error {
	var ok bool
	err := s.DB.WithUser(ctx, id, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, "select app.has_org_role($1, 'ADMIN')", orgID).Scan(&ok)
	})
	if err != nil {
		return err
	}
	if !ok {
		return utils.Forbidden("Organization admin role required")
	}
	return nil
}

func (s *Service) ListMembers(ctx context.Context, id database.Identity, orgID string) ([]models.Member, error) {
	if err := s.requireOrgAdmin(ctx, id, orgID); err != nil {
		return nil, err
	}
	var out []models.Member
	err := s.DB.WithUser(ctx, id, func(tx pgx.Tx) error {
		var err error
		out, err = repositories.ListMembers(ctx, tx, orgID)
		return err
	})
	return out, err
}

type MemberInput struct {
	Email   string  `json:"email"`
	StoreID *string `json:"store_id" binding:"omitempty,uuid"`
	Role    string  `json:"role" binding:"required"`
	Reason  string  `json:"reason"`
}

func validAssignableRole(r string) bool {
	role := models.Role(r)
	return role.Valid() && role != models.RoleSuperAdmin
}

func (s *Service) AddMember(ctx context.Context, id database.Identity, orgID string, in MemberInput) (models.Member, error) {
	if err := s.requireOrgAdmin(ctx, id, orgID); err != nil {
		return models.Member{}, err
	}
	if !validAssignableRole(in.Role) {
		return models.Member{}, utils.Unprocessable("Invalid role", map[string]string{"role": "must be VIEWER, ANALYST, STORE_MANAGER or ADMIN"})
	}
	var userID string
	if err := s.DB.WithSystem(ctx, func(tx pgx.Tx) error {
		var err error
		userID, err = repositories.FindUserByEmail(ctx, tx, strings.TrimSpace(in.Email))
		return err
	}); err != nil {
		if database.IsNotFound(err) {
			return models.Member{}, utils.NotFound("User with this e-mail (they must sign up first)")
		}
		return models.Member{}, err
	}
	var mid string
	err := s.userTx(ctx, id, in.Reason, func(tx pgx.Tx) error {
		var err error
		mid, err = repositories.UpsertMembership(ctx, tx, userID, orgID, in.StoreID, models.Role(in.Role))
		return err
	})
	if err != nil {
		return models.Member{}, err
	}
	s.Roles.InvalidateUser(ctx, userID)
	members, err := s.ListMembers(ctx, id, orgID)
	for _, m := range members {
		if m.MembershipID == mid {
			return m, nil
		}
	}
	return models.Member{}, err
}

func (s *Service) ChangeMemberRole(ctx context.Context, id database.Identity, orgID, membershipID, role, reason string) error {
	if err := s.requireOrgAdmin(ctx, id, orgID); err != nil {
		return err
	}
	if !validAssignableRole(role) {
		return utils.Unprocessable("Invalid role", map[string]string{"role": "must be VIEWER, ANALYST, STORE_MANAGER or ADMIN"})
	}
	var userID string
	err := s.userTx(ctx, id, reason, func(tx pgx.Tx) error {
		var err error
		if userID, err = repositories.UpdateMembershipRole(ctx, tx, orgID, membershipID, models.Role(role)); err != nil {
			return err
		}
		n, err := repositories.CountOrgAdmins(ctx, tx, orgID)
		if err == nil && n == 0 {
			return utils.Conflict("An organization must keep at least one admin")
		}
		return err
	})
	if database.IsNotFound(err) {
		return utils.NotFound("Membership")
	}
	if err == nil {
		s.Roles.InvalidateUser(ctx, userID)
	}
	return err
}

func (s *Service) RemoveMember(ctx context.Context, id database.Identity, orgID, membershipID, reason string) error {
	if err := s.requireOrgAdmin(ctx, id, orgID); err != nil {
		return err
	}
	var userID string
	err := s.userTx(ctx, id, reason, func(tx pgx.Tx) error {
		var err error
		if userID, err = repositories.DeleteMembership(ctx, tx, orgID, membershipID); err != nil {
			return err
		}
		n, err := repositories.CountOrgAdmins(ctx, tx, orgID)
		if err == nil && n == 0 {
			return utils.Conflict("An organization must keep at least one admin")
		}
		return err
	})
	if database.IsNotFound(err) {
		return utils.NotFound("Membership")
	}
	if err == nil {
		s.Roles.InvalidateUser(ctx, userID)
	}
	return err
}

// ── Audit log ───────────────────────────────────────────────────────────────

type AuditEntry struct {
	ID         int64          `json:"id"`
	StoreID    *string        `json:"store_id"`
	UserID     *string        `json:"user_id"`
	UserEmail  *string        `json:"user_email"`
	Action     string         `json:"action"`
	EntityType string         `json:"entity_type"`
	EntityID   *string        `json:"entity_id"`
	OldValue   map[string]any `json:"old_value"`
	NewValue   map[string]any `json:"new_value"`
	Reason     *string        `json:"reason"`
	CreatedAt  time.Time      `json:"created_at"`
}

func (s *Service) AuditLog(ctx context.Context, id database.Identity, storeID, entityType, entityID, action string, limit, offset int) (models.Page[AuditEntry], error) {
	page := models.Page[AuditEntry]{Data: []AuditEntry{}}
	err := s.DB.WithUser(ctx, id, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `select a.id, a.store_id, a.user_id, p.email, a.action, a.entity_type, a.entity_id,
				a.old_value, a.new_value, a.reason, a.created_at, count(*) over ()
			from audit_logs a left join profiles p on p.id = a.user_id
			where a.store_id=$1 and ($2 = '' or a.entity_type = $2) and ($3 = '' or a.entity_id = $3) and ($4 = '' or a.action = $4)
			order by a.id desc limit $5 offset $6`, storeID, entityType, entityID, action, limit, offset)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var e AuditEntry
			if err := rows.Scan(&e.ID, &e.StoreID, &e.UserID, &e.UserEmail, &e.Action, &e.EntityType, &e.EntityID,
				&e.OldValue, &e.NewValue, &e.Reason, &e.CreatedAt, &page.Total); err != nil {
				return err
			}
			page.Data = append(page.Data, e)
		}
		return rows.Err()
	})
	return page, err
}

var (
	dummyOnce sync.Once
	dummy     []byte
)

func dummyHash() []byte {
	dummyOnce.Do(func() { dummy, _ = bcrypt.GenerateFromPassword([]byte("timing-equalizer"), 12) })
	return dummy
}
