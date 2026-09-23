"""
utils/seed_data.py — Database Seeder
======================================
Populates the `products` and `sales` tables from dynamic_pricing_data.csv
on the first server startup.

Strategy
--------
Products : Take the LATEST row per product_id (sorted by date).
           This gives us the most recent price, stock, and expiry state.

Sales    : Take the LAST 30 rows per product (chronological).
           This pre-populates the analytics dashboard with historical data.

The seeder is idempotent — if the `products` table already has rows,
it exits immediately without making any changes.

Run manually:
    python backend/app/utils/seed_data.py
Or automatically at startup via app/main.py lifespan hook.
"""

import os
import sys
import pandas as pd

# Allow running this file directly from the command line
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from app.database import engine, SessionLocal, Base
from app.models.product import Product
from app.models.sale import Sale

# Path to the source dataset (relative to project root)
DATA_PATH = os.path.join(
    os.path.dirname(__file__),
    "..", "..", "..", "data", "dynamic_pricing_data.csv"
)


def seed(force: bool = False):
    """
    Seed the database from the CSV dataset.

    Steps
    -----
    1. Create all tables (no-op if they already exist).
    2. Check if products table has data — exit early unless force=True.
    3. Read the CSV, parse dates.
    4. Extract the latest row per product → insert as Product rows.
    5. Extract the last 30 rows per product → insert as Sale rows with historical sold_at timestamps.
    6. Commit everything in one transaction for atomicity.
    """
    # Ensure all tables exist (safe to call multiple times)
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()

    # ── Idempotency check ────────────────────────────────────────────────────
    if not force and db.query(Product).count() > 0:
        print("[!] Database already seeded - skipping.")
        db.close()
        return

    if force:
        print("[*] Force reseed requested: clearing existing data...")
        db.query(Sale).delete()
        db.query(Product).delete()
        db.commit()

    print("[*] Reading CSV...")
    df = pd.read_csv(DATA_PATH)
    df["date"] = pd.to_datetime(df["date"])

    # ── Seed products ─────────────────────────────────────────────────────────
    # Sort by date ascending, then take the last (most recent) row per product.
    # This means product.current_price reflects the latest observed price.
    latest = df.sort_values("date").groupby("product_id").last().reset_index()

    products = []
    for _, row in latest.iterrows():
        products.append(
            Product(
                product_id=int(row["product_id"]),
                category=str(row["category"]),
                cost_price=float(row["cost_price"]),
                mrp=float(row["mrp"]),
                current_price=float(row["price"]),      # latest observed price
                stock_level=int(row["stock_level"]),
                days_to_expiry=int(row["days_to_expiry"]),
                season_factor=float(row["season_factor"]),
            )
        )

    db.bulk_save_objects(products)   # batch insert — much faster than one-by-one

    # ── Seed historical sales ─────────────────────────────────────────────────
    # Pre-populate the analytics dashboard with the last 30 days per product.
    # We need cost to compute profit, so build a lookup from `latest`.
    df_sorted = df.sort_values("date")
    recent = df_sorted.groupby("product_id").tail(30)

    product_costs = {
        int(row["product_id"]): float(row["cost_price"])
        for _, row in latest.iterrows()
    }

    sales = []
    for _, row in recent.iterrows():
        pid = int(row["product_id"])
        cost = product_costs.get(pid, 0.0)
        price_sold = float(row["price"])
        units = int(row["units_sold"])
        profit = (price_sold - cost) * units   # denormalised for fast analytics
        sold_date = row["date"].to_pydatetime()

        sales.append(
            Sale(
                product_id=pid,
                price_sold=price_sold,
                units_sold=units,
                profit=profit,
                sold_at=sold_date,
            )
        )

    db.bulk_save_objects(sales)
    db.commit()
    db.close()

    print(f"[OK] Seeded {len(products)} products and {len(sales)} sales records.")


if __name__ == "__main__":
    force_seed = "--force" in sys.argv or "--reseed" in sys.argv
    seed(force=force_seed)

