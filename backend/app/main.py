"""
main.py — FastAPI Application Entry Point
==========================================
Bootstraps the full application:
  1. Creates database tables on first run
  2. Seeds product & sales data from the CSV dataset
  3. Registers all API routers
  4. Adds CORS middleware so the Next.js frontend can call the API

Run with:
    python -m uvicorn app.main:app --reload --port 8000

Interactive API docs:
    http://localhost:8000/docs   (Swagger UI)
    http://localhost:8000/redoc  (ReDoc)
"""

import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

# Load .env values (DATABASE_URL, FRONTEND_ORIGIN, etc.)
load_dotenv()

# Import ORM base and persistent engine so we can create tables
from app.database import engine, Base

# Import all route handlers
from app.api.products import router as products_router
from app.api.pricing import router as pricing_router
from app.api.sales import router as sales_router
from app.api.competitor import router as competitor_router
from app.api.agent import router as agent_router
from app.api.forecasting import router as forecasting_router
from app.api.inventory import router as inventory_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    FastAPI lifespan context manager — runs once on server startup.

    Steps:
      1. `create_all` creates any missing tables (idempotent — safe to re-run).
      2. `seed()` populates products and historical sales if the DB is empty.
         On subsequent startups it detects existing data and skips.
    """
    Base.metadata.create_all(bind=engine)

    # Auto-seed the database from dynamic_pricing_data.csv
    from app.utils.seed_data import seed
    seed()

    yield  # Application runs here — server is live


# ── Application instance ────────────────────────────────────────────────────
app = FastAPI(
    title="PriceIQ — AI-Powered Retail Pricing Intelligence Platform",
    description=(
        "Full-stack ML-powered pricing engine with competitor intelligence, "
        "demand forecasting, inventory management, and conversational AI agent.\n\n"
        "Uses XGBoost for demand prediction, Thompson Sampling "
        "(contextual bandit) for price action selection, and simulated "
        "competitor data from Blinkit, Zepto, Instamart, and BigBasket."
    ),
    version="2.0.0",
    lifespan=lifespan,
)

# ── CORS Middleware ──────────────────────────────────────────────────────────
# Allows the Next.js frontend (default port 3000) to call this API.
# In production, restrict 'allow_origins' to your exact frontend domain.
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:3000")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_ORIGIN, "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],   # GET, POST, PATCH, DELETE, etc.
    allow_headers=["*"],
)

# ── Routers ──────────────────────────────────────────────────────────────────
# Each router is a separate module grouping related endpoints.
app.include_router(products_router)     # /products/*
app.include_router(pricing_router)      # /pricing/recommend/* and /pricing/simulate/*
app.include_router(sales_router)        # /update-sales, /analytics/*
app.include_router(competitor_router)   # /competitor/*
app.include_router(agent_router)        # /agent/*
app.include_router(forecasting_router)  # /forecasting/*
app.include_router(inventory_router)    # /inventory/*


# ── Health check ─────────────────────────────────────────────────────────────
@app.get("/", tags=["health"])
def health_check():
    """Simple liveness probe — returns OK if the server is up."""
    return {"status": "ok", "service": "Dynamic Pricing API"}


@app.get("/categories", tags=["products"])
def get_categories():
    """
    Returns the distinct product categories present in the database.
    Used by the frontend filter dropdown on the Dashboard page.
    """
    from app.database import SessionLocal
    from app.models.product import Product

    db = SessionLocal()
    try:
        cats = db.query(Product.category).distinct().all()
        return [c[0] for c in cats]
    finally:
        db.close()
