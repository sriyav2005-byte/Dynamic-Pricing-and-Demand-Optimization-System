# PROJECT_CONTEXT.md — PriceIQ

> Persistent context for humans and AI coding agents. Read this first; it
> replaces scanning the repository. Keep it accurate when you change behaviour.
> Last verified against the code: **2 Oct 2026**.

## 1. Project identity

| | |
|---|---|
| **Name** | PriceIQ — AI-Powered Dynamic Pricing & Retail Intelligence Platform |
| **Purpose** | Decision support for Indian FMCG / quick-commerce stores: demand forecasting, constraint-safe price recommendations with explanations and manager approval, inventory & expiry (wastage) optimization, competitor intelligence, seasonal planning, alerts, reports and an AI copilot. |
| **Users / roles** | VIEWER < ANALYST < STORE_MANAGER < ADMIN < SUPER_ADMIN, per store or organization-wide. |
| **Version** | **6.0** (October 2026) |
| **Scope** | Application run locally against a hosted **Supabase PostgreSQL** database. Demo data is **synthetic**. Deployment (Docker, CI/CD, cloud) is intentionally out of scope. |

## 2. Current architecture

```text
Browser
   │  Bearer token (Supabase Auth JWT, or a local dev JWT issued by the Go API)
   ▼
Next.js frontend :3000            UI only
   ▼
Go / Gin API :8080                auth → rate limit → store RBAC → service
   │   ├─ Supabase PostgreSQL as the END USER (role authenticated + JWT claims ⇒ RLS), via the transaction pooler
   │   ├─ Redis (optional) or in-memory cache: responses, rate limits, job locks
   │   └─ Python FastAPI AI service :8000  (X-Internal-Token = AI_SERVICE_TOKEN; loopback only)
   │          ├─ Supabase PostgreSQL with the service role, only for ids Go already authorized
   │          ├─ ML: XGBoost demand model, bandits, GLMs
   │          ├─ competitor fetchers (Playwright / HTTP)
   │          └─ OpenRouter API → configurable LLM (OPENROUTER_API_KEY) — optional
   ▼
Go pricing constraint engine (PriceBounds → Enforce → ValidatePrice at apply time)
```

The browser never calls the Python service or the LLM provider.

## 3. Directory structure

```text
frontend/
  src/app/<route>/page.tsx      dashboard, products, product/[id], pricing (approval queue), simulator, forecasting,
                                inventory, competitors, live-search (competitor search), seasonal, analytics,
                                agent (copilot), alerts, reports, audit, settings, login, reset-password
  src/components/               ui/kit.tsx (shared UI, useAsync, status badges), ui/Sidebar.tsx,
                                providers/AppProvider.tsx (session, current store, `can()`, toasts, confirm),
                                pricing/, forecast/, competitors/, products/, charts/viz.tsx
  src/lib/api.ts                typed client for every Go endpoint      src/lib/auth.ts  Supabase / local auth adapter
backend-go/
  cmd/server | migrate | seed | devdb     API · migrations · synthetic demo data · embedded PostgreSQL 16 (:54322, local fallback)
  config/  database/  middleware/  routes/routes.go (ALL routes + role guards — start here)  controllers/
  services/                     pricing.go, constraints.go, products.go, importer.go, inventory.go, sales.go, analytics.go,
                                competitors.go, seasonal.go, intelligence.go (AI proxies, copilot chat, reports), alerts.go, account.go
  repositories/ (all SQL)  models/  clients/ (ai.go, cache.go, mailer.go)  workers/workers.go
backend/
  app/main.py, api/routes.py    FastAPI app; every /v1 route requires X-Internal-Token
  app/services/                 pricing.py, considerations.py, expiry.py, data.py, weather.py, ml_admin.py,
                                competitors/{adapters.py, service.py}
  app/ml/                       features.py, inference/demand.py, training/train_demand.py, forecasting/forecaster.py,
                                pricing/{optimizer.py, bandit.py, elasticity.py}, seasonal.py, anomalies.py, evaluation/metrics.py
  app/agents/                   copilot.py (loop, grounding, cache), llm.py (provider), tools.py (tools → Go API as the user),
                                fallback.py (rule-based assistant)
  app/rag/                      store.py, docs/*.md (knowledge base the copilot quotes — keep in sync with behaviour)
  scripts/generate_synthetic_data.py
  tests/                        test_ml_units.py, test_copilot_llm.py (no DB, LLM mocked), test_integration.py (needs seeded DB)
supabase/
  migrations/*.sql              schema, RLS, triggers, reference data — append new files, never edit applied ones
  local/00_auth_shim.sql        auth.users / auth.uid() / roles for plain PostgreSQL (NEVER apply on Supabase)
data/                           priceiq_catalog.json, priceiq_synthetic_daily.csv (SYNTHETIC)
models/                         demand_model_xgb_v2.pkl (git-ignored; produced by training)
```

