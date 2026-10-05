package services

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/rishabh26raj/priceiq/backend-go/clients"
	"github.com/rishabh26raj/priceiq/backend-go/database"
	"github.com/rishabh26raj/priceiq/backend-go/utils"
)

// aiCached calls an AI endpoint for a store and caches the JSON response per
// store data version (so new sales/prices invalidate it automatically).
//
// ML inference is the slowest thing the API does (hundreds of ms to seconds),
// so identical requests are served from the cache. The key contains the
// store's version counter, which every write bumps via s.invalidate(): stale
// entries are never looked up again and simply expire after ttl.
func (s *Service) aiCached(ctx context.Context, storeID, kind, path string, payload map[string]any, ttl time.Duration) (map[string]any, error) {
	key := s.cacheKey(ctx, storeID, "ai:"+kind, payload)
	var out map[string]any
	if clients.GetJSON(ctx, s.Cache, key, &out) {
		out["cached"] = true
		return out, nil
	}
	payload["store_id"] = storeID
	if err := s.AI.Post(ctx, path, payload, &out, ""); err != nil {
		return nil, aiErr(err)
	}
	clients.SetJSON(ctx, s.Cache, key, out, ttl)
	out["cached"] = false
	return out, nil
}

// ensureProduct verifies the product belongs to the store under RLS before
// the AI service (which uses the service role) is asked about it.
func (s *Service) ensureProduct(ctx context.Context, id database.Identity, storeID, productID string) error {
	return s.DB.WithUser(ctx, id, func(tx pgx.Tx) error {
		_, err := repositoriesGetProductID(ctx, tx, storeID, productID)
		return err
	})
}

func (s *Service) Forecast(ctx context.Context, id database.Identity, storeID, productID string, horizon int) (map[string]any, error) {
	if horizon != 7 && horizon != 14 && horizon != 30 {
		return nil, utils.BadRequest("horizon must be 7, 14 or 30")
	}
	if err := s.ensureProduct(ctx, id, storeID, productID); err != nil {
		return nil, err
	}
	return s.aiCached(ctx, storeID, "forecast", "/v1/forecast", map[string]any{"product_id": productID, "horizon": horizon}, 30*time.Minute)
}

func (s *Service) ForecastOverview(ctx context.Context, storeID string, horizon int) (map[string]any, error) {
	if horizon != 7 && horizon != 14 && horizon != 30 {
		horizon = 7
	}
	return s.aiCached(ctx, storeID, "forecast-overview", "/v1/forecast/overview", map[string]any{"horizon": horizon}, 30*time.Minute)
}

func (s *Service) Elasticity(ctx context.Context, id database.Identity, storeID, productID string) (map[string]any, error) {
	if err := s.ensureProduct(ctx, id, storeID, productID); err != nil {
		return nil, err
	}
	return s.aiCached(ctx, storeID, "elasticity", "/v1/elasticity", map[string]any{"product_id": productID}, time.Hour)
}

func (s *Service) CrossEffects(ctx context.Context, id database.Identity, storeID, productID string) (map[string]any, error) {
	if err := s.ensureProduct(ctx, id, storeID, productID); err != nil {
		return nil, err
	}
	return s.aiCached(ctx, storeID, "cross", "/v1/cross-effects", map[string]any{"product_id": productID}, time.Hour)
}

func (s *Service) ExpiryOptimization(ctx context.Context, storeID string) (map[string]any, error) {
	st, err := s.settingsSystem(ctx, storeID)
	if err != nil {
		return nil, err
	}
	return s.aiCached(ctx, storeID, "expiry", "/v1/expiry/optimize", map[string]any{"settings": st}, 15*time.Minute)
}

func (s *Service) SeasonalInsights(ctx context.Context, storeID string) (map[string]any, error) {
	return s.aiCached(ctx, storeID, "seasonal", "/v1/seasonal/insights", map[string]any{}, 6*time.Hour)
}

func (s *Service) Weather(ctx context.Context, storeID string) (map[string]any, error) {
	key := "weather:" + storeID + ":" + time.Now().Format("2006-01-02T15")
	var out map[string]any
	if clients.GetJSON(ctx, s.Cache, key, &out) {
		return out, nil
	}
	if err := s.AI.Post(ctx, "/v1/weather", map[string]any{"store_id": storeID}, &out, ""); err != nil {
		return nil, aiErr(err)
	}
	clients.SetJSON(ctx, s.Cache, key, out, time.Hour)
	return out, nil
}

