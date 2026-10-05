"""
scripts/generate_synthetic_data.py — build the PriceIQ synthetic demo/training dataset.

    python scripts/generate_synthetic_data.py                     # 2025-09-01 .. 2026-09-30
    python scripts/generate_synthetic_data.py --end 2026-12-31    # re-anchor the history

Writes
    data/priceiq_catalog.json           product master data (SKU, brand, category, supplier,
                                        shelf life, sensitivities, reorder levels …)
    data/priceiq_synthetic_daily.csv    one row per (product, day): price, cost, stock,
                                        units sold, days to expiry, season factor

EVERYTHING here is simulated. Brand and product names are used as realistic
labels only; prices, costs, sales, stock and suppliers are invented by the
simulation below and must always be presented as "Synthetic/Training Data".

How a product's day is simulated
    demand = base × trend × season(month) × festival × weekday × price effect × freshness
    units  = NegativeBinomial(demand), capped by stock on hand (stock-outs censor sales)

      season     monthly profile (summer / winter / monsoon / harvest window …) blended
                 with the product's seasonal_sensitivity
      festival   per-festival category uplift × the product's festival_sensitivity,
                 with a two-day pre-festival ramp
      price      (price / reference price) ^ elasticity   — the "true" elasticity the
                 demand model and the elasticity estimator should be able to recover
      freshness  perishables sell slower on their last day of shelf life

    price   piecewise-constant shelf price (re-set every 1–3 weeks), short promotions,
            and expiry markdowns for short-life products; always cost < price ≤ MRP
    stock   (s, S) replenishment in batches; a batch carries the product's shelf life
            and unsold units are written off when it expires

The festival windows below mirror supabase/migrations (seasonal_events). Keep
them in sync so the demand model's event features line up with the data.
"""

from __future__ import annotations

import argparse
import json
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "data"
SEED = 2026

# ── Seasonality ─────────────────────────────────────────────────────────────
# Mid-month demand multipliers, January … December (India, IMD seasons).
PROFILES: dict[str, list[float]] = {
    "flat":          [1.0] * 12,
    "summer":        [0.75, 0.85, 1.10, 1.35, 1.50, 1.30, 1.00, 0.90, 0.90, 0.90, 0.80, 0.75],
    "winter":        [1.40, 1.25, 1.00, 0.80, 0.70, 0.70, 0.80, 0.85, 0.90, 1.00, 1.20, 1.40],
    "monsoon":       [0.90, 0.90, 0.90, 0.90, 0.95, 1.20, 1.40, 1.40, 1.25, 1.00, 0.90, 0.90],
    # harvest windows: the product is close to unavailable off-season
    "mango":         [0.03, 0.05, 0.40, 1.40, 2.00, 1.60, 0.50, 0.05, 0.03, 0.03, 0.03, 0.03],
    "grapes":        [1.50, 1.80, 1.80, 1.30, 0.60, 0.30, 0.20, 0.20, 0.20, 0.30, 0.50, 0.90],
    "post_monsoon":  [0.30, 0.20, 0.20, 0.20, 0.20, 0.30, 0.50, 0.80, 1.60, 1.90, 1.50, 0.70],
}

# (name, first day, last day) — same windows as the seasonal_events table.
FESTIVALS: list[tuple[str, str, str]] = [
    ("Onam", "2025-09-03", "2025-09-05"), ("Navratri", "2025-09-22", "2025-10-01"), ("Dussehra", "2025-10-02", "2025-10-02"),
    ("Diwali", "2025-10-16", "2025-10-21"), ("Christmas", "2025-12-22", "2025-12-25"), ("New Year", "2025-12-30", "2026-01-01"),
    ("Pongal", "2026-01-13", "2026-01-16"), ("Republic Day", "2026-01-26", "2026-01-26"), ("Holi", "2026-03-02", "2026-03-04"),
    ("Eid al-Fitr", "2026-03-18", "2026-03-21"), ("Eid al-Adha", "2026-05-26", "2026-05-28"),
    ("Independence Day", "2026-08-15", "2026-08-15"), ("Onam", "2026-08-24", "2026-08-26"),
    ("Raksha Bandhan", "2026-08-25", "2026-08-28"), ("Ganesh Chaturthi", "2026-09-12", "2026-09-14"),
    ("Navratri", "2026-10-11", "2026-10-19"), ("Dussehra", "2026-10-20", "2026-10-20"), ("Diwali", "2026-11-04", "2026-11-09"),
    ("Christmas", "2026-12-22", "2026-12-25"), ("New Year", "2026-12-30", "2027-01-01"),
]

