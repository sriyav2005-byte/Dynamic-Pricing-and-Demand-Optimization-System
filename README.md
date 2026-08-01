# PriceIQ — Dynamic Pricing & Demand Optimization System &nbsp;`v4.0`

A full-stack ML-powered pricing engine for retail stores. Recommends optimal product prices using **XGBoost demand prediction** and a **Thompson Sampling contextual bandit**, with a real-time Next.js dashboard.

---

## Architecture

```
┌─────────────────────────┐        ┌──────────────────────────────┐
│   Next.js Frontend      │ HTTP   │   FastAPI Backend             │
│   localhost:3000        │◄──────►│   localhost:8000              │
│                         │        │                               │
│  /dashboard             │        │  GET /products/               │
│  /product/[id]          │        │  GET /pricing/recommend/{id}  │
│  /analytics             │        │  GET /pricing/simulate/{id}   │
└─────────────────────────┘        │  POST /update-sales           │
                                   │  GET /analytics/summary       │
                                   └───────────────┬───────────────┘
                                                   │
                              ┌────────────────────┴──────────────────┐
                              │              SQLite DB                │
                              │  tables: products, sales              │
                              └────────────────────┬──────────────────┘
                                                   │
                              ┌────────────────────┴──────────────────┐
                              │            ML Layer                   │
                              │  XGBoost model  (demand_model_xgb.pkl)│
                              │  Thompson Bandit (bandit_state.json)  │
                              └───────────────────────────────────────┘
```

---

## ML Pipeline

### 1. Demand Prediction (XGBoost)

Trained on `data/dynamic_pricing_data.csv` — 9,000 retail transactions.

| Feature | Description |
|---------|-------------|
| `product_id` | Product identifier |
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

**Target**: `units_sold` | **Model Performance**: RMSE=6.05, R²=0.20

### 2. Pricing Engine (Thompson Sampling Bandit)

- **Arms**: 10 evenly-spaced prices from `cost × 1.05` to `MRP`
- **Selection**: Sample `θ_i ~ Beta(α_i, β_i)` per arm → pick `argmax(θ)`
- **Learning**: After each sale, reward = `profit / max_possible_profit ∈ [0,1]`
  - `alpha[arm] += reward`
  - `beta[arm]  += (1 - reward)`
- **State**: Persisted in `backend/ml/bandit_state.json` across restarts

### 3. Pricing Constraints

| Constraint | Rule |
|-----------|------|
| Expiry discount | If `days_to_expiry < 7` → cap price near cost |
| Min margin | Price ≥ `cost × 1.15` (15% minimum) |
| Max increase | Price ≤ `current_price × 1.10` (+10% max) |
| MRP cap | Price never exceeds MRP |

---

## Project Structure

```
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI entry point + CORS + lifespan seeder
│   │   ├── database.py          # SQLAlchemy engine + session factory
│   │   ├── models/              # ORM models (Product, Sale)
│   │   ├── schemas/             # Pydantic schemas (product, competitor, agent, etc.)
│   │   ├── api/                 # Route handlers (products, pricing, sales, competitor, agent, etc.)
│   │   ├── services/            # Business logic (demand_predictor, bandit, pricing_engine,
│   │   │                        #   analytics, competitor_service, agent_service, etc.)
│   │   └── utils/seed_data.py  # Auto-seeds DB from CSV on first run
│   ├── ml/
│   │   ├── train_demand_model.py  # XGBoost training script
│   │   └── bandit_state.json    # Persistent bandit α/β state
│   ├── .env                     # DATABASE_URL, FRONTEND_ORIGIN
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx              # Demonstration premium landing page
│   │   │   ├── dashboard/page.tsx    # Product table with recommendations
│   │   │   ├── product/[id]/page.tsx # Detail view with charts + simulator
│   │   │   ├── competitors/page.tsx  # Competitor synced market overview
│   │   │   ├── forecasting/page.tsx  # XGBoost 7d/30d forecast area chart
│   │   │   ├── inventory/page.tsx    # Inventory risk scatter matrix & alerts
│   │   │   ├── agent/page.tsx        # Chat interface with AI agent
│   │   │   └── analytics/page.tsx    # KPI cards, trend chart, leaderboard
│   │   ├── components/
│   │   │   ├── ui/                  # Sidebar, StatCard
│   │   │   ├── charts/              # DemandPriceChart, SalesTrendChart,
│   │   │   │                        #   ProfitBreakdownChart, ForecastChart
│   │   │   ├── competitor/          # CompetitorTable, CompetitivenessGauge
│   │   │   ├── inventory/           # InventoryMatrix
│   │   │   ├── agent/               # ChatBubble, AgentResponseCard
│   │   │   └── PriceSimulator.tsx   # Slider-based what-if tool
│   │   └── lib/api.ts              # Typed Axios client for all endpoints
│   └── .env.local                  # NEXT_PUBLIC_API_URL
├── models/
│   ├── demand_model_xgb.pkl        # Trained XGBoost model
│   └── category_encoder.pkl       # LabelEncoder for category strings
└── data/
    └── dynamic_pricing_data.csv   # 9,000-row training dataset
```