func (s *Service) Anomalies(ctx context.Context, storeID string) (map[string]any, error) {
	return s.aiCached(ctx, storeID, "anomalies", "/v1/anomalies/detect", map[string]any{}, 15*time.Minute)
}

func (s *Service) ModelInfo(ctx context.Context) (map[string]any, error) {
	var out map[string]any
	if err := s.AI.Get(ctx, "/v1/models", nil, &out); err != nil {
		return nil, aiErr(err)
	}
	return out, nil
}

func (s *Service) settingsSystem(ctx context.Context, storeID string) (map[string]any, error) {
	out := map[string]any{}
	err := s.DB.WithSystem(ctx, func(tx pgx.Tx) error {
		var mode string
		var minMargin, maxMarkdown float64
		var markdownDays int
		var belowCost bool
		if err := tx.QueryRow(ctx, `select pricing_mode::text, min_margin_pct::float8, max_expiry_markdown_pct::float8,
				expiry_markdown_days, allow_below_cost_clearance from store_settings where store_id=$1`, storeID).
			Scan(&mode, &minMargin, &maxMarkdown, &markdownDays, &belowCost); err != nil {
			return err
		}
		out["pricing_mode"], out["min_margin_pct"], out["max_expiry_markdown_pct"] = mode, minMargin, maxMarkdown
		out["expiry_markdown_days"], out["allow_below_cost_clearance"] = markdownDays, belowCost
		return nil
	})
	return out, err
}

// ── Seasonal events ─────────────────────────────────────────────────────────

type SeasonalEvent struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	EventType   string  `json:"event_type"`
	StartDate   string  `json:"start_date"`
	EndDate     string  `json:"end_date"`
	Approximate bool    `json:"is_date_approximate"`
	Notes       *string `json:"notes"`
	Custom      bool    `json:"custom"`
	DaysUntil   int     `json:"days_until"`
}

func (s *Service) SeasonalEvents(ctx context.Context, id database.Identity, storeID, from, to string) ([]SeasonalEvent, error) {
	out := []SeasonalEvent{}
	err := s.DB.WithUser(ctx, id, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `select e.id, e.name, e.event_type, to_char(e.start_date,'YYYY-MM-DD'), to_char(e.end_date,'YYYY-MM-DD'),
				e.is_date_approximate, e.notes, e.organization_id is not null, (e.start_date - current_date)
			from seasonal_events e
			where (e.organization_id is null or e.organization_id = (select organization_id from stores where id = $1))
			  and e.end_date >= coalesce(nullif($2,'')::date, current_date - 30)
			  and e.start_date <= coalesce(nullif($3,'')::date, current_date + 365)
			order by e.start_date`, storeID, from, to)
		if err != nil {
			return err
		}
		out, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (SeasonalEvent, error) {
			var e SeasonalEvent
			return e, r.Scan(&e.ID, &e.Name, &e.EventType, &e.StartDate, &e.EndDate, &e.Approximate, &e.Notes, &e.Custom, &e.DaysUntil)
		})
		return err
	})
	return out, err
}

type EventInput struct {
	Name      string `json:"name" binding:"required,max=120"`
	StartDate string `json:"start_date" binding:"required"`
	EndDate   string `json:"end_date" binding:"required"`
	Notes     string `json:"notes"`
}

func (s *Service) CreateSeasonalEvent(ctx context.Context, id database.Identity, storeID string, in EventInput) error {
	a, err1 := time.Parse("2006-01-02", in.StartDate)
	b, err2 := time.Parse("2006-01-02", in.EndDate)
	if err1 != nil || err2 != nil || b.Before(a) || b.Sub(a) > 120*24*time.Hour {
		return utils.Unprocessable("Invalid dates", map[string]string{"end_date": "dates must be YYYY-MM-DD, end ≥ start, at most 120 days"})
	}
	return s.userTx(ctx, id, "custom seasonal event", func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `insert into seasonal_events(organization_id, name, event_type, start_date, end_date, notes)
			values ((select organization_id from stores where id=$1), $2, 'CUSTOM', $3, $4, nullif($5,''))`,
			storeID, strings.TrimSpace(in.Name), in.StartDate, in.EndDate, in.Notes)
		return err
	})
}

// ── Copilot conversations ───────────────────────────────────────────────────

type ChatInput struct {
	ConversationID *string `json:"conversation_id" binding:"omitempty,uuid"`
	Message        string  `json:"message" binding:"required,max=4000"`
}

type ChatMessage struct {
	ID        string    `json:"id"`
	Role      string    `json:"role"`
	Content   string    `json:"content"`
	ToolCalls []any     `json:"tool_calls"`
	Sources   []any     `json:"sources"`
	CreatedAt time.Time `json:"created_at"`
}

