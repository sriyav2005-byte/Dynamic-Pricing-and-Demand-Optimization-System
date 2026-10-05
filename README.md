# PriceIQ — AI-Powered Dynamic Pricing & Retail Intelligence

**Version 6.0** · October 2026 · Next.js · Go/Gin · Python/FastAPI · Supabase PostgreSQL · OpenRouter

PriceIQ is a decision-support platform for FMCG and quick-commerce retail stores. It forecasts demand, recommends
prices that are **always inside the store's business rules**, explains every recommendation, optimizes inventory
and expiry markdowns, tracks competitor prices honestly, and answers questions through a tool-using AI copilot.

> **For LLM assistants and new contributors:** read [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md) first — it is the
> project's condensed memory (architecture, workflows, invariants, known limitations).

---

## Contents

[What's new in 6.0](#whats-new-in-60) · [Problem](#problem-statement) · [Features](#features) · [Tech stack](#tech-stack) ·
[Architecture](#architecture) · [Project structure](#project-structure) · [Database](#database) · [Roles](#roles-and-permissions) ·
[API](#api-overview) · [Data flow](#data-flow) · [Pricing workflow](#dynamic-pricing-workflow) · [ML approach](#ml-approach) ·
[Competitor intelligence](#competitor-intelligence) · [Seasonal pricing](#seasonal-pricing) · [Perishables](#fresh-produce--perishables) ·
[AI copilot](#ai-copilot) · [Setup](#setup) · [Environment variables](#environment-variables) · [Testing](#testing) ·
[Troubleshooting](#troubleshooting) · [Security](#security-model) · [Data honesty](#data-honesty) · [Verified status](#verified-status-october-2026) ·
[Limitations](#limitations) · [Future scope](#future-scope)

---

## What's new in 6.0

| Area | Change since 4.0 |
|---|---|
| **Architecture** | The FastAPI monolith is split: **Go/Gin** is the only browser-facing API (auth, RBAC, business rules, constraint engine); **Python/FastAPI** is an internal AI/ML service. |
| **Database** | **Supabase PostgreSQL** with versioned migrations, Row Level Security on every table and trigger-written audit / price history / stock movements. Embedded PostgreSQL kept as a local fallback. |
| **Data** | New synthetic dataset for 2025-09-01 → 2026-09-30: 160 products in 8 categories with shelf life, pack sizes and seasonal / festival / weather sensitivities. |
| **Demand model** | `demand_xgb:v2` (XGBoost, Poisson, monotone price effect, time-based holdout). The 2023 v1 model is retired. |
| **Pricing** | Constraint engine applied at generation and at application, approval workflow, what-if simulator, expiry markdown optimization. |
| **Seasonal & perishables** | Staff-entered seasonal considerations feed forecasts and prices; a supply shortage blocks discounts; wastage risk everywhere stock can expire. |
| **Competitors** | Location-aware Blinkit reads, honest UNAVAILABLE for blocked platforms, manual verified entry. No estimated prices. |
| **AI copilot** | OpenRouter (`openrouter/free` by default) behind a thin HTTP client, PriceIQ tools as the only source of numbers, grounding check, prompt-injection framing, rule-based fallback. No Anthropic or other paid key needed. |
| **Performance** | Fewer database round trips for hosted databases (autocommit reads, batched store-wide jobs, single-statement RLS setup). |
| **Cleanup** | Legacy v3/v4 code, the SQLite database, the 2023 dataset and the v1 model artifacts removed. |

## Problem statement

A neighbourhood or quick-commerce store carries hundreds of products whose right price changes with demand, stock,
shelf life, season, festivals and competitors. Pricing by hand leaves money on the table (stock-outs of fast movers,
write-offs of perishables, margins lost to blanket discounts); fully automatic repricing is risky — it can break MRP
law, destroy margin or confuse customers.

PriceIQ sits in between: **models propose, rules bound, people approve.** Every recommendation is explainable,
auditable, and constrained by rules the store controls.

## Features

| Area | What it does |
|---|---|
| **Dashboard & analytics** | Revenue, profit, margin, units, inventory value, at-risk products, competitor gap, category/product performance, trends |
| **Products** | CRUD, search/filter/sort, CSV & Excel import with dry run and per-row errors, perishable and sensitivity attributes |
| **Inventory intelligence** | Sales velocity, days of cover, predicted stock-out, safety stock, reorder point/quantity, expiry and **wastage risk** |
| **Dynamic pricing** | Demand-model evaluation of candidate prices, Thompson Sampling inside the allowed band, SHAP explanation, expected impact |
| **Constraint engine** | MRP ceiling, minimum margin, max change per update, expiry rules, rounding, frozen categories — enforced at generation *and* application |
| **Approval workflow** | Manual / semi-automatic / automatic modes, approve · reject · apply, stale-recommendation protection |
| **What-if simulator** | Demand, revenue, profit, waste and risk at any price; demand and price scenarios |
| **Forecasting** | 7 / 14 / 30-day forecasts with 80% intervals and out-of-sample accuracy |
| **Competitor intelligence** | Location-aware live search, linked listings, manual verified entry, price history, market position — never estimated |
| **Seasonal intelligence** | Festival calendar, measured historical effects, staff-entered **seasonal considerations** that feed pricing |
| **Expiry optimization** | Markdown levels compared by profit net of waste for stock close to expiry |
| **AI copilot** | Configurable LLM through OpenRouter with controlled tools + RAG over policy documents; rule-based fallback without an API key or when the provider is unavailable |
| **Alerts & notifications** | Low stock, predicted stock-out, expiry, competitor undercut, demand spike/drop, anomalies, pricing opportunities |
| **Reports & audit** | CSV exports; append-only audit log, price history and stock movements written by database triggers |
| **Security** | Multi-tenant (organization → stores), 5-level RBAC, PostgreSQL Row Level Security on every table |

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, Recharts, Supabase JS (auth) |
| API | Go 1.26, Gin, pgx v5, golang-jwt + JWKS (keyfunc), go-redis (optional), bcrypt |
| AI / ML service | Python 3.11+, FastAPI, SQLAlchemy + psycopg2, pandas, XGBoost, statsmodels, scikit-learn (TreeSHAP explanations via XGBoost), Playwright, httpx |
| Database | Supabase PostgreSQL 17 (embedded PostgreSQL 16 for the local fallback and the Go tests) |
| LLM | OpenRouter, OpenAI-compatible chat completions; model configurable (`AI_MODEL`) |
| Tests | `go test` (embedded PostgreSQL + fake AI service), pytest (mocked LLM; integration tests against the configured database), Next.js build + ESLint |

## Architecture

```mermaid
flowchart LR
    U[Browser<br/>Next.js 16 · React 19] -- "Bearer token" --> G

    subgraph G[Go API · Gin — backend-go/]
        direction TB
        A[Auth · rate limit · store RBAC] --> S[Services<br/>products · inventory · sales · analytics]
        S --> C[Pricing constraint engine]
        W[Background workers]
    end

    G -- "pgx — as the end user (RLS)" --> DB[(Supabase PostgreSQL<br/>RLS · triggers · audit)]
    G -- "X-Internal-Token" --> P

    subgraph P[Python AI service · FastAPI — backend/]
        direction TB
        M[XGBoost demand model<br/>forecasting · elasticity · SHAP]
        B[Thompson Sampling<br/>contextual bandit]
        SC[Competitor fetchers<br/>Playwright]
        CP[Copilot · RAG]
    end

    P -- "service role, authorized ids only" --> DB
    CP -- "tools call the API with the user's token" --> G
    CP -. optional .-> L[OpenRouter · configurable LLM]
    SC -. "read-only, no bypass" .-> X[Blinkit · Zepto · Instamart · BigBasket]
    G <--> R[(Redis or in-memory cache)]
```

| Layer | Responsibility |
|---|---|
| **frontend** — Next.js 16, React 19, Tailwind 4, Recharts | 19 pages. Talks only to the Go API; holds no secret (at most the Supabase publishable key). |
| **backend-go** — Go 1.26, Gin, pgx, go-redis | The only browser-facing backend: authentication, store-scoped RBAC, request-level RLS, business logic, pricing workflow and constraint engine, caching, rate limiting, background jobs. |
| **backend** — Python, FastAPI | Internal AI/ML service: demand model, forecasting, pricing policies, elasticity, explanations, simulation, expiry optimization, anomalies, seasonal statistics, weather, competitor fetchers, RAG, copilot. |
| **supabase/** | SQL migrations (schema, RLS, triggers, reference data) + an auth shim for plain PostgreSQL. |

### Trust boundaries

```text
Browser ──Bearer token──▶ Go API :8080 ──pgx (as the end user, RLS)──▶ Supabase PostgreSQL
                              │
                              └─X-Internal-Token─▶ Python AI service :8000 (loopback) ──▶ OpenRouter
                                                         │                                (OPENROUTER_API_KEY)
                                                         └─service role, authorized ids only──▶ Supabase PostgreSQL
```

The browser never reaches the AI service, OpenRouter or the database directly. `AI_SERVICE_TOKEN`,
`OPENROUTER_API_KEY`, the database password and `SUPABASE_SERVICE_ROLE_KEY` live only in the backend `.env` files.

**Why this split?** Go is a single, auditable trust boundary for auth, tenancy and business rules and handles
concurrent I/O cheaply; Python is where the ML ecosystem lives. The AI service never takes tenant decisions — it only
acts on store/product ids the Go API has already authorized.

## Project structure

```text
frontend/      src/app/<route>/page.tsx · src/components · src/lib/{api.ts, auth.ts}
backend-go/    cmd/{server,migrate,seed,devdb} · config · database · middleware · routes · controllers
               services (business logic, constraints.go) · repositories (SQL) · clients (AI, cache) · workers
backend/       app/{api,schemas,services,ml,agents,rag,utils} · scripts/generate_synthetic_data.py · tests/
supabase/      migrations/*.sql · local/00_auth_shim.sql (plain PostgreSQL only)
data/          priceiq_catalog.json · priceiq_synthetic_daily.csv        (SYNTHETIC)
models/        trained artifacts (git-ignored; created by training)
PROJECT_CONTEXT.md   persistent project context for developers and LLM assistants
```

## Database

Schema, policies and triggers live in `supabase/migrations/` (9 files, applied in order and recorded in
`public.schema_migrations`). 32 tables, Row Level Security on all of them.

```mermaid
erDiagram
    organizations ||--o{ stores : has
    organizations ||--o{ memberships : grants
    profiles ||--o{ memberships : holds
    stores ||--|| store_settings : configures
    stores ||--o{ products : sells
    categories ||--o{ products : groups
    suppliers ||--o{ products : supplies
    products ||--o{ sales : records
    products ||--o{ pricing_history : "price changes (trigger)"
    products ||--o{ inventory_movements : "stock changes (trigger)"
    products ||--o{ product_daily_snapshots : "feature store"
    products ||--o{ pricing_recommendations : receives
    model_versions ||--o{ pricing_recommendations : produced
    products ||--o{ competitor_products : "linked listings"
    competitor_products ||--|| competitor_prices : latest
    competitor_products ||--o{ competitor_price_history : history
    stores ||--o{ seasonal_considerations : plans
    stores ||--o{ alerts : raises
    profiles ||--o{ ai_conversations : chats
    ai_conversations ||--o{ ai_messages : contains
```

Other tables: `seasonal_events` (festival calendar), `price_elasticities`, `product_relationships`, `bandit_states`,
`notifications`, `audit_logs` (append-only), `knowledge_documents` / `knowledge_chunks` (copilot RAG).
`days_to_expiry` and wastage risk are derived, never stored. `stores.data_mode` (`LIVE` | `SYNTHETIC`) and
`products.is_synthetic` keep simulated data labelled.

## Roles and permissions

Roles are granted per store or organization-wide in `memberships`; the highest applicable role wins.

| Action | Viewer | Analyst | Store manager | Admin |
|---|:-:|:-:|:-:|:-:|
| View dashboards, products, inventory, forecasts, competitors, seasonal data | ✓ | ✓ | ✓ | ✓ |
| Generate recommendations, run simulations, export reports, scan / update alerts | | ✓ | ✓ | ✓ |
| Change products, prices, stock; record sales; approve / reject / apply recommendations | | | ✓ | ✓ |
| Seasonal considerations and events, competitor links and manual prices, audit log | | | ✓ | ✓ |
| Store settings (pricing mode, margins, limits), store edits, members | | | | ✓ |

Every route's minimum role is declared in `backend-go/routes/routes.go`; PostgreSQL RLS enforces the same tenant
rules a second time. A store the caller has no role on answers **404**, not 403.

## API overview

All routes are under `/api/v1` and need `Authorization: Bearer <token>` except health and auth.

| Group | Endpoints |
|---|---|
| Auth & account | `POST /auth/local/login`, `POST /auth/local/register` (local mode), `GET /auth/config`, `GET·PATCH /me`, `GET /notifications` |
| Organization | `/organizations/:id/members`, `POST …/stores`, `GET …/analytics` |
| Store | `GET·PATCH /stores/:store_id`, `GET·PUT …/settings` |
| Products | `GET·POST …/products`, `GET·PATCH·DELETE …/products/:id`, `POST …/products/import` (+ `/template`), `GET …/categories`, `GET·POST …/suppliers` |
| Inventory & sales | `GET …/inventory`, `…/inventory/movements`, `…/inventory/expiry-optimization`, `…/products/:id/inventory`, `POST …/products/:id/stock-adjustments`, `GET·POST …/sales` |
| Analytics & reports | `GET …/analytics/{summary,trends,categories,products}`, `GET …/reports/{sales,pricing,inventory,recommendations}` (CSV) |
| Pricing | `POST …/pricing/recommendations` (+ `/batch`), `GET …/pricing/recommendations[/:id]`, `POST …/:id/{approve,reject,apply}`, `POST …/pricing/simulate`, `GET …/products/:id/{price-history,elasticity,cross-effects}` |
| Forecasting | `GET …/forecast`, `GET …/products/:id/forecast?horizon=7\|14\|30` |
| Competitors | `GET …/competitors`, `GET …/competitors/search`, `GET …/products/:id/competitors[/history]`, `POST …/competitors/{refresh,observations,link}`, `DELETE …/competitors/:key` |
| Seasonal | `GET·POST …/seasonal/events`, `GET …/seasonal/insights`, `GET·POST …/seasonal/considerations`, `PUT·DELETE …/seasonal/considerations/:id`, `GET …/weather` |
| Alerts & audit | `GET …/alerts`, `PATCH …/alerts/:id`, `POST …/alerts/scan`, `GET …/anomalies`, `GET …/audit-logs` |
| Copilot | `POST …/copilot/chat`, `GET …/copilot/conversations[/:id]` |
| System | `GET /health` (no secrets or driver errors), `GET /api/v1/models` (model registry + copilot mode) |

The Python service exposes `/v1/*` routes (pricing, forecasting, elasticity, anomalies, seasonal, competitors,
copilot, models) to the Go API only; each requires `X-Internal-Token`.

## Data flow

```mermaid
sequenceDiagram
    autonumber
    participant F as Frontend
    participant G as Go API
    participant D as Supabase PostgreSQL
    participant P as Python AI service
    F->>G: Request + bearer token
    G->>G: Verify token, rate limit, resolve role on the store
    G->>D: Queries as the end user (RLS enforced)
    G->>P: Authorized ids + price band (internal token)
    P->>D: Read history for those ids
    P->>P: ML inference / LLM
    P-->>G: Result + explanation
    G->>G: Constraint engine (clamp, validate)
    G->>D: Store result (triggers write audit / history)
    G-->>F: Response with provenance labels
```

## Dynamic pricing workflow

```mermaid
flowchart TD
    A[Analyst requests a recommendation] --> B[Go: load product + store settings]
    B --> C[Go: PriceBounds → allowed band lo..hi]
    C --> D[AI: evaluate candidate prices<br/>demand model × seasonal considerations<br/>stock, expiry and waste aware]
    D --> E[AI: Thompson Sampling picks a price inside the band]
    E --> F[AI: explanation — factors, SHAP, impact, provenance]
    F --> G[Go: Enforce — clamp into band, record binding rules]
    G --> H{Pricing mode}
    H -- Manual --> I[Pending]
    H -- Semi-automatic --> J[Pending — approval required]
    H -- Automatic --> K{Small, confident,<br/>conflict-free?}
    K -- yes --> M
    K -- no --> J
    I --> L[Manager approves / rejects]
    J --> L
    L -- approve + apply --> M[Go: re-validate against the current band<br/>refuse if the price changed since]
    M --> N[Price updated → price history + audit log via triggers]
    N --> O[Sales recorded → bandit learns from realized profit]
```

**Constraint order:** frozen category → floors (minimum margin incl. category overrides, maximum decrease per update,
business minimum; relaxed to break-even with a larger markdown limit inside the expiry window) → ceilings (maximum
increase per update, MRP, business maximum; no increases on expiring stock) → conflict resolution
(MRP > margin > change limit) → rounding. Margin convention: `(price − cost) / price`.

## ML approach

| Component | Method |
|---|---|
| **Demand model** `demand_xgb:v2` | XGBoost (Poisson objective) with **monotone decreasing price constraints**; features: price level and relatives, 7/28-day lagged demand, calendar, days to expiry, season factor, festival flag / distance. No product id ⇒ serves new products. |
| **Validation** | Time-based only: last 30 days held out, hyper-parameters chosen on the 30 days before. Compared with a naive 28-day mean and a product-id XGBoost baseline. |
| **Forecast intervals** | 80% intervals from relative residuals of a rolling-origin backtest, by lead time. |
| **Price optimization** | Each candidate price is simulated over the planning horizon: sales capped by stock, zero after expiry, unsold units at expiry counted as a loss. |
| **Pricing policy** | `thompson_sampling_v2` (default): 10 Beta arms with a demand-model prior, updated only by realized daily profit. `contextual_ts_v1`: linear Thompson Sampling, evaluated in shadow mode. |
| **Elasticity** | Poisson GLM (log-log) with HC1 errors; reported only when significant, otherwise `INSUFFICIENT_DATA` / `NOT_SIGNIFICANT`. Cross-price effects kept only after Benjamini–Hochberg FDR control. |
| **Explanations** | Exact TreeSHAP contributions + rule-based factors (forecast, competitors, inventory, expiry/wastage, elasticity, season, considerations). |
| **Anomalies / seasonal effects** | Robust statistics on sales, prices, stock and competitor data; festival and season effects by Welch t-test against the preceding 28 days. |

Holdout performance on the **synthetic** dataset (1–30 Sep 2026, 160 products): MAE 5.6 units/day, R² 0.73, versus
MAE 5.9 for the naive 28-day mean. The data is simulated with over-dispersed noise, so these figures describe the
simulation, not a real store.

## Competitor intelligence

| Platform | Status (verified 2 Oct 2026) | How |
|---|---|---|
| **Blinkit** | **LIVE** | Ordinary headless Chromium loads the search page for the **store's delivery location** and reads the page's own JSON. One retry on timeouts; results rejected if the platform served another location. |
| **Zepto** | **UNAVAILABLE** | Responds with an AWS WAF bot challenge. |
| **Swiggy Instamart** | **UNAVAILABLE** | Responds with an AWS WAF bot challenge. |
| **BigBasket** | **UNAVAILABLE** | Akamai denies automated access. |

* PriceIQ does **not** bypass bot protection (no stealth, CAPTCHA/WAF solving or proxies). Blocked platforms show
  UNAVAILABLE with the reason and a deep link; staff record what they see → **MANUAL_VERIFIED** (24 h), then CACHED.
* Platforms are isolated: one failure never breaks search, refresh or the Competitors page.
* Only listings a user explicitly links to a product are tracked — no automatic matching (pack sizes differ).
* Market statistics use observed prices only. **No price is ever estimated or fabricated.**

## Seasonal pricing

1. **Calendar** — national and regional festivals 2023–2027 (Diwali, Holi, Eid, Christmas, New Year, Pongal, Onam,
   Navratri, Dussehra, Raksha Bandhan, Ganesh Chaturthi…) and IMD seasons; stores can add local events. Lunar dates in
   the future are flagged *approximate*.
2. **Measured effects** — uplift of each festival/season in the store's own history, with significance.
3. **Seasonal considerations** *(Seasonal page, store manager and above)* — planning assumptions: season / festival /
   event / weather, scope (product, category or whole store), dates, expected demand change, supply condition,
   sensitivity levels and notes. Active considerations multiply the demand forecast used for recommendations,
   simulations, forecasts and expiry markdowns, scaled by each product's sensitivity; a supply **shortage** blocks
   discount recommendations. They are always reported as a MANUAL assumption and can never push a price outside the
   constraint band.

## Fresh produce & perishables

Products carry `is_perishable`, `expiry_date`, `shelf_life_days` and seasonal / festival / weather sensitivities;
`days_to_expiry` and **wastage risk** (share of stock not expected to sell before expiry) are derived. Pricing for
perishables weighs demand, stock velocity, shelf life, expected waste, season, festivals, considerations and observed
competitor prices — and still passes the constraint engine (inside the expiry window the margin floor relaxes to
break-even and price increases are blocked).

## AI copilot

```mermaid
flowchart LR
    Q[User question] --> G[Go API<br/>stores message, forwards the user's token]
    G --> C[Copilot]
    C --> R[RAG: policy documents]
    C --> T[Tools → Go API as the user<br/>products · inventory · sales · forecast · competitors<br/>recommendations · simulation · expiry · alerts]
    T --> C
    C -. messages + tool schemas .-> L[OpenRouter<br/>configurable LLM]
    L -. tool calls / text .-> C
    C --> ANS[Answer with tool trace, data sources and mode]
```

The copilot can only see what the user may see (RBAC + RLS), has no SQL access, and its only write action creates a
*recommendation* — never a price change. Tool results and documents are treated as data, not instructions.

**The LLM is an interface layer, not a source of truth.** Every business number comes from a PriceIQ tool; an answer
that contains prices without a data lookup behind it is discarded. `data_sources` in a reply is built from the tools
that actually ran.

> The OpenRouter LLM is not the source of truth for PriceIQ business data. PriceIQ tools and database records are the
> source of truth.

**Provider.** `Browser → Go API → Python AI service → OpenRouter → configurable LLM`. `backend/app/agents/llm.py` is a
thin HTTP client for OpenRouter's OpenAI-compatible endpoint (`https://openrouter.ai/api/v1/chat/completions`); no SDK
or agent framework. The model only receives the system prompt, the conversation, retrieved policy passages and the
results of the tools it calls — nothing else. No paid API is required, and PriceIQ works without any LLM.

| Variable (`backend/.env`) | Meaning |
|---|---|
| `AI_PROVIDER` | `openrouter` (default) or `none` to never call an external LLM |
| `OPENROUTER_API_KEY` | Create one at <https://openrouter.ai/keys>. Lives only in `backend/.env`; never sent to the browser, logged or returned |
| `AI_MODEL` | `openrouter/free` lets OpenRouter pick an available free model that supports tool calling; or any model id from <https://openrouter.ai/models>. No model id is hard-coded in the application |
| `OPENROUTER_SITE_URL`, `OPENROUTER_APP_NAME` | Optional attribution headers (`HTTP-Referer`, `X-Title`). Public values only |
| `AI_TIMEOUT_S`, `AI_MAX_TOKENS`, `AI_BUDGET_S` | Optional: one LLM request (30 s), answer length (2048), whole answer including tool rounds (40 s) |

**Fallback.** If the key or model is missing, or OpenRouter times out, cannot be reached, rejects the key, returns an
HTTP error, a rate limit (429), an error inside a 200 response or a malformed body, the deterministic rule-based
assistant answers from the same tools and the reply says so (`mode: "rule_based"` plus a warning with the reason; the
chat header shows *Rule-based fallback*). In LLM mode the header shows *LLM · openrouter · AI_MODEL*.

**Rate limits and time budget.** A whole LLM answer (all tool rounds) must finish within `AI_BUDGET_S` (40 s); past it the rule-based assistant answers. No automatic retries. After a 429 OpenRouter is left alone for the period it asked for (at most
5 minutes). An identical question from the same user within 60 seconds reuses the previous LLM answer. OpenRouter's
free models allow about 20 requests per minute and 50 per day (1,000 per day once the account has bought $10 of
credits); one copilot question uses at least two requests, so a free key covers roughly 25 questions a day before the
copilot falls back.

**Testing.** `backend/tests/test_copilot_llm.py` mocks the HTTP call (success, missing key, 401, 402, 429, 500,
timeout, network error, malformed responses, grounding, prompt-injection framing, key never in logs or replies).
No automated test calls OpenRouter.

## Setup

Prerequisites: **Go 1.22+**, **Python 3.11+**, **Node 20+**.

The database is **Supabase PostgreSQL**; an embedded local PostgreSQL remains available as a fallback
([Local database fallback](#local-database-fallback)). Authentication is either **Supabase Auth** or the Go API's
**local development auth** — both work on a Supabase database.

### 1. Configure

```bash
cp backend-go/.env.example backend-go/.env
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
```

| Setting | Where | Value |
|---|---|---|
| `DATABASE_URL` | `backend-go/.env` **and** `backend/.env` (same value) | Supabase → Connect → **Transaction pooler** string (`…pooler.supabase.com:6543`). The direct host `db.<ref>.supabase.co` is IPv6-only |
| `AI_SERVICE_TOKEN` | both backend `.env` files (same value) | a random string — internal Go ↔ Python secret |
| `AUTH_PROVIDER` | `backend-go/.env` | `supabase` or `local` |
| `SUPABASE_URL` | `backend-go/.env` | `https://<ref>.supabase.co` — tokens are verified against the project's JWKS (ES256 / RS256) |
| `SUPABASE_SERVICE_ROLE_KEY` | `backend-go/.env` | **seed only**, to create the demo users through the Auth Admin API. Never in the frontend |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `frontend/.env.local` | project URL + the publishable (anon) key. Leave the key empty to use local auth |
| `LOCAL_JWT_SECRET` | `backend-go/.env` | ≥ 32 random characters (local auth only) |
| `OPENROUTER_API_KEY` | `backend/.env` | optional — see [AI copilot](#ai-copilot) |

### 2. Database: migrate and seed

```bash
cd backend-go
go run ./cmd/migrate                       # applies supabase/migrations (never use -local-shim on Supabase)
go run ./cmd/seed                          # demo organization, 2 stores, 160 synthetic products, demo users
```

* `seed` is idempotent: if the demo organization exists it only makes sure the demo users and memberships exist.
* `seed -force` **deletes the demo organization and everything in it** (products, sales, history, recommendations,
  alerts, conversations) and reloads it. It does not touch other organizations.
* Demo users are created with `SEED_DEMO_PASSWORD`: through the Supabase Auth Admin API when `AUTH_PROVIDER=supabase`
  (needs `SUPABASE_SERVICE_ROLE_KEY`), or written directly into `auth.users` in GoTrue's own row format when
  `AUTH_PROVIDER=local`.
* Restart the Go API after applying migrations (it caches statement descriptions).

### 3. Run

```bash
cd backend && pip install -r requirements.txt && python -m playwright install chromium
python -m app.ml.training.train_demand     # once per database: trains, validates and registers the demand model
python -m uvicorn app.main:app --port 8000 # AI service — no --reload (Playwright)

cd backend-go && go run ./cmd/server       # Go API :8080
cd frontend && npm install && npm run dev  # frontend :3000
```

Demo accounts (password = `SEED_DEMO_PASSWORD`, `PriceIQ@2026!` in the example file): `demo@priceiq.ai` (admin, both
stores) · `manager@priceiq.ai` (store manager, Koramangala) · `analyst@priceiq.ai` (analyst, both stores) ·
`viewer@priceiq.ai` (viewer, Indiranagar).

### Authentication modes

```mermaid
flowchart LR
    U[User] --> SA[Supabase Auth<br/>or local dev login]
    SA -- access token --> FE[Frontend]
    FE -- "Authorization: Bearer" --> GO[Go API<br/>verifies signature, expiry, audience, role claim]
    GO --> RB[PriceIQ RBAC<br/>memberships → role per store]
    RB --> DB[(Supabase PostgreSQL<br/>RLS as the end user)]
```

* **Supabase Auth** (`AUTH_PROVIDER=supabase` + the two `NEXT_PUBLIC_SUPABASE_*` values): sign-up with e-mail
  verification, sign-in, password reset. Add `http://localhost:3000/login` and `/reset-password` to the project's
  redirect URLs.
* **Local auth** (`AUTH_PROVIDER=local`, no anon key in the frontend): the Go API checks the password against
  `auth.users` and issues a short-lived token itself. Development only; refused when `APP_ENV=production`.
* Authentication only answers *who you are*. What you may do is decided by PriceIQ: the role is looked up per store in
  `memberships`, and PostgreSQL RLS enforces the same rules again.

### Local database fallback

No Supabase project is needed for this path.

```bash
cd backend-go && go run ./cmd/devdb        # embedded PostgreSQL 16 on :54322 — keep it running
go run ./cmd/migrate -local-shim           # schema + an auth shim for plain PostgreSQL
go run ./cmd/seed
```

Use `DATABASE_URL=postgres://postgres:postgres@localhost:54322/priceiq?sslmode=disable` in both backend `.env` files
and `AUTH_PROVIDER=local`. Its data lives in `backend-go/.devdata/` and is independent of Supabase.

### Regenerating the synthetic dataset

```bash
cd backend && python scripts/generate_synthetic_data.py --end 2026-12-31
python -m app.ml.training.train_demand && cd ../backend-go && go run ./cmd/seed -force
```

## Environment variables

| File | Required | Common optional |
|---|---|---|
| `backend-go/.env` | `DATABASE_URL`, `AUTH_PROVIDER`, `AI_SERVICE_TOKEN`, `SUPABASE_URL` (supabase) or `LOCAL_JWT_SECRET` (local) | `SUPABASE_SERVICE_ROLE_KEY` (seed only), `SUPABASE_JWT_SECRET` (legacy HS256), `AI_TIMEOUT`, `REDIS_URL`, `CORS_ORIGINS`, `AI_SERVICE_URL`, `WORKERS_ENABLED`, job intervals, `SMTP_*`, `SEED_DEMO_PASSWORD` |
| `backend/.env` | `DATABASE_URL`, `AI_SERVICE_TOKEN` | `AI_PROVIDER`, `OPENROUTER_API_KEY`, `AI_MODEL`, `OPENROUTER_SITE_URL`, `OPENROUTER_APP_NAME`, `AI_TIMEOUT_S`, `AI_MAX_TOKENS`, `AI_BUDGET_S`, `PRICING_POLICY`, `PLAYWRIGHT_ENABLED`, `SCRAPE_TIMEOUT_S`, `DEFAULT_LAT`, `DEFAULT_LON` |
| `frontend/.env.local` | `NEXT_PUBLIC_API_URL` | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` |

Each folder has a documented `.env.example`. Never commit `.env` files; the service-role key and the internal token
must never be exposed to the browser.

## Testing

```bash
cd backend-go && gofmt -l . && go vet ./... && go test ./...
                                          # RLS / cross-tenant isolation, API integration (throwaway embedded PostgreSQL
                                          # + fake AI service), constraint engine, inventory, status labels
cd backend && python -m pytest tests      # ML units, copilot / LLM provider (HTTP mocked), integration tests against
                                          # the DATABASE_URL in backend/.env (they clean up after themselves)
cd frontend && npm run build && npx eslint src
```

`go test` never touches the configured database. No automated test calls OpenRouter.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Copilot shows "Rule-based fallback" | The warning under the chat gives the reason: set `OPENROUTER_API_KEY` and `AI_MODEL` in `backend/.env` and restart the AI service; a rate-limit warning means the free quota is used up; HTTP 404 means the model id is not served — pick another. |
| "The AI service is not reachable" | Start it (`uvicorn app.main:app --port 8000` in `backend/`); check both `AI_SERVICE_TOKEN` values match. |
| `No demand model available` | Run `python -m app.ml.training.train_demand` in `backend/`. |
| Blinkit UNAVAILABLE: "needs a subprocess-capable event loop" | Start uvicorn without `--reload` on Windows. |
| Blinkit UNAVAILABLE: "Playwright is not installed" | `pip install playwright && python -m playwright install chromium`. |
| `npm run build` fails in `.next/dev/types/…` | Delete `frontend/.next` (stale dev cache) and rebuild. |
| Login fails after reseeding | Sessions belong to the previous seed — sign in again. |
| Products show "Expired" long after seeding | The synthetic expiry dates are anchored to the seed day: `go run ./cmd/seed -force`. |
| Database connection times out on Supabase | The direct host `db.<ref>.supabase.co` is IPv6-only and not resolvable on some networks: use the **Transaction pooler** connection string. |
| Everything works but is slow | The Supabase project is in a distant region (each round trip ≈ 0.25 s). Raise `AI_TIMEOUT` in `backend-go/.env` (for example `180s`) so store-wide ML jobs can finish. |
| Port 54322 in use | Another `devdb` is running, or pass `-port` and update `DATABASE_URL`. |
| 403 on an action | The role is too low for that route (see the role table in `backend-go/routes/routes.go`). |

## Security model

* **Roles:** VIEWER < ANALYST < STORE_MANAGER < ADMIN < SUPER_ADMIN, per store or organization-wide.
* **Two independent layers:** Go middleware checks the role for the store in the URL; every query then runs as the
  PostgreSQL `authenticated` role with the user's claims, so **RLS** enforces tenant isolation even if an API check
  were wrong.
* Audit log, price history and stock movements are written by **database triggers** (append-only for users).
* No plaintext passwords (Supabase Auth; local mode uses bcrypt). Local auth is refused in production.
* The AI service requires a shared internal token (constant-time comparison) and binds to loopback.
* Uploads are size-capped, row-capped and zip-bomb guarded; CSV exports neutralise spreadsheet formulas; CORS allows
  only configured origins; auth and AI routes have stricter rate limits.

## Data honesty

| Label | Meaning |
|---|---|
| **Synthetic/Training Data** | The demo stores hold a *simulated* dataset (160 products × 395 days, 1 Sep 2025 – 30 Sep 2026). Brand names are labels; prices, sales, stock and suppliers are generated. Shown on every page of a synthetic store. |
| **MANUAL assumption** | Seasonal considerations and what-if scenarios — what staff expect, not what was measured. |
| **LIVE** | Read from the platform by PriceIQ within 6 hours, for the store's location. |
| **MANUAL_VERIFIED** | Recorded by a staff member within 24 hours. |
| **CACHED** | An older real observation, or a cached search result. |
| **ESTIMATED** | A modelled value — PriceIQ never produces these for competitor prices. |
| **UNAVAILABLE** | Could not be read; no value is shown. |

Elasticities, cross-effects, festival effects and anomalies are reported only when statistically supported.

## Verified status (October 2026)

Checked on the real system — Supabase PostgreSQL, Go API, Python AI service, Next.js frontend and OpenRouter:

| Check | Result |
|---|---|
| Migrations on Supabase | 9 / 9 applied, RLS on all 32 tables |
| Seeded data (direct queries) | 160 products, 8 categories, 10 suppliers, 62,876 sales (2025-09-01 → 2026-09-30), 4 demo users each with profile, role and store |
| Go | `gofmt` / `go vet` clean, `go test ./...` passes |
| Python | 56 tests pass (including integration tests against Supabase) |
| Frontend | production build (21 routes) passes; ESLint 0 errors, 1 warning |
| End to end through the Go API | 57 / 57 checks: four roles, invalid / missing / tampered tokens, cross-store isolation, pricing band and MRP, approval, simulator, forecasts, considerations incl. supply shortage, expiry optimization, competitors, alerts, reports, audit log, copilot |
| Copilot on OpenRouter | real answers for six reference questions with data from the expected tools; real 401 / 429 / unknown-model errors fall back to rule-based; an instruction hidden in a product name was not followed |
| Browser (headless Chromium) | login, 16 pages, reload, logout and a viewer session — no console errors, no failed API calls |
| Demand model | MAE 5.65 units/day vs 5.93 naive baseline, R² 0.73 — holdout performance on synthetic data |

Not verified: Supabase Auth sign-in (see Limitations), Redis, SMTP.

## Limitations

* Three of four competitor platforms block automated access; they rely on manual entry. Blinkit's page format can change.
* The demo dataset is synthetic and static; a model trained on it has only learned the simulation.
* Weather is shown for planning but is not a model input (no historical weather linked to sales).
* One year of history means every festival is observed once — never high-confidence evidence.
* Local auth is for development only; the in-memory cache supports a single API instance (use Redis otherwise).
* The copilot's LLM mode was verified against the real OpenRouter API. With `openrouter/free` the answering model varies per request, some answers exceed the 40-second budget and fall back, and the free quota (about 50 requests a day) is used up after roughly 20 questions.
* Supabase Auth sign-in has not been exercised end to end (no publishable or service-role key was available); local auth on the Supabase database has.
* A Supabase region far from the servers adds about 0.25 s per database round trip (measured India ↔ Tokyo): pages take 1–3 s and the first forecast overview about 25 s.
* Some networks do not resolve `*.supabase.co`. The database is reached through `*.pooler.supabase.com`, but Supabase Auth needs the project URL to resolve in the browser and for the Go API.
* Deployment (Docker, CI/CD, cloud) is intentionally out of scope for this version.

## Future scope

* Official competitor feeds / partner APIs in place of scraping; POS integration for live sales.
* Weather-linked demand features once historical weather is stored with sales.
* Controlled live A/B rollout of the contextual bandit; multi-product (basket) price optimization.
* Supplier ordering workflow from reorder advice; batch-level (FEFO) expiry tracking.
* Containerised deployment, CI pipeline, observability (metrics, tracing).