There is no top-level `tests/` folder and no Python virtualenv in the repo (use any Python 3.11+ with `backend/requirements.txt`).

## 4. Backend (Go) responsibilities

The **only browser-facing backend**: authentication, store-scoped RBAC, RLS-scoped SQL, business rules, the pricing
constraint engine, approval workflow, CSV/XLSX import and CSV reports, caching, rate limiting, audit context,
background workers (alert scan 15 min, competitor refresh 6 h, automatic pricing, ML refresh). It calls the AI service
after authorization has succeeded and never trusts a price from it without clamping.

## 5. Python AI service responsibilities

Internal only. Demand model training / inference, forecasting with backtest intervals, price optimization (Thompson
Sampling inside the band Go supplies), elasticity, TreeSHAP explanations, simulation, expiry optimization, anomalies,
seasonal statistics, weather context, competitor fetching, RAG and the copilot. It is stateless about tenancy: it acts
only on store / product ids Go has authorized.

## 6. Frontend responsibilities

Rendering, forms and client-side role hints (`can()`); no business rules and no secrets. Talks only to the Go API
(`NEXT_PUBLIC_API_URL`). Shows data-status badges, the synthetic-data banner and the copilot mode (LLM vs rule-based).

## 7. Database / schema overview

```text
organizations 1─* stores 1─1 store_settings (pricing mode, margins, limits, rules JSON)
profiles (= auth.users) *─* organizations via memberships(role, store_id NULL ⇒ org-wide)
stores 1─* products ─ categories, suppliers (org-level)
products 1─* sales · inventory_movements · pricing_history · product_daily_snapshots (feature store)
products 1─* pricing_recommendations ─ model_versions       products 1─1 price_elasticities · bandit_states(policy)
products *─* competitors via competitor_products 1─1 competitor_prices (latest) 1─* competitor_price_history
stores 1─* seasonal_considerations (optional product_id | category_id)      seasonal_events (org NULL ⇒ global)
stores 1─* alerts ─ notifications(user)      ai_conversations 1─* ai_messages      audit_logs (append-only)
knowledge_documents 1─* knowledge_chunks (RAG)
```

Key columns: `stores.data_mode` (LIVE | SYNTHETIC), `products.is_synthetic`, `sales.source` (POS | MANUAL | IMPORT |
SYNTHETIC), `products.{is_perishable, expiry_date, pack_size, shelf_life_days, seasonal_/festival_/weather_sensitivity}`,
`competitor_prices.{data_status, source, observed_at}`. `days_to_expiry` and wastage risk are **derived**, never stored.
`app.store_reference_time(store)` = now() for LIVE stores, last synthetic sale for SYNTHETIC stores. RLS is enabled on
every table (32 tables, 74 policies on the Supabase project). Latest migration: `20261002000001_perishables_and_seasonal_considerations.sql`; applied versions are recorded in `public.schema_migrations`.

