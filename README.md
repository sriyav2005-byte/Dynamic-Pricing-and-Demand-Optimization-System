# PriceIQ — Dynamic Pricing & Demand Optimization System

A full-stack ML-powered pricing engine for retail stores. Recommends
optimal product prices using **XGBoost demand prediction** and a **Thompson
Sampling contextual bandit**, with a real-time Next.js dashboard.

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

Trained on `data/dynamic_pricing_data.csv` — 9,000 rows of retail transactions.

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
│   │   ├── schemas/             # Pydantic request/response schemas
│   │   ├── api/                 # Route handlers (products, pricing, sales)
│   │   ├── services/            # Business logic (demand_predictor, bandit,
│   │   │                        #   pricing_engine, analytics)
│   │   └── utils/seed_data.py  # Auto-seeds DB from CSV on first run
│   ├── ml/
│   │   ├── train_demand_model.py  # XGBoost training script
│   │   └── bandit_state.json    # Persistent bandit α/β state
│   ├── .env                     # DATABASE_URL, FRONTEND_ORIGIN
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── dashboard/page.tsx    # Product table with recommendations
│   │   │   ├── product/[id]/page.tsx # Detail view with charts + simulator
│   │   │   └── analytics/page.tsx    # KPI cards, trend chart, leaderboard
│   │   ├── components/
│   │   │   ├── ui/                  # Sidebar, StatCard
│   │   │   ├── charts/              # DemandPriceChart, SalesTrendChart,
│   │   │   │                        # ProfitBreakdownChart
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

The server auto-creates the SQLite database and seeds it from the CSV on
first startup. Visit `http://localhost:8000/docs` for the Swagger UI.

### 3. Start the frontend

```powershell
cd frontend
npm install   # first time only
npm run dev   # opens http://localhost:3000
```

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/products/` | List products (filter by category, stock, expiry) |
| `GET` | `/products/{id}` | Single product |
| `PATCH` | `/products/{id}` | Update stock / expiry / price |
| `GET` | `/pricing/recommend/{id}` | Thompson Sampling recommendation |
| `GET` | `/pricing/simulate/{id}?price=X` | What-if simulation |
| `POST` | `/update-sales` | Record sale + update bandit |
| `GET` | `/analytics/summary` | Revenue, profit, margin KPIs |
| `GET` | `/analytics/trends` | Daily time-series for charts |
| `GET` | `/categories` | Distinct category names |

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
| Frontend | Next.js 16, TypeScript, Tailwind CSS, Recharts |
| Backend | FastAPI, SQLAlchemy 2.0, Pydantic v2 |
| Database | SQLite (dev) / PostgreSQL (prod) |
| ML | XGBoost, scikit-learn, NumPy, pandas |
| HTTP client | Axios |