# Demand uplift during a festival for a product with festival_sensitivity = 1.
FESTIVAL_UPLIFT: dict[str, dict[str, float]] = {
    "Diwali": {"snacks": .60, "dairy": .35, "staples": .35, "beverages": .30, "fruits": .25, "household": .40,
               "personal care": .15, "vegetables": .10},
    "Navratri": {"fruits": .35, "dairy": .25, "vegetables": .10, "staples": .15, "snacks": .10, "household": .15},
    "Dussehra": {"snacks": .25, "dairy": .20, "fruits": .20, "staples": .10},
    "Holi": {"snacks": .30, "beverages": .35, "dairy": .30, "staples": .15, "personal care": .10},
    "Eid al-Fitr": {"dairy": .30, "fruits": .25, "staples": .20, "beverages": .20, "snacks": .15},
    "Eid al-Adha": {"staples": .12, "vegetables": .12, "beverages": .10},
    "Christmas": {"snacks": .25, "dairy": .20, "beverages": .20, "fruits": .10},
    "New Year": {"beverages": .40, "snacks": .40, "dairy": .10},
    "Pongal": {"staples": .30, "dairy": .20, "fruits": .20, "vegetables": .15},
    "Onam": {"vegetables": .30, "fruits": .25, "dairy": .20, "staples": .20},
    "Raksha Bandhan": {"snacks": .35, "dairy": .20, "fruits": .10},
    "Ganesh Chaturthi": {"fruits": .25, "dairy": .20, "snacks": .20, "staples": .15, "household": .10},
    "Republic Day": {"snacks": .08, "beverages": .08},
    "Independence Day": {"snacks": .08, "beverages": .08},
}

# ── Category economics ──────────────────────────────────────────────────────
# cost_frac: cost as a share of MRP · disc: typical shelf discount off MRP
# elasticity: true own-price elasticity · weekend: weekend demand multiplier
# cover: days of demand ordered per replenishment (non-perishables) · lead: supplier lead time
CATEGORY = {
    "fruits":        dict(prefix="FRT", cost_frac=.58, disc=(.06, .18), elasticity=-1.3, weekend=1.25, cover=3,  lead=1),
    "vegetables":    dict(prefix="VEG", cost_frac=.55, disc=(.06, .18), elasticity=-1.1, weekend=1.20, cover=3,  lead=1),
    "dairy":         dict(prefix="DRY", cost_frac=.74, disc=(.01, .07), elasticity=-0.8, weekend=1.10, cover=4,  lead=1),
    "beverages":     dict(prefix="BEV", cost_frac=.68, disc=(.03, .12), elasticity=-1.4, weekend=1.30, cover=14, lead=3),
    "snacks":        dict(prefix="SNK", cost_frac=.66, disc=(.03, .12), elasticity=-1.6, weekend=1.30, cover=14, lead=3),
    "staples":       dict(prefix="STP", cost_frac=.76, disc=(.02, .08), elasticity=-0.7, weekend=1.15, cover=18, lead=3),
    "household":     dict(prefix="HHD", cost_frac=.64, disc=(.04, .14), elasticity=-1.0, weekend=1.20, cover=21, lead=4),
    "personal care": dict(prefix="PCR", cost_frac=.60, disc=(.04, .15), elasticity=-1.2, weekend=1.15, cover=21, lead=4),
}

SUPPLIERS = {
    "fruits":        [("Sahyadri Fresh Produce Co.", 1), ("Kaveri Agro Fresh", 1)],
    "vegetables":    [("Kaveri Agro Fresh", 1), ("Sahyadri Fresh Produce Co.", 1)],
    "dairy":         [("Deccan Dairy Logistics", 1), ("Bengaluru Chilled Distribution", 1)],
    "beverages":     [("Southern Beverages Trading", 3), ("Metro FMCG Distributors", 3)],
    "snacks":        [("Metro FMCG Distributors", 3), ("Udupi Snacks & Foods Supply", 2)],
    "staples":       [("Annapurna Staples Wholesale", 3), ("Metro FMCG Distributors", 3)],
    "household":     [("CleanHome Distributors", 4), ("Metro FMCG Distributors", 3)],
    "personal care": [("CarePlus Trading", 4), ("Metro FMCG Distributors", 3)],
}