// Chat stores the user message, asks the AI copilot (forwarding the user's
// token so its tools act with the user's permissions), and stores the reply.
func (s *Service) Chat(ctx context.Context, id database.Identity, token, storeID string, role string, in ChatInput) (map[string]any, error) {
	msg := strings.TrimSpace(in.Message)
	if msg == "" {
		return nil, utils.Unprocessable("Message is empty", nil)
	}
	var convID string
	var history []map[string]string
	err := s.DB.WithUser(ctx, id, func(tx pgx.Tx) error {
		if in.ConversationID != nil {
			if err := tx.QueryRow(ctx, "select id from ai_conversations where id=$1 and store_id=$2", *in.ConversationID, storeID).Scan(&convID); err != nil {
				if database.IsNotFound(err) {
					return utils.NotFound("Conversation")
				}
				return err
			}
			rows, err := tx.Query(ctx, `select role, content from (
				select role, content, created_at from ai_messages where conversation_id=$1 order by created_at desc limit 12) m
				order by created_at`, convID)
			if err != nil {
				return err
			}
			for rows.Next() {
				var r, c string
				if err := rows.Scan(&r, &c); err != nil {
					rows.Close()
					return err
				}
				history = append(history, map[string]string{"role": r, "content": c})
			}
			rows.Close()
		} else {
			title := msg
			if len(title) > 80 {
				title = title[:80] + "…"
			}
			if err := tx.QueryRow(ctx, "insert into ai_conversations(user_id, store_id, title) values ($1,$2,$3) returning id",
				id.UserID, storeID, title).Scan(&convID); err != nil {
				return err
			}
		}
		_, err := tx.Exec(ctx, "insert into ai_messages(conversation_id, role, content) values ($1,'user',$2)", convID, msg)
		return err
	})
	if err != nil {
		return nil, err
	}

	var reply struct {
		Answer    string   `json:"answer"`
		ToolCalls []any    `json:"tool_calls"`
		Sources   []any    `json:"sources"`
		Mode      string   `json:"mode"` // llm | rule_based | error — shown to the user as-is
		Provider  *string  `json:"provider"`
		Model     *string  `json:"model"`
		Warnings  []string `json:"warnings"`
		Factors   []string `json:"reasoning_factors"`
		DataSrc   []string `json:"data_sources"`
	}
	aiCtx, cancel := context.WithTimeout(ctx, 120*time.Second)
	defer cancel()
	callErr := s.AI.Post(aiCtx, "/v1/copilot/chat", map[string]any{
		"store_id": storeID, "conversation_id": convID, "message": msg, "history": history,
		"user": map[string]string{"id": id.UserID, "email": id.Email, "role": role},
	}, &reply, token)
	if callErr != nil {
		reply.Answer = "I couldn't reach the AI service, so I can't answer right now. No data was changed."
		reply.Mode = "error"
		reply.Warnings = []string{aiErr(callErr).Error()}
	}
	if reply.ToolCalls == nil {
		reply.ToolCalls = []any{}
	}
	if reply.Sources == nil {
		reply.Sources = []any{}
	}
	var msgID string
	var created time.Time
	err = s.DB.WithUser(ctx, id, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `insert into ai_messages(conversation_id, role, content, tool_calls, sources)
			values ($1,'assistant',$2,$3,$4) returning id, created_at`, convID, reply.Answer, reply.ToolCalls, reply.Sources).Scan(&msgID, &created); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, "update ai_conversations set updated_at=now() where id=$1", convID)
		return err
	})
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"conversation_id":   convID,
		"message":           ChatMessage{ID: msgID, Role: "assistant", Content: reply.Answer, ToolCalls: reply.ToolCalls, Sources: reply.Sources, CreatedAt: created},
		"mode":              reply.Mode,
		"provider":          reply.Provider,
		"model":             reply.Model,
		"warnings":          reply.Warnings,
		"reasoning_factors": reply.Factors,
		"data_sources":      reply.DataSrc,
	}, nil
}

func (s *Service) Conversations(ctx context.Context, id database.Identity, storeID string) ([]map[string]any, error) {
	out := []map[string]any{}
	err := s.DB.WithUser(ctx, id, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `select id, coalesce(title,''), updated_at from ai_conversations
			where store_id=$1 and user_id=$2 order by updated_at desc limit 50`, storeID, id.UserID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var cid, title string
			var at time.Time
			if err := rows.Scan(&cid, &title, &at); err != nil {
				return err
			}
			out = append(out, map[string]any{"id": cid, "title": title, "updated_at": at})
		}
		return rows.Err()
	})
	return out, err
}

