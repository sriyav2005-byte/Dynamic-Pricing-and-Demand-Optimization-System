"""
ml/train_demand_model.py — XGBoost Demand Prediction Training Script
=====================================================================
Trains an XGBoost regression model to predict `units_sold` from
product context and temporal features.

Dataset: data/dynamic_pricing_data.csv
  - 9,000 rows × 13 columns
  - One row per (product, date) pair
  - All feature columns are native — no synthetic data needed

Features used (11 total)
-------------------------
  product_id      : Identifies the product (treated as a numeric category)
  category_enc    : Integer-encoded category (beverages=0, dairy=1, etc.)
  price           : Sale price on that day
  day_of_week     : 0 (Mon) … 6 (Sun)
  month           : 1–12
  is_weekend      : 1 if Saturday/Sunday, else 0
  stock_level     : Units in inventory that day
  days_to_expiry  : Days until expiry that day
  season_factor   : Seasonal multiplier (e.g. 1.1 = +10% demand)
  cost_price      : Wholesale cost (product-level constant)
  mrp             : Maximum Retail Price (product-level constant)

Target: units_sold

Model: XGBoost XGBRegressor (gradient boosted trees)
  - 300 trees, max depth 6, learning rate 0.1
  - 80/20 train-test split, random seed 42

Outputs
-------
  models/demand_model_xgb.pkl   — serialised XGBoost model
  models/category_encoder.pkl  — serialised LabelEncoder for category strings

Run this script once before starting the server:
    python backend/ml/train_demand_model.py
"""

import sys
import os

# Allow running from the project root without a package install
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

import pandas as pd
import numpy as np
import pickle
import xgboost as xgb
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_squared_error, mean_absolute_error, r2_score
from sklearn.preprocessing import LabelEncoder

# ── File paths (relative to project root) ───────────────────────────────────
DATA_PATH    = os.path.join(os.path.dirname(__file__), "..", "..", "data",   "dynamic_pricing_data.csv")
MODEL_PATH   = os.path.join(os.path.dirname(__file__), "..", "..", "models", "demand_model_xgb.pkl")
ENCODER_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "models", "category_encoder.pkl")


def train():
    """
    Full training pipeline:
      1. Load and clean the dataset
      2. Encode the `category` column as integers
      3. Select features and target
      4. Train/test split (80/20)
      5. Fit XGBoost with early-stopping-compatible settings
      6. Print evaluation metrics
      7. Save model and encoder to disk
    """
    print("[*] Loading dataset...")
    df = pd.read_csv(DATA_PATH)
    print(f"    Rows: {len(df)}, Columns: {list(df.columns)}")

    # Drop any rows with missing values (shouldn't be many in this dataset)
    df = df.dropna()

    # ── Category encoding ────────────────────────────────────────────────────
    # XGBoost needs numeric inputs, so we encode strings → integers.
    # The fitted encoder is saved alongside the model so the API can
    # apply the same encoding at inference time.
    le = LabelEncoder()
    df["category_enc"] = le.fit_transform(df["category"])

    # ── Feature and target selection ─────────────────────────────────────────
    # Must exactly match the FEATURES list in demand_predictor.py
    FEATURES = [
        "product_id",
        "category_enc",
        "price",
        "day_of_week",
        "month",
        "is_weekend",
        "stock_level",
        "days_to_expiry",
        "season_factor",
        "cost_price",
        "mrp",
    ]
    TARGET = "units_sold"

    X = df[FEATURES]
    y = df[TARGET]

    # 80% training data, 20% held out for evaluation
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42
    )

    # ── Model training ───────────────────────────────────────────────────────
    print("[*] Training XGBoost model...")
    model = xgb.XGBRegressor(
        n_estimators=300,        # number of boosting rounds
        max_depth=6,             # maximum tree depth — controls overfitting
        learning_rate=0.1,       # shrinkage factor applied to each tree's contribution
        subsample=0.8,           # fraction of training rows used per tree (prevents overfitting)
        colsample_bytree=0.8,    # fraction of features used per tree (prevents overfitting)
        random_state=42,
        verbosity=0,             # suppress XGBoost's own console output
    )
    model.fit(X_train, y_train, eval_set=[(X_test, y_test)], verbose=False)

    # ── Evaluation ───────────────────────────────────────────────────────────
    y_pred = model.predict(X_test)
    rmse = np.sqrt(mean_squared_error(y_test, y_pred))
    mae  = mean_absolute_error(y_test, y_pred)
    r2   = r2_score(y_test, y_pred)

    print("\n[=] Model Performance (test set):")
    print(f"    RMSE : {rmse:.4f}  (avg prediction error in units)")
    print(f"    MAE  : {mae:.4f}  (mean absolute error)")
    print(f"    R2   : {r2:.4f}  (fraction of variance explained; 1.0 = perfect)")

    # ── Save artifacts ───────────────────────────────────────────────────────
    os.makedirs(os.path.dirname(MODEL_PATH), exist_ok=True)

    with open(MODEL_PATH, "wb") as f:
        pickle.dump(model, f)

    with open(ENCODER_PATH, "wb") as f:
        pickle.dump(le, f)

    print(f"\n[OK] Model saved   -> {MODEL_PATH}")
    print(f"[OK] Encoder saved -> {ENCODER_PATH}")
    return model, le


if __name__ == "__main__":
    train()