**Supabase.** PostgreSQL 17, project region Tokyo (`ap-northeast-1`). Both services connect through the **transaction pooler** (`aws-0-<region>.pooler.supabase.com:6543`, user `postgres.<ref>`): the direct host `db.<ref>.supabase.co` is IPv6-only and its name does not resolve on every network. In pooler mode the Go pool uses `QueryExecModeCacheDescribe` (no named prepared statements, parameter types still known — required for `[]byte` → `jsonb`); restart the API after migrations. Never issue session-level `SET` through the pooler — it sticks to a shared server connection. The embedded database in `backend-go/.devdata/` is an independent local fallback.

## 8. Important API / service flows

- **Auth.** `AUTH_PROVIDER=supabase`: the frontend signs in with Supabase Auth and the Go API verifies the access token — signature against the project's JWKS (ES256 / RS256; HS256 only if `SUPABASE_JWT_SECRET` is set), expiry (required), audience `authenticated`, role claim `authenticated`, subject = user id. `AUTH_PROVIDER=local`: `POST /auth/local/login` checks the bcrypt hash in `auth.users` and issues an HS256 token (issuer `priceiq-local`); works on the local database and on Supabase; refused when `APP_ENV=production`. The issuer claim is not checked in Supabase mode (the signing key identifies the project). Either way only user id + e-mail are kept.
- **RBAC.** Authentication says who the caller is; PriceIQ decides what they may do. Roles are never read from the token: `RoleResolver` looks up the highest role on `:store_id` in `memberships` (cached 60 s; `store_id NULL` = organization-wide). Unknown / foreign stores → 404. Route minimums: analyst — generate recommendations, simulate; store manager — product / price / stock changes, approve / apply, considerations, competitor entries; admin — store settings, members.
- **Products.** CRUD + import (`importer.go`: dry run, upsert by SKU, per-row errors, one transaction). Price / stock changes are logged by triggers (`pricing_history`, `inventory_movements`, `audit_logs`).
- **Inventory.** `ComputeInventory`: 28-day velocity, days of cover, safety stock, reorder point / quantity, statuses, expiry risk, wastage risk %.
- **Sales.** `RecordSale` inserts, decrements stock atomically, then posts the outcome to `/v1/pricing/feedback` (bandit learning).
- **Recommendation.** Go: product + settings → `PriceBounds` → AI `/v1/pricing/recommend` (demand model over candidate prices, seasonal considerations, Thompson Sampling inside the band, explanation) → Go `Enforce` clamps and records binding rules → `pricing_recommendations` (older pending → SUPERSEDED).
- **Approval.** MANUAL: pending. SEMI_AUTOMATIC: approval required. AUTOMATIC: only small, confident (≥ 0.5), conflict-free changes auto-apply. Apply re-locks the product, refuses stale recommendations (EXPIRED) and re-validates the band.
- **Forecast.** Demand model per day (7 / 14 / 30), stock- and expiry-capped expected sales, 80% intervals from a rolling-origin backtest. Go caches per store data version.
- **Competitor search / refresh.** See §14.
- **Expiry optimization.** Markdown levels evaluated with the demand model; unsold units at expiry count as a loss; floor = cost unless below-cost clearance is enabled. Suggestions only.
- **Alerts.** `ScanStore`: inventory, competitor undercut, demand spike / drop, pricing opportunity, anomalies → deduplicated alerts + notifications.
- **Reports.** `GET /reports/{sales|pricing|inventory|recommendations}` → CSV (formula-injection-safe).
- **Copilot.** See §13b.

## 9. Environment variables (names only — never commit values)

