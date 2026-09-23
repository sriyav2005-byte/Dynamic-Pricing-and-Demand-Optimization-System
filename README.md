# PriceIQ — Dynamic Pricing & Demand Optimization System

> **v3.1** · Full-stack ML-powered pricing intelligence for modern retail

A production-grade pricing platform that recommends optimal product prices using **XGBoost demand prediction** and a **Thompson Sampling contextual bandit**, with real-time competitor intelligence, demand forecasting, inventory risk management, a conversational AI agent, live cross-platform price search, and a premium Next.js 16 dashboard.

---

## Table of Contents

1. [Architecture](#architecture)
2. [Feature Overview](#feature-overview)
3. [ML Pipeline](#ml-pipeline)
4. [Project Structure](#project-structure)
5. [Quick Start](#quick-start)
6. [Running Tests](#running-tests)
7. [API Reference](#api-reference)
8. [Competitor Price Intelligence](#competitor-price-intelligence)
9. [Live Price Search](#live-price-search)
10. [Frontend Pages](#frontend-pages)
11. [Upgrading to PostgreSQL](#upgrading-to-postgresql)
12. [Tech Stack](#tech-stack)
13. [Roadmap](#roadmap)

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                 Next.js 16 Frontend  (port 3000)          │
│                                                           │
│  /            Landing page (public)                       │
│  /login       Auth page (demo credentials)                │
│  /dashboard   Product table + bandit recommendations      │
│  /product/[id] Detail view: charts + price simulator      │
│  /competitors  Competitor market table + strategy view    │
│  /forecasting  7d/30d demand area chart                   │
│  /inventory    Scatter risk matrix + alert feed           │
│  /live-search  Real-time cross-platform price search      │
│  /seasonal     Coming Soon — seasonal pricing engine      │
│  /agent        Conversational AI pricing assistant        │
│  /analytics    KPI cards, trend chart, profit leaderboard │
└────────────────────────┬─────────────────────────────────┘
                         │ HTTP/JSON (Axios)
                         ▼
┌──────────────────────────────────────────────────────────┐
│               FastAPI Backend  (port 8000)                │
│                                                           │
│  /products/*      Product CRUD + filtering                │
│  /pricing/*       Thompson Sampling + simulation          │
│  /analytics/*     Revenue, profit, trend KPIs            │
│  /competitor/*    Market intelligence + strategy          │
│  /forecasting/*   XGBoost demand forecasting             │
│  /inventory/*     Expiry risk + stock alerts             │
│  /search/*        Live cross-platform price search        │
│  /agent/*         Rule-based AI agent + chat             │
│  /update-sales    Sale recording + bandit update         │
└──────────────┬─────────────────────────────┬────────────┘
               │                             │
    ┌──────────▼──────────┐    ┌─────────────▼────────────┐
    │     SQLite DB        │    │        ML Layer           │
    │   products, sales    │    │  XGBoost demand_model.pkl │
    └─────────────────────┘    │  Thompson Bandit state    │
                               │  (bandit_state.json)      │
                               └──────────────────────────┘
```

---

## Feature Overview

| # | Feature | Status |
|---|---------|--------|
| 1 | **Landing Page** — premium hero with product mockup and animated stats | ✅ Live |
| 2 | **Login Page** — glassmorphism auth with demo credentials | ✅ Live |
| 3 | **Dashboard** — product table with Thompson Sampling price recs | ✅ Live |
| 4 | **Product Detail** — demand-price chart + interactive price simulator | ✅ Live |
| 5 | **Competitor Intelligence** — 4-platform price table + competitiveness gauge | ✅ Live |
| 6 | **Demand Forecasting** — XGBoost 7d/30d forecast with confidence bands | ✅ Live |
| 7 | **Inventory Management** — scatter matrix, expiry risk, alert feed | ✅ Live |
| 8 | **Live Price Search** — real-time search across Blinkit/Zepto/Instamart/BigBasket | ✅ Live |
| 9 | **AI Agent** — intent-classified chat with structured DB-backed responses | ✅ Live |
| 10 | **Analytics** — KPI cards, sales trend, profit leaderboard | ✅ Live |
| 11 | **Seasonal Pricing Engine** — season-aware repricing & festive playbooks | 🔜 Coming Soon |

---

## ML Pipeline

### 1. Demand Prediction (XGBoost)

Trained on `data/dynamic_pricing_data.csv` — 9,000 retail transactions across 50 products and 5 categories.

| Feature | Description |
|---------|-------------|
| `product_id` | Product identifier (0–49) |
| `category_enc` | Integer-encoded category |
| `price` | Sale price |
| `day_of_week` | 0=Mon … 6=Sun |
| `month` | 1–12 |
| `is_weekend` | 1 if Sat/Sun |
| `stock_level` | Units in inventory |
| `days_to_expiry` | Days until expiry |
| `season_factor` | Demand multiplier |
| `cost_price` | Wholesale cost |
| `mrp` | Maximum Retail Price |

**Target**: `units_sold` · **Model**: `models/demand_model_xgb.pkl` · **Performance**: RMSE=6.05, R²=0.20

### 2. Pricing Engine (Thompson Sampling Bandit)

```
Arms:      10 evenly-spaced prices from cost×1.05 → MRP
Selection: Sample θᵢ ~ Beta(αᵢ, βᵢ) per arm → pick argmax(θ)
Reward:    r = profit / max_possible_profit  ∈ [0, 1]
Update:    α[arm] += r   |   β[arm] += (1 − r)
State:     Persisted in backend/ml/bandit_state.json
```

**Key improvements in v3.1:**
- Strict `float` casting throughout to prevent NumPy type serialisation errors
- `arm_idx` clamped to `[0, NUM_ARMS − 1]` to prevent out-of-range updates
- Zero-division guard in `simulate_price()` for zero cost products

### 3. Pricing Constraints

Applied in priority order at recommendation time:

| Priority | Constraint | Rule |
|----------|-----------|------|
| 1 | **Expiry discount** | If `days_to_expiry < 7` → cap price ≤ `cost × 1.16` |
| 2 | **Min margin** | Price ≥ `cost × 1.15` (15% floor) |
| 3 | **Max increase** | Price ≤ `current_price × 1.10` (+10% cap) |
| 4 | **MRP cap** | Price never exceeds MRP |

### 4. Product Name Mapping

v3.1 introduces `backend/app/utils/product_names.py` and `frontend/src/lib/products.ts` — a static lookup of 50 human-readable Indian product names (e.g. "Amul Cheese Slices", "Haldiram's Aloo Bhujia") keyed by product ID 0–49. All API responses now include a `product_name` field.

---

## Project Structure

```
Dynamic-Pricing-and-Demand-Optimization-System/
│
├── backend/
│   ├── app/
│   │   ├── main.py                    # FastAPI entry + CORS + lifespan seeder
│   │   ├── database.py                # SQLAlchemy engine + SessionLocal + Base
│   │   │
│   │   ├── models/
│   │   │   └── product.py             # ORM: Product (incl. product_name), Sale
│   │   │
│   │   ├── schemas/
│   │   │   ├── product.py             # ProductOut, ProductUpdate
│   │   │   ├── competitor.py          # CompetitorPriceOut
│   │   │   ├── forecasting.py         # ForecastPoint, ForecastResponse
│   │   │   ├── inventory.py           # InventoryOverview, Alert
│   │   │   └── (agent, sales, …)
│   │   │
│   │   ├── api/
│   │   │   ├── products.py            # GET/PATCH /products/*
│   │   │   ├── pricing.py             # GET /pricing/recommend|simulate/{id}
│   │   │   ├── sales.py               # POST /update-sales + /analytics/*
│   │   │   ├── competitor.py          # GET /competitor/*
│   │   │   ├── forecasting.py         # GET /forecasting/*
│   │   │   ├── inventory.py           # GET /inventory/*
│   │   │   ├── agent.py               # POST /agent/chat, GET /agent/suggestions
│   │   │   └── search.py              # GET /search/live, /search/platforms
│   │   │
│   │   ├── services/
│   │   │   ├── demand_predictor.py    # XGBoost loader + predict()
│   │   │   ├── bandit.py              # ThompsonBandit — select/update/persist
│   │   │   ├── pricing_engine.py      # recommend_price() + simulate_price()
│   │   │   ├── competitor_service.py  # Deterministic seeded price simulation
│   │   │   ├── forecasting_service.py # generate_forecast() with confidence bands
│   │   │   ├── inventory_service.py   # Expiry risk, alerts, overview
│   │   │   ├── analytics.py           # Revenue/profit KPIs + trend time-series
│   │   │   ├── agent_service.py       # Intent classification + structured responses
│   │   │   └── live_search_service.py # Cross-platform live/estimated price search
│   │   │
│   │   └── utils/
│   │       ├── seed_data.py           # CSV → SQLite seeder (idempotent + --force)
│   │       └── product_names.py       # Product ID → human-readable name mapping
│   │
│   ├── ml/
│   │   ├── train_demand_model.py      # XGBoost training script
│   │   └── bandit_state.json          # Persistent α/β per product per arm
│   │
│   ├── tests/
│   │   └── test_api.py                # 10 integration tests (unittest + TestClient)
│   │
│   ├── requirements.txt
│   └── .env                           # DATABASE_URL, FRONTEND_ORIGIN
│
├── frontend/
│   └── src/
│       ├── app/
│       │   ├── page.tsx               # Landing page (hero, mockup, How It Works)
│       │   ├── login/page.tsx         # Auth page (glassmorphism, demo credentials)
│       │   ├── dashboard/page.tsx     # Product table + bandit recommendations
│       │   ├── product/[id]/page.tsx  # Detail: charts + interactive simulator
│       │   ├── competitors/page.tsx   # 4-platform price table + strategy panel
│       │   ├── forecasting/page.tsx   # 7d/30d demand forecast area chart
│       │   ├── inventory/page.tsx     # Scatter risk matrix + alert feed
│       │   ├── live-search/page.tsx   # Real-time cross-platform price search
│       │   ├── seasonal/page.tsx      # Coming Soon — animated countdown + features
│       │   ├── agent/page.tsx         # Chat interface with AI agent
│       │   └── analytics/page.tsx     # KPI cards, trend chart, leaderboard
│       │
│       ├── components/
│       │   ├── layout/
│       │   │   └── RootLayoutClient.tsx  # Sidebar toggle (hidden on /, /login)
│       │   ├── ui/
│       │   │   └── Sidebar.tsx          # Fixed nav (Dashboard→Analytics + Seasonal)
│       │   ├── charts/
│       │   │   ├── DemandPriceChart.tsx  # Demand curve line chart
│       │   │   ├── SalesTrendChart.tsx   # Area chart of daily sales
│       │   │   ├── ProfitBreakdownChart.tsx # Bar chart with product names
│       │   │   └── ForecastChart.tsx      # Forecast area + confidence band
│       │   ├── competitor/
│       │   │   ├── CompetitorTable.tsx   # 4-platform price comparison (name + ID)
│       │   │   └── CompetitivenessGauge.tsx # Radial score gauge
│       │   ├── inventory/
│       │   │   └── InventoryMatrix.tsx   # Scatter matrix with product name tooltips
│       │   ├── agent/
│       │   │   ├── ChatBubble.tsx
│       │   │   └── AgentResponseCard.tsx
│       │   └── PriceSimulator.tsx        # Slider-based what-if price tool
│       │
│       └── lib/
│           ├── api.ts                    # Typed Axios client for all endpoints
│           └── products.ts              # Frontend product ID → name mapping
│
├── models/
│   ├── demand_model_xgb.pkl            # Trained XGBoost model
│   └── category_encoder.pkl           # LabelEncoder for category strings
│
└── data/
    └── dynamic_pricing_data.csv        # 9,000-row retail training dataset
```

---

## Quick Start

### Prerequisites

- Python 3.11+
- Node.js 18+
- npm

### 1. Train the ML model *(one-time)*

```powershell
python backend/ml/train_demand_model.py
```

This generates `models/demand_model_xgb.pkl` and `models/category_encoder.pkl`.

### 2. Start the backend

```powershell
cd backend
python -m uvicorn app.main:app --reload --port 8000
```

On first startup the server:
1. Creates all SQLite tables (`pricing.db`)
2. Seeds 50 products and 1,500 historical sales records from the CSV
3. Loads the XGBoost model and initialises the bandit state

**Swagger UI**: http://localhost:8000/docs  
**ReDoc**: http://localhost:8000/redoc

> **Force reseed** (clears and re-populates the database):
> ```powershell
> python -m app.utils.seed_data --force
> ```

### 3. Start the frontend

```powershell
cd frontend
npm install        # first time only
npm run dev        # opens http://localhost:3000
```

### 4. Login

Navigate to `http://localhost:3000` and click **Get Started**. On the login page use:

| Field | Value |
|-------|-------|
| Email | `demo@priceiq.ai` |
| Password | `priceiq2025` |

> Click the purple **"Click to autofill demo account"** button to fill credentials instantly.

---

## Running Tests

From the `backend/` directory:

```powershell
python -m unittest tests/test_api.py
```

**10 integration tests** covering:

| Test | Endpoints |
|------|-----------|
| `test_products_endpoints` | `GET /products/`, `GET /products/0` |
| `test_categories_endpoint` | `GET /categories` |
| `test_pricing_endpoints` | `GET /pricing/recommend/0`, `GET /pricing/simulate/0` |
| `test_analytics_endpoints` | `GET /analytics/summary`, `GET /analytics/trends` |
| `test_competitor_endpoints` | `GET /competitor/prices/0`, `/market-overview`, `/strategy/0` |
| `test_inventory_endpoints` | `GET /inventory/overview`, `/expiry-risk`, `/alerts` |
| `test_forecasting_endpoints` | `GET /forecasting/demand/0`, `/overview` |
| `test_agent_endpoints` | `GET /agent/suggestions`, `POST /agent/chat` |
| `test_update_sales_and_learning_loop` | `POST /update-sales` |
| `test_search_endpoints` | `GET /search/platforms`, `GET /search/live?query=milk` |

Expected output: `Ran 10 tests in ~9s — OK`

---

## API Reference

### Products

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/products/` | List all products. Optional filters: `?category=dairy&min_stock=10&max_expiry_days=30` |
| `GET` | `/products/{id}` | Single product by ID. Returns `product_name` field. |
| `PATCH` | `/products/{id}` | Update `stock_level`, `days_to_expiry`, or `current_price` |
| `GET` | `/categories` | Distinct category list |

### Pricing Engine

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/pricing/recommend/{id}` | Thompson Sampling recommendation + 10 arm options with demand/profit curves. Returns `product_name`. |
| `GET` | `/pricing/simulate/{id}?price=X` | What-if demand/profit at any given price. Returns `product_name`. |

### Sales & Learning Loop

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/update-sales` | Record a sale and update bandit α/β state. Body: `{product_id, price, units_sold}` |

### Analytics

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/analytics/summary` | Total revenue, profit, avg margin, top products |
| `GET` | `/analytics/trends` | Daily time-series for the last 30 days |

### Competitor Intelligence

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/competitor/prices/{id}` | Competitor prices for one product across all 4 platforms |
| `GET` | `/competitor/market-overview` | Full comparison table — all products vs all platforms |
| `GET` | `/competitor/strategy/{id}` | Recommended strategy: `undercut` / `match` / `premium` / `aggressive_discount` |

### Forecasting

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/forecasting/demand/{id}` | 7/30-day XGBoost forecast with upper/lower confidence bands |
| `GET` | `/forecasting/overview` | Summary trend direction + top forecast insights |

### Inventory

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/inventory/overview` | Total stock value, expiry risk table, category health |
| `GET` | `/inventory/expiry-risk` | Products sorted by expiry urgency |
| `GET` | `/inventory/alerts` | Critical / warning alert objects |

### Live Price Search

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/search/live?query=<name>&category=<cat>` | Search across Blinkit, Zepto, Instamart, BigBasket, Amazon Fresh |
| `GET` | `/search/platforms` | List all supported platforms with branding metadata |

### AI Agent

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/agent/chat` | Send `{message}` → receives structured response with intent, data, recommendations |
| `GET` | `/agent/suggestions` | Context-aware follow-up prompt suggestions based on live DB state |

---

## Competitor Price Intelligence

### How prices are simulated

To work around rate-limits and authentication blockers on Indian quick-commerce platforms, the backend uses a **deterministic seeded simulation** in [`competitor_service.py`](backend/app/services/competitor_service.py):

1. **Platform profiles** calibrated to real market strategies:

   | Platform | Positioning | Category Biases |
   |----------|-------------|-----------------|
   | **Blinkit** | Aggressive FMCG pricing | -4% snacks, -3% beverages |
   | **Zepto** | Premium + flash deals | -5% snacks, +3% personal care |
   | **Swiggy Instamart** | Mid-range, stable | Minimal bias |
   | **BigBasket** | Volume-based, staples cheapest | -3% staples |

2. **Deterministic MD5 seeding** — prices are stable on page refresh:

   ```python
   seed_str = f"{product_id}-{platform}-v2"
   seed_int = int(hashlib.md5(seed_str.encode()).hexdigest()[:8], 16)
   rng = random.Random(seed_int)
   ```

3. **Constraints**: Competitor prices never drop below `cost_price + 5%` wholesale margin.

4. **Metrics**:
   - **Competitiveness Score** — scaled 0–100 (100 = cheapest in the market)
   - **Strategy** — auto-recommended: `undercut`, `match`, `premium`, `aggressive_discount`

---

## Live Price Search

[`live_search_service.py`](backend/app/services/live_search_service.py) supports 5 platforms:

| Platform | Data Source |
|----------|-------------|
| Blinkit | Scraped via httpx (with realistic fallback) |
| Zepto | Estimated (search URL generated) |
| Swiggy Instamart | Estimated |
| BigBasket | Estimated |
| Amazon Fresh | Estimated |

Each result includes: `product_name`, `price`, `original_price`, `discount_pct`, `product_url`, `in_stock`, `quantity`, `is_live_data` flag.

---

## Frontend Pages

| Route | Component | Description |
|-------|-----------|-------------|
| `/` | `page.tsx` | Marketing landing page — hero, floating stat cards, product mockup, feature sections |
| `/login` | `login/page.tsx` | Full-screen glassmorphism auth — demo credentials, particle background, brand panel |
| `/dashboard` | `dashboard/page.tsx` | Product table with price recommendations, category filters, quick actions |
| `/product/[id]` | `product/[id]/page.tsx` | Demand chart, price simulator slider, bandit arm visualisation |
| `/competitors` | `competitors/page.tsx` | 4-platform price matrix, competitiveness gauges, strategy recommendations |
| `/forecasting` | `forecasting/page.tsx` | 7d/30d XGBoost forecast area chart with confidence bands |
| `/inventory` | `inventory/page.tsx` | Risk scatter matrix (critical/warning/healthy), expiry alert feed |
| `/live-search` | `live-search/page.tsx` | Real-time cross-platform price search with platform cards |
| `/seasonal` | `seasonal/page.tsx` | **Coming Soon** — animated countdown, season orbit ring, feature preview, dev progress bars |
| `/agent` | `agent/page.tsx` | Chat interface with structured AI agent responses |
| `/analytics` | `analytics/page.tsx` | Revenue/profit KPIs, sales trend chart, top-10 profit leaderboard |

### Navigation Sidebar

The sidebar is **hidden** on `/` (landing) and `/login` (auth) pages. It is visible across all app pages with the following order:

```
Dashboard · Products · Competitors · Forecasting · Inventory
── Seasonal [SOON] ──
── Live Search [LIVE] ──
AI Agent [AI] · Analytics
```

---

## Upgrading to PostgreSQL

Change one line in `backend/.env`:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/pricing
```

No code changes needed — SQLAlchemy handles the dialect automatically. Run the seed script once after migrating:

```powershell
cd backend
python -m app.utils.seed_data
```

---

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| **Frontend** | Next.js (App Router) | 16.2.4 |
| | TypeScript | 5.x |
| | Tailwind CSS | 4.x |
| | Recharts | 3.x |
| | Lucide Icons | 1.x |
| | Axios | 1.x |
| **Backend** | FastAPI | latest |
| | SQLAlchemy | 2.0 |
| | Pydantic | v2 |
| | httpx | latest |
| | BeautifulSoup4 + lxml | latest |
| **Database** | SQLite (dev) / PostgreSQL (prod) | — |
| **ML** | XGBoost | latest |
| | scikit-learn | latest |
| | NumPy + pandas | latest |

---

## Roadmap

### Version 3.1 (Current)
- [x] Product name mapping (backend `product_names.py` + frontend `products.ts`)
- [x] Live cross-platform price search (`/search/live`)
- [x] Login page with glassmorphism UI and demo credentials
- [x] Seasonal Pricing Coming Soon page with countdown and feature preview
- [x] Recharts `minWidth={0}` fixes for layout stability
- [x] `product_name` field in pricing and simulate API responses
- [x] Integration test suite (10 tests, `tests/test_api.py`)
- [x] Force reseed (`--force` / `--reseed` CLI flags)
- [x] Historical `sold_at` timestamps in sale records

### Version 4.0 (Planned)
- [ ] Seasonal Pricing Engine — Summer surge detector, monsoon perishable shield, Diwali/Holi playbooks
- [ ] Season-aware XGBoost features (season embeddings, year-over-year lag)
- [ ] Thompson Sampling warm-start from prior season data
- [ ] Real authentication with JWT tokens and user profiles
- [ ] PostgreSQL migration scripts with Alembic
- [ ] Prometheus metrics + Grafana dashboard

---

*Built with ❤️ using FastAPI + Next.js · ML by XGBoost + Thompson Sampling*
