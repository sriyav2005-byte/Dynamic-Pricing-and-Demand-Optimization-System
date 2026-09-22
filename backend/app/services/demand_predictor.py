"""
services/demand_predictor.py — XGBoost Demand Prediction Service
=================================================================
Loads the pre-trained XGBoost model and LabelEncoder at startup
and exposes a single `predict()` function used throughout the system.

The model was trained by backend/ml/train_demand_model.py on the
dynamic_pricing_data.csv dataset (9,000 rows × 11 features).

Feature list (must match training order exactly):
    product_id, category_enc, price, day_of_week, month,
    is_weekend, stock_level, days_to_expiry, season_factor,
    cost_price, mrp

Output: predicted unit sales (float ≥ 0)
"""

import os
import pickle
import datetime
import numpy as np
import pandas as pd
from typing import Optional

# ── Paths to saved model artifacts ──────────────────────────────────────────
# Navigating from services/ → app/ → backend/ → project root → models/
MODEL_PATH = os.path.join(
    os.path.dirname(__file__), "..", "..", "..", "models", "demand_model_xgb.pkl"
)
ENCODER_PATH = os.path.join(
    os.path.dirname(__file__), "..", "..", "..", "models", "category_encoder.pkl"
)

# Feature columns — order MUST match what the model was trained on
FEATURES = [
    "product_id",
    "category_enc",    # integer-encoded category (via LabelEncoder)
    "price",
    "day_of_week",     # 0 = Monday … 6 = Sunday
    "month",           # 1–12
    "is_weekend",      # 1 if Saturday/Sunday, else 0
    "stock_level",
    "days_to_expiry",
    "season_factor",   # e.g. 1.1 means 10% seasonal demand boost
    "cost_price",
    "mrp",
]


class DemandPredictor:
    """
    Wrapper around the XGBoost regression model.

    Loaded once as a singleton (`get_predictor()` below) so the model
    doesn't get re-read from disk on every API call.
    """

    def __init__(self):
        self.model = None
        self.encoder = None
        self._load()

    def _load(self):
        """Deserialise the XGBoost model and category LabelEncoder from disk."""
        if os.path.exists(MODEL_PATH):
            with open(MODEL_PATH, "rb") as f:
                self.model = pickle.load(f)

        if os.path.exists(ENCODER_PATH):
            with open(ENCODER_PATH, "rb") as f:
                self.encoder = pickle.load(f)

    def _encode_category(self, category: str) -> int:
        """
        Convert a category string → integer using the saved LabelEncoder.
        Falls back to 0 for unseen categories (graceful degradation).
        """
        if self.encoder is None:
            return 0
        try:
            return int(self.encoder.transform([category])[0])
        except Exception:
            return 0  # unknown category defaults to 0

    def predict(
        self,
        product_id: int,
        category: str,
        price: float,
        cost_price: float,
        mrp: float,
        stock_level: int,
        days_to_expiry: int,
        season_factor: float,
        day_of_week: Optional[int] = None,
        month: Optional[int] = None,
        is_weekend: Optional[int] = None,
    ) -> float:
        """
        Predict units sold for a given product at a given price.

        Parameters
        ----------
        product_id, category, price, cost_price, mrp,
        stock_level, days_to_expiry, season_factor :
            Product context features fed to the model.
        day_of_week, month, is_weekend :
            Temporal features. If None, today's date is used automatically.

        Returns
        -------
        float
            Predicted demand (units sold). Always ≥ 0.
        """
        # Auto-fill temporal features from today's date if not provided
        if day_of_week is None or month is None or is_weekend is None:
            now = datetime.datetime.now()
            day_of_week = now.weekday()           # 0=Mon … 6=Sun
            month = now.month                     # 1–12
            is_weekend = 1 if day_of_week >= 5 else 0

        cat_enc = self._encode_category(category)

        # Build a single-row DataFrame with the exact feature order
        row = pd.DataFrame(
            [[product_id, cat_enc, price, day_of_week, month,
              is_weekend, stock_level, days_to_expiry, season_factor,
              cost_price, mrp]],
            columns=FEATURES,
        )

        # If model file is missing (e.g. training not yet run), use a
        # simple linear heuristic so the API still returns sensible values.
        if self.model is None:
            base = max(1, 30 - (price - cost_price) * 0.1)
            return float(base)

        pred = self.model.predict(row)[0]
        return max(0.0, float(pred))   # clip to non-negative


# ── Singleton helper ─────────────────────────────────────────────────────────
_predictor: Optional[DemandPredictor] = None


def get_predictor() -> DemandPredictor:
    """
    Returns the shared DemandPredictor instance.
    Instantiated once on first call; reused on every subsequent call.
    This avoids reloading the model from disk on every request.
    """
    global _predictor
    if _predictor is None:
        _predictor = DemandPredictor()
    return _predictor