| File | Required | Optional |
|---|---|---|
| `backend-go/.env` | `DATABASE_URL` (Supabase transaction pooler), `AUTH_PROVIDER` (`supabase`\|`local`), `AI_SERVICE_TOKEN`, and `SUPABASE_URL` (JWKS; `SUPABASE_JWT_SECRET` only for legacy HS256 projects) **or** `LOCAL_JWT_SECRET` (≥ 32 chars, local) | `APP_ENV`, `PORT`, `REDIS_URL`, `AI_SERVICE_URL`, `AI_TIMEOUT`, `CORS_ORIGINS`, `RATE_LIMIT_PER_MINUTE`, `WORKERS_ENABLED`, `*_INTERVAL`, `SMTP_*`, `SEED_DEMO_PASSWORD`, `SUPABASE_SERVICE_ROLE_KEY` (seed only) |
| `backend/.env` | `DATABASE_URL`, `AI_SERVICE_TOKEN` (must equal the Go value) | `GO_API_URL`, `AI_PROVIDER`, `OPENROUTER_API_KEY`, `AI_MODEL`, `OPENROUTER_SITE_URL`, `OPENROUTER_APP_NAME`, `OPENROUTER_BASE_URL`, `AI_TIMEOUT_S`, `AI_MAX_TOKENS`, `AI_BUDGET_S`, `VOYAGE_API_KEY`, `PRICING_POLICY`, `PLAYWRIGHT_ENABLED`, `SCRAPE_TIMEOUT_S`, `DEFAULT_LAT/LON`, `MODELS_DIR`, `DATASET_PATH` |
| `frontend/.env.local` | `NEXT_PUBLIC_API_URL` | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` |

Copy each `.env.example`. `AI_SERVICE_TOKEN` (Go ↔ Python) and `OPENROUTER_API_KEY` (Python ↔ OpenRouter) are separate credentials. `DATABASE_URL` must be identical in both backend files. The only Supabase key allowed in the frontend is the publishable (anon) key; `SUPABASE_SERVICE_ROLE_KEY` is used by `cmd/seed` only.

## 10. Startup

```bash
cd backend    && python -m uvicorn app.main:app --port 8000           # 1. AI service — NO --reload (breaks Playwright on Windows)
cd backend-go && go run ./cmd/server                                  # 2. Go API :8080
cd frontend   && npm run dev                                          # 3. Frontend :3000
```

The database is remote (Supabase); nothing local has to be started for it. First time on a database:
`go run ./cmd/migrate`, `go run ./cmd/seed`, `python -m app.ml.training.train_demand` (registers the model in
`model_versions`), plus `pip install -r requirements.txt`, `python -m playwright install chromium`, `npm install`.
Demo logins (password = `SEED_DEMO_PASSWORD`): `demo@priceiq.ai` (ADMIN, both stores), `manager@priceiq.ai`
(STORE_MANAGER, Koramangala), `analyst@priceiq.ai` (ANALYST, both stores), `viewer@priceiq.ai` (VIEWER, Indiranagar).
Nothing fails to start when `OPENROUTER_API_KEY` is missing.

**Local fallback:** `go run ./cmd/devdb` (embedded PostgreSQL on :54322), `go run ./cmd/migrate -local-shim`,
`go run ./cmd/seed`, with the local `DATABASE_URL` from `.env.example` in both backend files and `AUTH_PROVIDER=local`.

## 11. Test commands

```bash
cd backend-go && go vet ./... && go test ./...   # RLS / cross-tenant, API integration (embedded PG + fake AI), constraints
cd backend && python -m pytest tests             # ML units + copilot/LLM (mocked); integration tests use the DATABASE_URL in backend/.env
cd frontend && npm run build && npx eslint src
```

`go test` never touches the configured database: it starts a throwaway embedded PostgreSQL in a temp directory (or uses `TEST_DATABASE_URL`). The Python integration tests run against the configured database and clean up the one row they insert.
If `npm run build` fails inside `.next/dev/types/…`, delete `frontend/.next` (a dev server killed mid-write leaves a broken file) and rebuild.

## 12. Seed commands

```bash
cd backend-go && go run ./cmd/seed            # demo organization absent → load it; present → only ensure demo users + memberships
go run ./cmd/seed -force                      # DELETES the demo organization (cascade: stores, products, sales, history,
                                              # recommendations, alerts, conversations) and reloads it — never run it just to test