# name, brand, subcategory, pack, MRP ₹, base units/day, season profile,
# seasonal / festival / weather sensitivity (0–1), shelf life in days (None = no expiry)
P = tuple
CATALOG: dict[str, list[P]] = {
    "fruits": [
        ("Banana Robusta", None, "Everyday Fruits", "6 pcs", 55, 46, "flat", .2, .5, .2, 5),
        ("Apple Shimla", None, "Everyday Fruits", "4 pcs", 189, 22, "winter", .6, .5, .2, 12),
        ("Mango Alphonso", None, "Seasonal Fruits", "2 pcs", 249, 30, "mango", 1.0, .3, .5, 5),
        ("Mango Banganapalli", None, "Seasonal Fruits", "1 kg", 149, 28, "mango", 1.0, .3, .5, 5),
        ("Watermelon Kiran", None, "Seasonal Fruits", "1 pc", 99, 26, "summer", .9, .2, .9, 7),
        ("Muskmelon", None, "Seasonal Fruits", "1 pc", 79, 14, "summer", .9, .2, .8, 5),
        ("Orange Nagpur", None, "Citrus", "1 kg", 119, 20, "winter", .8, .3, .3, 8),
        ("Pomegranate", None, "Everyday Fruits", "2 pcs", 169, 16, "flat", .3, .6, .2, 10),
        ("Papaya", None, "Everyday Fruits", "1 pc", 69, 15, "flat", .2, .2, .2, 5),
        ("Grapes Green Seedless", None, "Seasonal Fruits", "500 g", 99, 18, "grapes", .9, .2, .3, 5),
        ("Guava", None, "Everyday Fruits", "500 g", 59, 12, "winter", .6, .2, .2, 5),
        ("Pineapple", None, "Everyday Fruits", "1 pc", 89, 10, "summer", .5, .2, .4, 6),
        ("Tender Coconut", None, "Everyday Fruits", "1 pc", 59, 24, "summer", .7, .3, .9, 7),
        ("Sweet Lime (Mosambi)", None, "Citrus", "1 kg", 99, 14, "summer", .5, .2, .6, 10),
        ("Kiwi Imported", None, "Exotic Fruits", "3 pcs", 129, 9, "flat", .2, .2, .1, 12),
        ("Strawberry", None, "Seasonal Fruits", "200 g", 119, 8, "winter", .9, .4, .3, 3),
        ("Custard Apple", None, "Seasonal Fruits", "500 g", 109, 9, "post_monsoon", .9, .2, .2, 4),
        ("Lemon", None, "Citrus", "250 g", 39, 30, "summer", .6, .2, .8, 10),
        ("Chikoo (Sapota)", None, "Everyday Fruits", "500 g", 69, 9, "winter", .5, .2, .2, 5),
        ("Kimia Dates", "Lion", "Dry Fruits", "500 g", 199, 8, "flat", .2, 1.0, .1, 180),
    ],
    "vegetables": [
        ("Onion", None, "Roots & Bulbs", "1 kg", 45, 60, "flat", .1, .3, .2, 25),
        ("Potato", None, "Roots & Bulbs", "1 kg", 39, 55, "flat", .1, .3, .1, 30),
        ("Tomato Local", None, "Everyday Vegetables", "1 kg", 49, 58, "flat", .2, .3, .5, 6),
        ("Green Chilli", None, "Herbs & Seasoning", "100 g", 15, 35, "flat", .1, .2, .2, 7),
        ("Coriander Leaves", None, "Herbs & Seasoning", "100 g", 19, 40, "flat", .2, .3, .5, 3),
        ("Ginger", None, "Herbs & Seasoning", "200 g", 39, 22, "monsoon", .4, .2, .5, 15),
        ("Garlic", None, "Herbs & Seasoning", "200 g", 59, 20, "flat", .1, .2, .1, 30),
        ("Carrot Ooty", None, "Roots & Bulbs", "500 g", 45, 20, "winter", .6, .2, .2, 8),
        ("Cauliflower", None, "Everyday Vegetables", "1 pc", 49, 16, "winter", .7, .2, .2, 5),
        ("Cabbage", None, "Everyday Vegetables", "1 pc", 39, 14, "winter", .4, .1, .2, 8),
        ("Spinach (Palak)", None, "Leafy Greens", "250 g", 29, 18, "winter", .6, .2, .6, 2),
        ("Lady's Finger (Bhindi)", None, "Everyday Vegetables", "500 g", 45, 18, "summer", .5, .2, .3, 4),
        ("Brinjal", None, "Everyday Vegetables", "500 g", 39, 12, "flat", .2, .2, .2, 5),
        ("Capsicum Green", None, "Everyday Vegetables", "250 g", 39, 14, "flat", .2, .2, .2, 6),
        ("Cucumber", None, "Everyday Vegetables", "500 g", 35, 22, "summer", .7, .2, .8, 5),
        ("Green Peas", None, "Seasonal Vegetables", "500 g", 79, 10, "winter", .9, .3, .2, 4),
        ("French Beans", None, "Everyday Vegetables", "250 g", 39, 12, "flat", .2, .2, .3, 4),
        ("Bottle Gourd", None, "Gourds", "1 pc", 39, 9, "summer", .5, .1, .4, 6),
        ("Sweet Corn", None, "Seasonal Vegetables", "2 pcs", 49, 12, "monsoon", .8, .2, .6, 4),
        ("Button Mushroom", None, "Exotic Vegetables", "200 g", 59, 10, "flat", .2, .2, .2, 3),
    ],
    "dairy": [
        ("Amul Taaza Toned Milk", "Amul", "Milk", "500 ml", 29, 80, "flat", .1, .5, .2, 2),
        ("Nandini Toned Milk", "Nandini", "Milk", "500 ml", 24, 70, "flat", .1, .5, .2, 2),
        ("Amul Gold Full Cream Milk", "Amul", "Milk", "500 ml", 35, 45, "flat", .1, .6, .2, 2),
        ("Nandini Curd", "Nandini", "Curd & Yogurt", "500 g", 30, 40, "summer", .6, .3, .7, 7),
        ("Amul Masti Dahi", "Amul", "Curd & Yogurt", "400 g", 35, 30, "summer", .6, .3, .7, 10),
        ("Amul Butter", "Amul", "Butter & Cheese", "100 g", 62, 28, "flat", .2, .5, .1, 120),
        ("Amul Cheese Slices", "Amul", "Butter & Cheese", "200 g", 145, 12, "flat", .1, .3, .1, 150),
        ("Amul Malai Paneer", "Amul", "Paneer", "200 g", 95, 18, "flat", .2, .8, .1, 15),
        ("Milky Mist Paneer", "Milky Mist", "Paneer", "200 g", 105, 12, "flat", .2, .8, .1, 15),
        ("Amul Pure Ghee", "Amul", "Ghee", "500 ml", 330, 9, "winter", .3, 1.0, .1, 270),
        ("Nandini Pure Ghee", "Nandini", "Ghee", "500 ml", 315, 8, "winter", .3, 1.0, .1, 270),
        ("Epigamia Greek Yogurt Strawberry", "Epigamia", "Curd & Yogurt", "85 g", 50, 14, "summer", .4, .1, .5, 15),
        ("Amul Masti Buttermilk", "Amul", "Dairy Drinks", "200 ml", 15, 30, "summer", .9, .2, .9, 90),
        ("Amul Kool Kesar", "Amul", "Dairy Drinks", "180 ml", 25, 18, "summer", .7, .3, .7, 120),
        ("Eggoz Farm Fresh Eggs", "Eggoz", "Eggs", "6 pcs", 72, 40, "winter", .4, .3, .2, 14),
        ("Amul Vanilla Magic Ice Cream", "Amul", "Ice Cream", "1 L", 190, 11, "summer", 1.0, .4, 1.0, 270),
        ("Kwality Wall's Cornetto Double Chocolate", "Kwality Wall's", "Ice Cream", "105 ml", 40, 20, "summer", 1.0, .2, 1.0, 270),
        ("Amul Mithai Mate Condensed Milk", "Amul", "Dessert Ingredients", "400 g", 135, 7, "flat", .2, 1.0, .1, 240),
        ("Amul Fresh Cream", "Amul", "Dessert Ingredients", "250 ml", 70, 10, "flat", .2, .7, .1, 120),
        ("Yakult Probiotic Drink", "Yakult", "Dairy Drinks", "5 x 65 ml", 90, 12, "flat", .1, .1, .1, 30),
    ],
    "beverages": [
        ("Coca-Cola", "Coca-Cola", "Soft Drinks", "750 ml", 40, 34, "summer", .7, .7, .8, 150),
        ("Thums Up", "Thums Up", "Soft Drinks", "750 ml", 40, 32, "summer", .7, .7, .8, 150),
        ("Sprite", "Sprite", "Soft Drinks", "750 ml", 40, 28, "summer", .8, .6, .9, 150),
        ("Pepsi", "Pepsi", "Soft Drinks", "750 ml", 40, 24, "summer", .7, .7, .8, 150),
        ("Maaza Mango Drink", "Maaza", "Fruit Drinks", "600 ml", 42, 22, "summer", .9, .4, .8, 150),
        ("Frooti Mango Drink", "Frooti", "Fruit Drinks", "600 ml", 40, 20, "summer", .9, .4, .8, 150),
        ("Paper Boat Aam Panna", "Paper Boat", "Fruit Drinks", "200 ml", 30, 14, "summer", 1.0, .2, .9, 150),
        ("Paper Boat Coconut Water", "Paper Boat", "Fruit Drinks", "200 ml", 45, 15, "summer", .7, .1, .8, 180),
        ("Real Mixed Fruit Juice", "Real", "Juices", "1 L", 125, 14, "summer", .5, .5, .5, 180),
        ("Tropicana Orange Delight", "Tropicana", "Juices", "1 L", 135, 12, "summer", .5, .5, .5, 180),
        ("Bisleri Packaged Water", "Bisleri", "Water", "1 L", 20, 50, "summer", .7, .2, .9, 180),
        ("Kinley Club Soda", "Kinley", "Soft Drinks", "750 ml", 20, 16, "summer", .6, .7, .6, 150),
        ("Red Bull Energy Drink", "Red Bull", "Energy Drinks", "250 ml", 125, 9, "flat", .2, .4, .2, 365),
        ("Sting Energy Drink", "Sting", "Energy Drinks", "250 ml", 20, 26, "summer", .4, .3, .4, 180),
        ("Tata Tea Gold", "Tata Tea", "Tea & Coffee", "500 g", 320, 10, "winter", .5, .2, .5, 365),
        ("Brooke Bond Red Label Tea", "Brooke Bond", "Tea & Coffee", "500 g", 285, 11, "winter", .5, .2, .5, 365),
        ("Nescafe Classic Instant Coffee", "Nescafe", "Tea & Coffee", "50 g", 195, 12, "winter", .5, .2, .4, 540),
        ("Bru Instant Coffee", "Bru", "Tea & Coffee", "100 g", 215, 9, "winter", .5, .2, .4, 540),
        ("Cadbury Bournvita", "Cadbury", "Health Drinks", "500 g", 255, 9, "winter", .4, .2, .2, 365),
        ("Rooh Afza Sharbat", "Hamdard", "Squash & Syrups", "750 ml", 175, 7, "summer", 1.0, .9, .8, 365),
    ],
    "snacks": [
        ("Lay's Classic Salted", "Lay's", "Chips & Crisps", "52 g", 20, 40, "flat", .2, .5, .2, 120),
        ("Lay's India's Magic Masala", "Lay's", "Chips & Crisps", "52 g", 20, 42, "flat", .2, .5, .2, 120),
        ("Kurkure Masala Munch", "Kurkure", "Chips & Crisps", "90 g", 20, 38, "monsoon", .3, .5, .4, 120),
        ("Bingo! Mad Angles Achaari Masti", "Bingo!", "Chips & Crisps", "66 g", 20, 26, "flat", .2, .4, .2, 120),
        ("Pringles Original", "Pringles", "Chips & Crisps", "107 g", 110, 8, "flat", .1, .5, .1, 365),
        ("Haldiram's Aloo Bhujia", "Haldiram's", "Namkeen", "200 g", 55, 22, "monsoon", .3, .7, .3, 180),
        ("Haldiram's Moong Dal", "Haldiram's", "Namkeen", "200 g", 60, 16, "flat", .2, .6, .2, 180),
        ("Haldiram's Navrattan Mixture", "Haldiram's", "Namkeen", "200 g", 55, 14, "flat", .2, .7, .2, 180),
        ("Haldiram's Soan Papdi", "Haldiram's", "Sweets", "250 g", 85, 9, "flat", .2, 1.0, .1, 180),
        ("Bikano Kaju Katli", "Bikano", "Sweets", "250 g", 280, 6, "flat", .2, 1.0, .1, 60),
        ("Parle-G Gold Biscuits", "Parle", "Biscuits", "1 kg", 160, 15, "flat", .1, .3, .1, 270),
        ("Britannia Good Day Cashew", "Britannia", "Biscuits", "200 g", 45, 24, "flat", .1, .4, .1, 270),
        ("Britannia Marie Gold", "Britannia", "Biscuits", "250 g", 40, 22, "winter", .2, .2, .2, 270),
        ("Oreo Vanilla Creme", "Cadbury", "Biscuits", "120 g", 35, 20, "flat", .1, .3, .1, 270),
        ("Sunfeast Dark Fantasy Choco Fills", "Sunfeast", "Biscuits", "75 g", 40, 18, "flat", .1, .4, .1, 270),
        ("Cadbury Dairy Milk Silk", "Cadbury", "Chocolates", "60 g", 85, 20, "winter", .3, .8, .5, 270),
        ("Cadbury Celebrations Gift Pack", "Cadbury", "Chocolates", "130 g", 150, 7, "flat", .2, 1.0, .3, 270),
        ("Nestle KitKat", "Nestle", "Chocolates", "38.5 g", 30, 24, "winter", .3, .5, .5, 270),
        ("Maggi 2-Minute Masala Noodles", "Maggi", "Noodles", "280 g", 60, 34, "monsoon", .5, .2, .6, 270),
        ("Happilo California Almonds", "Happilo", "Dry Fruits", "200 g", 265, 7, "winter", .4, .9, .1, 240),
    ],
    "staples": [
        ("Aashirvaad Shudh Chakki Atta", "Aashirvaad", "Atta & Flours", "5 kg", 265, 16, "flat", .1, .4, .1, 120),
        ("Pillsbury Chakki Fresh Atta", "Pillsbury", "Atta & Flours", "5 kg", 255, 9, "flat", .1, .4, .1, 120),
        ("India Gate Basmati Rice Classic", "India Gate", "Rice", "1 kg", 215, 10, "flat", .1, .8, .1, 540),
        ("Daawat Rozana Basmati Rice", "Daawat", "Rice", "5 kg", 449, 7, "flat", .1, .7, .1, 540),
        ("Fortune Sona Masoori Rice", "Fortune", "Rice", "5 kg", 399, 12, "flat", .1, .6, .1, 540),
        ("Tata Sampann Toor Dal", "Tata Sampann", "Dals & Pulses", "1 kg", 189, 14, "flat", .1, .4, .1, 365),
        ("Tata Sampann Moong Dal", "Tata Sampann", "Dals & Pulses", "500 g", 95, 10, "flat", .1, .4, .1, 365),
        ("Tata Sampann Chana Dal", "Tata Sampann", "Dals & Pulses", "1 kg", 115, 9, "flat", .1, .6, .1, 365),
        ("Tata Salt", "Tata", "Salt & Sugar", "1 kg", 30, 26, "flat", .0, .2, .0, 730),
        ("Madhur Pure Sugar", "Madhur", "Salt & Sugar", "1 kg", 58, 24, "flat", .1, .9, .1, 730),
        ("Fortune Sunlite Sunflower Oil", "Fortune", "Edible Oils", "1 L", 165, 18, "flat", .1, .9, .1, 270),
        ("Saffola Gold Blended Oil", "Saffola", "Edible Oils", "1 L", 199, 10, "flat", .1, .7, .1, 270),
        ("Dhara Kachi Ghani Mustard Oil", "Dhara", "Edible Oils", "1 L", 185, 7, "winter", .3, .5, .1, 270),
        ("MDH Garam Masala", "MDH", "Spices", "100 g", 92, 9, "flat", .1, .7, .1, 365),
        ("Everest Turmeric Powder", "Everest", "Spices", "200 g", 76, 10, "flat", .1, .4, .1, 365),
        ("MTR Rava (Sooji)", "MTR", "Atta & Flours", "500 g", 42, 11, "flat", .1, .8, .1, 180),
        ("Rajdhani Besan", "Rajdhani", "Atta & Flours", "500 g", 70, 11, "monsoon", .3, .9, .3, 180),
        ("24 Mantra Organic Jaggery", "24 Mantra", "Salt & Sugar", "500 g", 65, 7, "winter", .4, .9, .1, 365),
        ("Britannia Whole Wheat Bread", "Britannia", "Bread & Bakery", "400 g", 50, 30, "flat", .1, .2, .1, 5),
        ("Tata Sampann Thick Poha", "Tata Sampann", "Breakfast", "500 g", 45, 9, "flat", .1, .3, .1, 270),
    ],
    "household": [
        ("Surf Excel Easy Wash Detergent Powder", "Surf Excel", "Laundry", "1 kg", 150, 12, "flat", .1, .5, .2, None),
        ("Ariel Matic Front Load Detergent", "Ariel", "Laundry", "1 kg", 260, 7, "flat", .1, .5, .2, None),
        ("Tide Plus Double Power Detergent", "Tide", "Laundry", "1 kg", 125, 11, "flat", .1, .5, .2, None),
        ("Comfort After Wash Fabric Conditioner", "Comfort", "Laundry", "860 ml", 235, 6, "monsoon", .3, .3, .5, None),
        ("Rin Detergent Bar", "Rin", "Laundry", "250 g", 25, 15, "flat", .0, .2, .1, None),
        ("Vim Dishwash Liquid Lemon", "Vim", "Dishwashing", "500 ml", 115, 13, "flat", .1, .6, .0, None),
        ("Vim Dishwash Bar", "Vim", "Dishwashing", "300 g", 30, 22, "flat", .0, .5, .0, None),
        ("Pril Dishwash Liquid", "Pril", "Dishwashing", "425 ml", 105, 8, "flat", .1, .5, .0, None),
        ("Scotch-Brite Scrub Pad", "Scotch-Brite", "Dishwashing", "3 pcs", 55, 12, "flat", .0, .5, .0, None),
        ("Harpic Power Plus Toilet Cleaner", "Harpic", "Cleaners", "500 ml", 105, 12, "flat", .1, .7, .1, None),
        ("Lizol Disinfectant Floor Cleaner Citrus", "Lizol", "Cleaners", "500 ml", 115, 12, "monsoon", .3, .8, .5, None),
        ("Colin Glass Cleaner", "Colin", "Cleaners", "500 ml", 110, 7, "flat", .1, 1.0, .1, None),
        ("Domex Disinfectant Floor Cleaner", "Domex", "Cleaners", "500 ml", 95, 8, "monsoon", .3, .7, .5, None),
        ("Good Knight Gold Flash Refill", "Good Knight", "Repellents", "45 ml", 85, 14, "monsoon", .9, .1, 1.0, None),
        ("All Out Ultra Refill", "All Out", "Repellents", "45 ml", 89, 12, "monsoon", .9, .1, 1.0, None),
        ("Odonil Room Freshener Block", "Odonil", "Fresheners", "48 g", 55, 10, "monsoon", .3, .6, .4, None),
        ("Cycle Three in One Agarbatti", "Cycle", "Pooja Needs", "100 g", 70, 12, "flat", .1, 1.0, .0, None),
        ("Freshwrapp Aluminium Foil", "Freshwrapp", "Kitchen Disposables", "9 m", 99, 8, "flat", .1, .7, .0, None),
        ("Origami Kitchen Towel", "Origami", "Kitchen Disposables", "2 rolls", 110, 7, "flat", .1, .5, .0, None),
        ("Duracell AA Alkaline Batteries", "Duracell", "Utilities", "4 pcs", 190, 5, "flat", .1, .8, .0, None),
    ],
    "personal care": [
        ("Colgate Strong Teeth Toothpaste", "Colgate", "Oral Care", "200 g", 125, 16, "flat", .0, .1, .0, 730),
        ("Pepsodent Germicheck Toothpaste", "Pepsodent", "Oral Care", "150 g", 95, 10, "flat", .0, .1, .0, 730),
        ("Sensodyne Fresh Mint Toothpaste", "Sensodyne", "Oral Care", "70 g", 145, 7, "flat", .0, .1, .0, 730),
        ("Oral-B Pro-Health Toothbrush", "Oral-B", "Oral Care", "1 pc", 55, 9, "flat", .0, .1, .0, None),
        ("Dove Cream Beauty Bathing Bar", "Dove", "Bath & Body", "3 x 100 g", 195, 12, "winter", .4, .3, .5, 730),
        ("Lifebuoy Total 10 Soap", "Lifebuoy", "Bath & Body", "4 x 125 g", 150, 14, "monsoon", .3, .2, .4, 730),
        ("Pears Pure & Gentle Soap", "Pears", "Bath & Body", "3 x 125 g", 180, 9, "winter", .7, .3, .7, 730),
        ("Dettol Original Handwash", "Dettol", "Bath & Body", "200 ml", 99, 12, "monsoon", .5, .1, .6, 730),
        ("Dettol Antiseptic Liquid", "Dettol", "Health & Hygiene", "250 ml", 150, 7, "monsoon", .4, .1, .5, 1095),
        ("Head & Shoulders Anti-Dandruff Shampoo", "Head & Shoulders", "Hair Care", "340 ml", 365, 6, "winter", .4, .2, .4, 1095),
        ("Clinic Plus Strong & Long Shampoo", "Clinic Plus", "Hair Care", "355 ml", 215, 8, "flat", .1, .2, .1, 1095),
        ("Parachute Coconut Hair Oil", "Parachute", "Hair Care", "250 ml", 130, 12, "winter", .4, .3, .4, 540),
        ("Nivea Nourishing Body Lotion", "Nivea", "Skin Care", "200 ml", 275, 7, "winter", 1.0, .2, .8, 900),
        ("Vaseline Original Petroleum Jelly", "Vaseline", "Skin Care", "100 ml", 120, 7, "winter", 1.0, .1, .8, 1095),
        ("Boroplus Antiseptic Cream", "Boroplus", "Skin Care", "40 ml", 85, 8, "winter", .9, .1, .8, 1095),
        ("Himalaya Purifying Neem Face Wash", "Himalaya", "Skin Care", "100 ml", 165, 9, "summer", .4, .2, .5, 1095),
        ("Lakme Sun Expert SPF 50 Sunscreen", "Lakme", "Skin Care", "50 ml", 349, 6, "summer", 1.0, .1, .9, 730),
        ("Nycil Prickly Heat Powder", "Nycil", "Skin Care", "150 g", 155, 7, "summer", 1.0, .0, 1.0, 1095),
        ("Nivea Men Fresh Active Deodorant", "Nivea", "Fragrances", "150 ml", 249, 8, "summer", .6, .4, .7, 1095),
        ("Whisper Ultra Clean Sanitary Pads XL", "Whisper", "Health & Hygiene", "15 pads", 185, 10, "flat", .0, .0, .0, 1095),
    ],
}