---

## Quick Start

### 1. Train the ML model (one-time)

```powershell
python backend/ml/train_demand_model.py
```

### 2. Start the backend

```powershell
cd backend
python -m uvicorn app.main:app --reload --port 8000
```

The server auto-creates the SQLite database and seeds it from the CSV on first startup. Visit `http://localhost:8000/docs` for the Swagger UI.

### 3. Start the frontend

```powershell
cd frontend
npm install   # first time only
npm run dev   # opens http://localhost:3000
```

---

## API Reference

| Component | Method | Endpoint | Description |
|-----------|--------|----------|-------------|
| **Products** | `GET` | `/products/` | List products (filter by category, stock, expiry) |
| | `GET` | `/products/{id}` | Single product |
| | `PATCH` | `/products/{id}` | Update stock / expiry / price |
| | `GET` | `/categories` | Distinct category names |
| **Pricing Engine** | `GET` | `/pricing/recommend/{id}` | Thompson Sampling recommendation |
| | `GET` | `/pricing/simulate/{id}?price=X` | What-if simulation |
| **Sales** | `POST` | `/update-sales` | Record sale + update bandit |
| **Analytics** | `GET` | `/analytics/summary` | Revenue, profit, margin KPIs |
| | `GET` | `/analytics/trends` | Daily time-series for charts |
| **Competitors** | `GET` | `/competitor/prices/{id}` | Get competitor prices for a single product |
| | `GET` | `/competitor/market-overview` | Full competitor comparison table data |
| | `GET` | `/competitor/strategy/{id}` | Recommended strategy based on competitor prices |
| **Forecasting** | `GET` | `/forecasting/demand/{id}` | XGBoost 7/30-day forecast points with confidence bands |
| | `GET` | `/forecasting/overview` | Forecast trend direction & summary |
| **Inventory** | `GET` | `/inventory/overview` | Expiry risk table & category health details |
| | `GET` | `/inventory/alerts` | Critical/Warning alerts for low stock and expiring items |
| **AI Agent** | `POST` | `/agent/chat` | Send prompt to agent, returns typed structured content |
| | `GET` | `/agent/suggestions` | Suggested follow-up prompt pills based on DB status |

---

## Competitor Price Intelligence System

### How competitor prices are obtained
To bypass issues with web scraping rate-limits and authentication blockers on Indian quick-commerce platforms, the backend uses a **deterministic seeded simulation** located in [competitor_service.py](file:///d:/Dynamic-Pricing-and-Demand-Optimization-System/backend/app/services/competitor_service.py) that acts as a real-time price synchronization feed:

1. **Profiles**: Different platform profiles are configured to match real market strategies:
   - **Blinkit**: Aggressive on personal care/snacks, pricing averages 3%–8% below MRP.
   - **Zepto**: Premium styling, aggressive on beverages/dairy.
   - **Swiggy Instamart**: Mid-range, highly stable.
   - **BigBasket**: Volume-based pricing, tends to be cheapest on staples.
2. **Deterministic Seed Hashing**: To prevent prices from "flickering" or regenerating random values on page refresh, the random seed is generated using the **MD5 hash** of `product_id-platform`:
   ```python
   seed_str = f"{product_id}-{platform}-v2"
   seed_int = int(hashlib.md5(seed_str.encode()).hexdigest()[:8], 16)
   rng = random.Random(seed_int)
   ```
3. **Constraints**: Simulated competitor prices vary realistically within platform-specific percentages of the product's MRP but are constrained to never drop below `cost_price + 5%` wholesale margin.
4. **Metrics**:
   - **Competitiveness Score**: Scaled `0-100` (where `100` = cheapest in the market, `0` = most expensive).
   - **Pricing Strategies**: The engine automatically suggests actionable strategies (`undercut`, `match`, `premium`, `aggressive_discount`) depending on competitor spread, inventory health, and days to expiry.

---

## Upgrading to PostgreSQL

Change one line in `backend/.env`:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/pricing
```

No code changes needed — SQLAlchemy handles the dialect automatically.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16 (App Router), TypeScript, Tailwind CSS, Recharts, Lucide Icons |
| Backend | FastAPI, SQLAlchemy 2.0, Pydantic v2 |
| Database | SQLite (dev) / PostgreSQL (prod) |
| ML | XGBoost, scikit-learn, NumPy, pandas |
| HTTP client | Axios |