cd backend && python scripts/generate_synthetic_data.py [--end YYYY-MM-DD]   # regenerate data/*, then retrain + seed -force
```

Dataset: 160 products (80 per store) × 395 days, 8 categories (fruits, vegetables, dairy, beverages, snacks, staples,
household, personal care), 1 Sep 2025 – 30 Sep 2026: 62,876 sales, 7,784 price changes, 63,200 daily snapshots, 10
suppliers, 3 demo considerations per store. **Synthetic** — suppliers are fictitious; no barcodes or competitor
prices are seeded.

Demo users: with `AUTH_PROVIDER=supabase` they are created through the Auth Admin API (`SUPABASE_SERVICE_ROLE_KEY`);
with `AUTH_PROVIDER=local` `insertAuthUser` writes them into `auth.users` — on Supabase in GoTrue's own row shape plus
an e-mail identity, so the same accounts can sign in through Supabase Auth later. Existing e-mails are reused (no
duplicates); every auth user gets a profile (trigger `app.handle_new_user`) and a membership.

## 13. Current model information

`demand_xgb:v2` is the only model served: XGBoost, Poisson objective, monotone decreasing price effect, lag /
calendar / festival / expiry features, no product id. Validation is time-based (last 30 days held out).
**Holdout performance on the synthetic dataset: MAE ≈ 5.65 units/day, R² ≈ 0.73, versus MAE ≈ 5.93 for the naive
28-day-mean baseline.** Report it in exactly these terms (MAE, R², holdout, baseline). R² is not an "accuracy
percentage" — never write "73% accurate". These figures describe how well the model learned a simulation, not real
demand. Pricing policy: `thompson_sampling_v2` (default); `contextual_ts_v1` runs in shadow mode.

### 13b. AI copilot

```text
Browser → Go API (stores the message, forwards the user's token) → Python AI service → OpenRouter → configurable LLM
```

- **Provider abstraction:** `agents/llm.py` — one `OpenAICompatibleProvider` + a `PROVIDERS` table (`openrouter`, endpoint `https://openrouter.ai/api/v1/chat/completions`; optional `HTTP-Referer` / `X-Title` headers from `OPENROUTER_SITE_URL` / `OPENROUTER_APP_NAME`). `resolve()` returns the provider or the reason LLM mode is off. Add a provider by adding a row and two settings; do not add an agent framework.
- **Configuration:** `AI_PROVIDER` (`openrouter` | `none`), `OPENROUTER_API_KEY`, `AI_MODEL` (no model id in code; `.env.example` uses `openrouter/free`, a router that picks an available free model supporting tool calling — any OpenRouter model id works without a code change).
- **Loop:** `agents/copilot.py` — system prompt + RAG passages + question → model → tool calls run concurrently through `tools.py` (Go API as the user) → at most 5 rounds.
- **Tool / data boundary:** the OpenRouter LLM is not the source of truth for PriceIQ business data; PriceIQ tools and database records are. The model sees only the system prompt, conversation, RAG passages and the tool results it requested. The LLM only phrases and selects tools. PriceIQ tools are the source of truth for every business number. An answer containing prices with no successful data lookup is discarded. `data_sources` is derived from the tools that ran; `reasoning_factors` are the model's short "Key factors" bullets (no chain-of-thought is exposed).
- **Fallback:** missing key / model, timeout, network failure, bad key (401), 402, 429, 5xx, an error inside a 200, a malformed body or any loop failure → `fallback.py` answers from the same tools; the reply carries `mode: "rule_based"` and a warning with the reason. Never label a rule-based answer as LLM output.
- **Limits:** `AI_TIMEOUT_S` (30 s per LLM request), `AI_BUDGET_S` (40 s for the whole answer incl. tool rounds — must stay below the Go API's `AI_TIMEOUT`), `AI_MAX_TOKENS` (2048), no automatic retries, cooldown after a 429 (provider's `retry-after`, max 5 min; OpenRouter free models: ~20 requests/min and 50/day, 1,000/day after $10 of credits — each question uses ≥ 2 requests), 60 s answer cache per user + store + question + history, tool results truncated to 5,000 characters, Go rate-limits the route.
- **Security:** the key is read only in `llm.py`; error messages never include the key, headers or response body. Tool output is wrapped as untrusted data and the system prompt forbids following instructions inside it.
- **Tests:** `tests/test_copilot_llm.py` mocks the provider with `httpx.MockTransport` (configuration, missing key, bad key, timeout, 429, success, fallback, tool data, injection framing, key never in logs / replies). No automated test calls OpenRouter. Verified live on 2 Oct 2026: real answers for all six reference questions, a real 401 and a real 429 falling back, and a product whose name contained an instruction being answered with its true price.

## 14. Competitor-data honesty rules

| Label | Meaning |
|---|---|
| **LIVE** | Read from the platform by PriceIQ ≤ 6 h ago **for the store's delivery location** |
| **MANUAL_VERIFIED** | Recorded by staff ≤ 24 h ago |
| **CACHED** | Older real observation, or a cached search result (30 min) |
| **UNAVAILABLE** | Could not be read; no price is shown; the reason is reported |
| **ESTIMATED** | Exists in the vocabulary only; PriceIQ never produces it for competitor prices |

Never generate, interpolate, default or estimate a competitor price. Market statistics use observed prices only.
Adapters are isolated (`_safe`): one platform failing only marks that platform UNAVAILABLE. A Blinkit response is
rejected unless Blinkit confirms it served the store's location (it otherwise answers for another city). Only listings
a user linked to a product are tracked. Status as of 2 Oct 2026: Blinkit readable; Zepto and Swiggy Instamart return an
AWS WAF bot challenge; BigBasket denies browsers / renders prices client-side → UNAVAILABLE + manual entry. Labels are
derived in `backend-go/services/competitors.go` (`displayStatus`) and `backend/app/services/data.py` (`market`).

## 15. Seasonal / perishable functionality

- `seasonal_events`: festival / season calendar (global + org custom) → model event features and measured historical effects (Welch t-test; `NOT_SIGNIFICANT` with one year of data).
- `seasonal_considerations`: staff planning assumptions — kind (SEASON | FESTIVAL | EVENT | WEATHER), scope (product / category / store), dates, expected demand change %, supply condition, sensitivity. `services/considerations.py` turns active ones into per-day demand multipliers (scaled by the product's sensitivity, clipped to 0.1–4) used by recommend, simulate, forecast and expiry optimization. **SHORTAGE blocks discounts.** Always labelled a MANUAL assumption, never a measured effect, and never able to move a price outside the constraint band.
- Perishables: pack size, shelf life, expiry date, seasonal / festival / weather sensitivity; wastage risk % in inventory, expiry optimization and pricing explanations. Inside the expiry window the margin floor relaxes to break-even and increases are blocked.

## 16. Security rules

- Two enforcement layers: Go middleware RBAC, then PostgreSQL RLS (`database.WithUser`). Background jobs use `WithSystem`.
- AI service: `X-Internal-Token` compared in constant time; binds to loopback; must not be exposed publicly.
- Production config rejects short / placeholder `AI_SERVICE_TOKEN`, wildcard CORS and local auth.
- `/health` returns dependency status only (no driver error text). Uploads: body cap, row cap, XLSX unzip limits. CSV exports neutralise formula prefixes.
- Supabase: the database password and `SUPABASE_SERVICE_ROLE_KEY` stay in backend `.env` files; `anon` has no table privileges; RLS is on for every table.
- Secrets live only in git-ignored `.env` files. Never put keys in frontend code, docs, logs or API responses.
- Copilot: no SQL, no price-changing tool, tool output is data, not instructions.

## 17. Known limitations

- **Supabase Auth is not verified end to end.** The Go verifier (JWKS) and the frontend adapter exist, and the demo users are in `auth.users` in GoTrue's shape, but no publishable or service-role key was available, so no real Supabase sign-in has been tested. Validation ran with `AUTH_PROVIDER=local` on the Supabase database.
- **`*.supabase.co` does not resolve on the development network** (DNS returns a block address). The database works through `*.pooler.supabase.com`; Supabase Auth (browser and Go JWKS fetch) needs the project URL to resolve — use another DNS resolver / DNS-over-HTTPS or a VPN.
- **Latency:** the project is in Tokyo; from India one database round trip is ≈ 0.25 s. API calls take 1–3 s, a cold forecast overview ≈ 25 s, the nightly ML refresh several minutes (`AI_TIMEOUT=180s`). A nearer region would remove most of it.
- **Copilot on `openrouter/free`:** the answering model varies per request; some answers exceed the 40 s budget and fall back to rule-based; the free quota (~50 requests/day) lasts roughly 20 questions.
- `LocalRegister` (local auth sign-up) writes a minimal `auth.users` row; on Supabase such an account works for local auth but is not a complete GoTrue user. Use Supabase Auth sign-up for real accounts.
- Three of four competitor platforms cannot be read automatically; Blinkit's response shape and cookies can change.
- The synthetic dataset is static (ends 2026-09-30); expiry dates are anchored to the seed day.
- Weather is planning context only (no historical weather linked to sales); use a WEATHER consideration.
- One year of history ⇒ each festival occurs once ⇒ no significant festival effects.
- Local auth stores the dev token in `localStorage`; no e-mail verification — development only.
- In-memory cache / locks / LLM cooldown are per process; use Redis for more than one API instance.
- Model artifacts are pickles: `MODELS_DIR` must not be writable by untrusted users.
- Not exercised: Redis, SMTP. No Docker / CI / deployment configuration.

## 18. Current technical decisions

- **Go is the primary API; Python does ML/AI only.** One audited place for auth, tenancy and business rules.
- **Constraint engine in Go, applied twice.** Models explore; MRP (legal), margin and change limits must be deterministic and re-checked at apply time.
- **Triggers write audit / price history / stock movements.** No code path changes a price without a trace.
- **Competitor failures are isolated and visible** rather than papered over with a guessed number.
- **Considerations are explicit multipliers, not hidden model inputs.** Human assumptions stay auditable.
- **Supabase through the transaction pooler.** Works on IPv4-only networks and where `*.supabase.co` is not resolvable; many short-lived clients are fine. Cost: no session state and no named prepared statements (see §7).
- **Round trips are the budget on a hosted database.** AI-service reads run in AUTOCOMMIT without a pre-ping (`app/db.py`); store-wide jobs wrap the per-product code path in `data.batch()` so lookups become one store-level query (`services/data.py`); the Go per-request role + claims setup is a single statement (`database.WithUser`).
- **LLM behind a thin OpenAI-compatible HTTP client (httpx), no SDK or framework.** Provider and model are configuration; no paid API is required; the rule-based assistant is the guaranteed path.

## 19. Files that should NOT be reintroduced

Removed on 2 Oct 2026 as unreferenced (a copy is in `D:/PriceIQ_cleanup_backup_2026-10-02`, outside the repo):

- `backend/legacy/`, `frontend/_legacy_v4/` — pre-v5 FastAPI monolith and pages (its `competitor_service.py` generated random prices).
- `backend/ml/`, `backend/pricing.db` — v1 trainer, bandit state file, SQLite database.
- `models/demand_model_xgb.pkl`, `models/category_encoder.pkl` — retired v1 model (product-id feature, 2023 data).
- `data/dynamic_pricing_data.csv`, `data/product_catalog.json` — 2023 dataset.
- `frontend/public/*.svg` (create-next-app defaults), a repo-root `.venv`, `backend-go/*.exe`, `backend-go/.*.log`.
- The `anthropic` SDK dependency and `ANTHROPIC_API_KEY` / `COPILOT_MODEL` settings; the Groq provider and `GROQ_API_KEY` / `GROQ_BASE_URL` (replaced by OpenRouter).

## 20. Do not break these

1. The browser talks only to the Go API. Never expose the AI service, `AI_SERVICE_TOKEN`, `OPENROUTER_API_KEY` or the service-role key to the frontend.
2. User-initiated SQL runs in `database.WithUser`. Do not move it to `WithSystem` to "fix" a permission error.
3. Every new table needs RLS + policies + grants in a **new** migration; store-scoped rows carry `store_id`.
4. Every recommended price passes `PriceBounds` → `Enforce` and `ValidatePrice` at apply time. Price ≤ MRP always.
5. Never generate, interpolate or default a competitor price. Failure ⇒ UNAVAILABLE. No anti-bot evasion (stealth plugins, CAPTCHA / WAF solving, proxy rotation).
6. Keep the status vocabulary and TTLs identical in Go (`competitors.go`), Python (`data.py`) and the frontend (`DataStatus`, `kit.tsx`).
7. Keep synthetic labels (`data_mode`, `is_synthetic`, `source='SYNTHETIC'`, UI banner, `data_provenance`).
8. Training and inference build features through the same functions in `ml/features.py`; no lag leakage; validation stays time-based. Report MAE / R² against the baseline, never an invented accuracy %.
9. Do not edit applied migrations. Never apply `supabase/local/00_auth_shim.sql` on Supabase.
10. `audit_logs`, `pricing_history`, `inventory_movements` are trigger-maintained and append-only for users.
11. The copilot has no SQL and no price-changing tool; tool output is data; LLM output is never the source of a business number; a missing or failing LLM must not break anything else.
12. When behaviour changes, update `backend/app/rag/docs/*.md`, this file and `README.md`.

## 21. Project status — October 2026

Verified on 2 Oct 2026 against the real system (Supabase PostgreSQL, Go API, Python AI service, Next.js, OpenRouter):

- **Database:** 9 / 9 migrations applied to Supabase, RLS on all 32 tables; seeded and confirmed by direct queries (160 products, 8 categories, 10 suppliers, 62,876 sales 2025-09-01 → 2026-09-30, 4 demo users each with profile + membership).
- **Tests:** `gofmt` / `go vet` clean, `go test ./...` pass; `pytest` 56 passed (integration tests against Supabase); frontend build (21 routes) passes, ESLint 0 errors / 1 warning.
- **End to end through the Go API:** 57 / 57 checks — four roles, 401 for missing / garbage / tampered tokens, cross-store 404, role restrictions, dashboard, products, inventory, forecast, recommendation inside the band, MRP rejection, approve + apply, simulator, considerations incl. shortage, expiry optimization, competitor search (Blinkit LIVE, three platforms UNAVAILABLE), manual → MANUAL_VERIFIED, alerts, reports, audit log, copilot.
- **OpenRouter:** real requests succeeded (`openrouter/free`); all six reference questions were answered in LLM mode with data from the expected tools; real 401, unknown-model and 429 responses fell back to rule-based answers; a prompt-injection product name was not obeyed.
- **Browser (headless Chromium):** login, 16 pages, session persistence, logout, viewer role visibility, copilot header in both modes — no console errors, no failed API calls, browser talks only to the Go API.
- **Model:** `demand_xgb:v2` retrained and registered on Supabase with unchanged holdout figures (MAE 5.65 vs 5.93 naive, R² 0.73, synthetic data).
- **Not verified:** Supabase Auth sign-in (keys missing, project URL not resolvable on this network), Redis, SMTP.

Released as version 6.0 on branch `version-6.0` (tag `v6.0`).