def season_multiplier(day: pd.Timestamp, profile: str, sensitivity: float) -> float:
    """Profile value interpolated between mid-months, blended by sensitivity."""
    prof = PROFILES[profile]
    pos = (day.month - 1) + (day.day - 15) / 30.0          # 0 = mid-January
    lo = int(np.floor(pos)) % 12
    frac = pos - np.floor(pos)
    value = prof[lo] * (1 - frac) + prof[(lo + 1) % 12] * frac
    return float(max(0.02, 1 + sensitivity * (value - 1)))


def festival_multiplier(day: pd.Timestamp, category: str, sensitivity: float, windows) -> float:
    best = 0.0
    for name, start, end in windows:
        base = FESTIVAL_UPLIFT.get(name, {}).get(category, 0.0)
        if not base:
            continue
        if start <= day <= end:
            best = max(best, base)
        elif timedelta(0) < start - day <= timedelta(days=2):   # pre-festival shopping ramp
            best = max(best, base * 0.5)
    return 1 + best * sensitivity


def retail_round(price: float, mrp: float) -> float:
    """Shelf prices end in .00 (₹50+) or .00/.50 (below ₹50)."""
    step = 1.0 if mrp >= 50 else 0.5
    return round(round(price / step) * step, 2)


def build_catalog(rng: np.random.Generator) -> list[dict]:
    products = []
    pid = 0
    for category, rows in CATALOG.items():
        cfg = CATEGORY[category]
        for n, (name, brand, sub, pack, mrp, base, profile, s_sens, f_sens, w_sens, shelf) in enumerate(rows, start=1):
            supplier, lead = SUPPLIERS[category][n % 2]
            cost = round(mrp * (cfg["cost_frac"] + rng.uniform(-0.03, 0.03)), 2)
            disc = rng.uniform(*cfg["disc"])
            perishable = shelf is not None and shelf <= 30
            products.append({
                "product_id": pid, "sku": f"{cfg['prefix']}-{n:03d}", "name": f"{name} {pack}".strip(), "brand": brand,
                "category": category, "subcategory": sub, "pack_size": pack, "supplier": supplier, "lead_time_days": lead,
                "mrp": float(mrp), "cost_price": cost, "list_discount": round(float(disc), 4),
                "base_daily_demand": float(base), "true_elasticity": round(float(cfg["elasticity"] + rng.uniform(-0.3, 0.3)), 3),
                "season_profile": profile, "seasonal_sensitivity": s_sens, "festival_sensitivity": f_sens,
                "weather_sensitivity": w_sens, "shelf_life_days": shelf, "is_perishable": perishable,
                "reorder_level": int(np.ceil(base * (lead + 1.5))),
                "safety_stock": int(np.ceil(1.65 * np.sqrt(base) * np.sqrt(lead))),
                "store": pid % 2,      # alternate products between the two demo stores
            })
            pid += 1
    return products