func (s *Service) ConversationMessages(ctx context.Context, id database.Identity, storeID, convID string) ([]ChatMessage, error) {
	out := []ChatMessage{}
	err := s.DB.WithUser(ctx, id, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `select m.id, m.role, m.content, m.tool_calls, m.sources, m.created_at
			from ai_messages m join ai_conversations c on c.id = m.conversation_id
			where c.id=$1 and c.store_id=$2 order by m.created_at`, convID, storeID)
		if err != nil {
			return err
		}
		out, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (ChatMessage, error) {
			var m ChatMessage
			return m, r.Scan(&m.ID, &m.Role, &m.Content, &m.ToolCalls, &m.Sources, &m.CreatedAt)
		})
		return err
	})
	if err == nil && len(out) == 0 {
		return nil, utils.NotFound("Conversation")
	}
	return out, err
}

// ── Reports (CSV) ───────────────────────────────────────────────────────────

// ReportCSV streams a store report as CSV rows.
func (s *Service) ReportCSV(ctx context.Context, id database.Identity, storeID, kind string, r Range) ([][]string, error) {
	var out [][]string
	err := s.DB.WithUser(ctx, id, func(tx pgx.Tx) error {
		var sql string
		var header []string
		args := []any{storeID}
		switch kind {
		case "sales":
			header = []string{"sold_at", "sku", "product", "quantity", "unit_price", "unit_cost", "revenue", "profit", "source"}
			sql = `select to_char(s.sold_at,'YYYY-MM-DD HH24:MI'), p.sku, p.name, s.quantity::text, s.unit_price::text, s.unit_cost::text,
				s.revenue::text, s.profit::text, s.source from sales s join products p on p.id = s.product_id
				where s.store_id=$1 and s.sold_at >= $2 and s.sold_at < $3 order by s.sold_at`
			args = append(args, r.From, r.To)
		case "pricing":
			header = []string{"changed_at", "sku", "product", "old_price", "new_price", "source", "changed_by", "reason"}
			sql = `select to_char(h.created_at,'YYYY-MM-DD HH24:MI'), p.sku, p.name, coalesce(h.old_price::text,''), h.new_price::text,
				h.source, coalesce(pr.email,''), coalesce(h.reason,'') from pricing_history h join products p on p.id = h.product_id
				left join profiles pr on pr.id = h.changed_by
				where h.store_id=$1 and h.created_at >= $2 and h.created_at < $3 order by h.created_at`
			args = append(args, r.From, r.To)
		case "inventory":
			header = []string{"sku", "product", "category", "stock", "cost_price", "selling_price", "mrp", "value_at_cost", "expiry_date", "batch"}
			sql = `select p.sku, p.name, coalesce(c.name,''), p.stock::text, p.cost_price::text, p.selling_price::text, p.mrp::text,
				(p.stock * p.cost_price)::numeric(14,2)::text, coalesce(p.expiry_date::text,''), coalesce(p.batch_number,'')
				from products p left join categories c on c.id = p.category_id where p.store_id=$1 and p.is_active order by p.name`
		case "recommendations":
			header = []string{"created_at", "sku", "product", "current_price", "recommended_price", "status", "policy", "expected_profit", "reviewed_by"}
			sql = `select to_char(r.created_at,'YYYY-MM-DD HH24:MI'), p.sku, p.name, r.current_price::text, r.recommended_price::text,
				r.status::text, r.policy, coalesce(r.expected_profit::text,''), coalesce(pr.email,'')
				from pricing_recommendations r join products p on p.id = r.product_id left join profiles pr on pr.id = r.reviewed_by
				where r.store_id=$1 and r.created_at >= $2 and r.created_at < $3 order by r.created_at`
			args = append(args, r.From, r.To)
		default:
			return utils.BadRequest("report must be one of sales, pricing, inventory, recommendations")
		}
		rows, err := tx.Query(ctx, sql, args...)
		if err != nil {
			return err
		}
		defer rows.Close()
		out = append(out, header)
		for rows.Next() {
			vals, err := rows.Values()
			if err != nil {
				return err
			}
			rec := make([]string, len(vals))
			for i, v := range vals {
				rec[i] = fmt.Sprint(v)
			}
			out = append(out, rec)
			if len(out) > 200000 {
				return utils.BadRequest("report too large — narrow the date range")
			}
		}
		return rows.Err()
	})
	return out, err
}
