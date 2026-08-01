"""
utils/seed_data.py — Database Seeder & Product Mapper
======================================================
Populates the `products` and `sales` tables from dynamic_pricing_data.csv
and maps product IDs to real Indian fast-commerce product titles & brands.
"""

import os
import sys
import pandas as pd
from sqlalchemy import text

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

# Real-world Indian Fast Commerce Product Mappings (Product ID → Title & Brand)
REAL_PRODUCT_MAPPINGS = {
    0: {"name": "Amul Taaza Milk (1L Pouch)", "brand": "Amul", "category": "dairy"},
    1: {"name": "Amul Butter Pasteurised (500g)", "brand": "Amul", "category": "dairy"},
    2: {"name": "Tata Salt Vacuum Evaporated (1kg)", "brand": "Tata", "category": "grocery"},
    3: {"name": "Brooke Bond Red Label Tea (500g)", "brand": "Red Label", "category": "beverages"},
    4: {"name": "Surf Excel Easy Wash Detergent Powder (1kg)", "brand": "Surf Excel", "category": "household"},
    5: {"name": "Maggi 2-Minute Masala Noodles (4-Pack, 280g)", "brand": "Nestle", "category": "snacks"},
    6: {"name": "Fortune Sunlite Sunflower Refined Oil (1L)", "brand": "Fortune", "category": "grocery"},
    7: {"name": "Coca-Cola Original Soft Drink Bottle (1.25L)", "brand": "Coca-Cola", "category": "beverages"},
    8: {"name": "Dettol Original Germ Protection Soap (3 x 125g)", "brand": "Dettol", "category": "personal_care"},
    9: {"name": "Aashirvaad Superior MP Chakki Atta (5kg)", "brand": "Aashirvaad", "category": "grocery"},
    10: {"name": "Nescafe Classic Instant Coffee Powder (100g Jar)", "brand": "Nescafe", "category": "beverages"},
    11: {"name": "Colgate Strong Teeth Toothpaste (150g)", "brand": "Colgate", "category": "personal_care"},
    12: {"name": "Dove Intense Repair Hair Shampoo (340ml)", "brand": "Dove", "category": "personal_care"},
    13: {"name": "Britannia Good Day Cashew Cookies (200g)", "brand": "Britannia", "category": "snacks"},
    14: {"name": "Lay's India's Magic Masala Potato Chips (50g)", "brand": "Lay's", "category": "snacks"},
    15: {"name": "Amul Fresh Malai Paneer (200g Pack)", "brand": "Amul", "category": "dairy"},
    16: {"name": "Mother Dairy Fresh Dahi / Curd (400g Tub)", "brand": "Mother Dairy", "category": "dairy"},
    17: {"name": "Britannia 100% Whole Wheat Bread (400g)", "brand": "Britannia", "category": "bakery"},
    18: {"name": "Farm Fresh White Eggs (6 Pcs Box)", "brand": "Farm Fresh", "category": "dairy"},
    19: {"name": "Pepsi Soft Drink Bottle (1.25L)", "brand": "Pepsi", "category": "beverages"},
}


def _ensure_columns_exist(db):
    """Ensure SQLite/PostgreSQL table has `name` and `brand` columns."""
    try:
        db.execute(text("ALTER TABLE products ADD COLUMN name VARCHAR(255)"))
        db.commit()
    except Exception:
        db.rollback()

    try:
        db.execute(text("ALTER TABLE products ADD COLUMN brand VARCHAR(100)"))
        db.commit()
    except Exception:
        db.rollback()


def sync_product_names():
    """Populate name and brand for products if missing."""
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        _ensure_columns_exist(db)

        products = db.query(Product).all()
        updated_count = 0
        for p in products:
            mapping = REAL_PRODUCT_MAPPINGS.get(p.product_id)
            if mapping:
                if not p.name:
                    p.name = mapping["name"]
                    updated_count += 1
                if not p.brand:
                    p.brand = mapping["brand"]
                    updated_count += 1

        if updated_count > 0:
            db.commit()
            print(f"[OK] Enriched {updated_count} products with real fast-commerce names.")
    except Exception as e:
        print(f"[!] Name sync warning: {e}")
        db.rollback()
    finally:
        db.close()


def seed():
    """Seed the database from CSV if empty, then enrich names."""
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    _ensure_columns_exist(db)

    if db.query(Product).count() == 0:
        print("[*] Reading CSV...")
        df = pd.read_csv(DATA_PATH)
        df["date"] = pd.to_datetime(df["date"])

        latest = df.sort_values("date").groupby("product_id").last().reset_index()

        products = []
        for _, row in latest.iterrows():
            pid = int(row["product_id"])
            mapping = REAL_PRODUCT_MAPPINGS.get(pid, {})
            name_val = mapping.get("name", f"Product #{pid}")
            brand_val = mapping.get("brand", "Generic")

            products.append(
                Product(
                    product_id=pid,
                    name=name_val,
                    brand=brand_val,
                    category=str(row["category"]),
                    cost_price=float(row["cost_price"]),
                    mrp=float(row["mrp"]),
                    current_price=float(row["price"]),
                    stock_level=int(row["stock_level"]),
                    days_to_expiry=int(row["days_to_expiry"]),
                    season_factor=float(row["season_factor"]),
                )
            )

        db.bulk_save_objects(products)

        df_sorted = df.sort_values("date")
        recent = df_sorted.groupby("product_id").tail(30)
        product_costs = {int(row["product_id"]): float(row["cost_price"]) for _, row in latest.iterrows()}

        sales = []
        for _, row in recent.iterrows():
            pid = int(row["product_id"])
            cost = product_costs.get(pid, 0.0)
            price_sold = float(row["price"])
            units = int(row["units_sold"])
            profit = (price_sold - cost) * units

            sales.append(
                Sale(
                    product_id=pid,
                    price_sold=price_sold,
                    units_sold=units,
                    profit=profit,
                )
            )

        db.bulk_save_objects(sales)
        db.commit()
        print(f"[OK] Seeded {len(products)} products and {len(sales)} sales records.")

    db.close()

    # Enrich names if DB was already seeded previously without names
    sync_product_names()


if __name__ == "__main__":
    seed()