def simulate(p: dict, days: pd.DatetimeIndex, windows, rng: np.random.Generator) -> list[tuple]:
    cfg = CATEGORY[p["category"]]
    mrp, cost0, shelf = p["mrp"], p["cost_price"], p["shelf_life_days"]
    ref_price = mrp * (1 - p["list_discount"])
    produce = p["category"] in ("fruits", "vegetables")
    growth = rng.uniform(0.0, 0.08)                    # demand growth over the period
    price_floor_frac = 1 / 0.88                        # keep ≥ 12% gross margin outside clearance

    rows = []
    regime_price, regime_left = None, 0
    promo_left, promo_depth = 0, 0.0
    stock, dte, delay = 0, None, 0
    for i, day in enumerate(days):
        season = season_multiplier(day, p["season_profile"], p["seasonal_sensitivity"])
        # Produce is cheaper to buy in season (more supply) and dearer off season.
        cost = round(cost0 * float(np.clip(1 - 0.12 * (season - 1), 0.85, 1.12)), 2) if produce else cost0
        floor = min(cost * price_floor_frac, mrp)

        expected = p["base_daily_demand"] * season

        # ── replenishment (start of day) ────────────────────────────────────
        expired = dte is not None and dte < 0
        if expired:
            stock = 0                                  # unsold batch written off
        reorder_point = expected * (p["lead_time_days"] + 1.5)
        if stock <= reorder_point or expired:
            if delay == 0 and rng.random() < 0.05 and not expired:
                delay = int(rng.integers(1, 3))        # occasional late delivery ⇒ real stock-outs
            if delay > 0:
                delay -= 1
            else:
                cover = min(cfg["cover"], max(2, int(shelf * 0.7))) if shelf else cfg["cover"]
                target = int(np.ceil(expected * cover * rng.uniform(0.9, 1.25))) + p["safety_stock"]
                if target > stock:
                    stock = target
                    dte = shelf                        # the new batch sets the expiry clock
        # ── shelf price ─────────────────────────────────────────────────────
        if regime_left <= 0:
            regime_price = ref_price * (1 + rng.uniform(-0.045, 0.045))
            regime_left = int(rng.integers(7, 22))
        regime_left -= 1
        if promo_left <= 0 and rng.random() < 0.035:
            promo_left, promo_depth = int(rng.integers(3, 7)), rng.uniform(0.07, 0.16)
        price = regime_price * (1 - promo_depth) if promo_left > 0 else regime_price
        promo_left -= 1
        price = max(price, floor)
        if p["is_perishable"] and shelf <= 10 and dte is not None and dte <= 1 and stock > expected:
            price = max(price * 0.82, cost * 1.02)     # last-day clearance markdown
        price = min(retail_round(price, mrp), mrp)
        if price <= cost:
            price = min(retail_round(cost * 1.03 + 0.5, mrp), mrp)

        # ── demand ──────────────────────────────────────────────────────────
        mu = (p["base_daily_demand"] * (1 + growth * i / len(days)) * season
              * festival_multiplier(day, p["category"], p["festival_sensitivity"], windows)
              * (cfg["weekend"] if day.dayofweek >= 5 else 1.0)
              * (price / ref_price) ** p["true_elasticity"])
        if p["is_perishable"] and dte is not None and dte <= 1:
            mu *= 0.85                                 # shoppers avoid last-day stock
        k = 12.0                                       # negative-binomial dispersion
        units = int(rng.negative_binomial(k, k / (k + mu))) if mu > 0 else 0
        sold = min(units, stock)

        rows.append((p["product_id"], p["category"], cost, mrp, price, day.date().isoformat(), day.dayofweek, day.month,
                     int(day.dayofweek >= 5), stock, sold, "" if dte is None else max(dte, 0), round(season, 3)))
        stock -= sold
        if dte is not None:
            dte -= 1
    return rows


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--start", default="2025-09-01")
    ap.add_argument("--end", default="2026-09-30")
    args = ap.parse_args()

    rng = np.random.default_rng(SEED)
    days = pd.date_range(args.start, args.end, freq="D")
    windows = [(n, pd.Timestamp(a), pd.Timestamp(b)) for n, a, b in FESTIVALS]
    catalog = build_catalog(rng)

    rows: list[tuple] = []
    for p in catalog:
        rows += simulate(p, days, windows, rng)
    df = pd.DataFrame(rows, columns=["product_id", "category", "cost_price", "mrp", "price", "date", "day_of_week", "month",
                                     "is_weekend", "stock_level", "units_sold", "days_to_expiry", "season_factor"])

    DATA_DIR.mkdir(exist_ok=True)
    csv_path = DATA_DIR / "priceiq_synthetic_daily.csv"
    df.to_csv(csv_path, index=False, lineterminator="\n")
    suppliers = sorted({(s, lead) for pairs in SUPPLIERS.values() for s, lead in pairs})
    meta = {
        "_note": "SYNTHETIC DATA. Generated by backend/scripts/generate_synthetic_data.py. Brand/product names are "
                 "labels only; prices, costs, sales, stock levels and suppliers are simulated and are not real-world data.",
        "generated_on": date.today().isoformat(), "seed": SEED,
        "date_range": [args.start, args.end],
        "suppliers": [{"name": s, "lead_time_days": lead} for s, lead in suppliers],
        "products": catalog,
    }
    (DATA_DIR / "priceiq_catalog.json").write_text(json.dumps(meta, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")

    print(f"[OK] {len(catalog)} products x {len(days)} days = {len(df):,} rows -> {csv_path}")  # ASCII: Windows consoles
    print(df.groupby("category").agg(products=("product_id", "nunique"), units_per_day=("units_sold", "mean"),
                                     avg_price=("price", "mean"), stockout_days=("stock_level", lambda s: (s == 0).mean()))
            .round(3).to_string())


if __name__ == "__main__":
    main()
