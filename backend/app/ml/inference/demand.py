"""
ml/inference/demand.py — demand model registry (XGBoost).

One model family is served: `demand_xgb:v2`, trained by
app/ml/training/train_demand.py on a time-based split with lag / calendar /
event features, monotone price constraints and **no product id**, so it
serves every product — including ones created after training. Artifact:
models/demand_model_xgb_v2.pkl (git-ignored; created by training).

(The original v1 model used the raw dataset product id as a feature and was
tied to the retired 2023 dataset; its code path was removed with it.)

Inference flow
    features.future_frame()  → one feature row per (candidate price, day)
    predict_units()          → expected units/day, clipped at 0
    shap_for()               → exact TreeSHAP contributions for explanations

The artifact also carries `model_holdout` — the same model fitted only on data
before the validation holdout — so backtests on the training history can stay
out-of-sample (see ml/forecasting/forecaster.py).
"""

from __future__ import annotations

import pickle
import threading
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb

from app.config import get_settings

V2_FILE = "demand_model_xgb_v2.pkl"


@dataclass
class DemandModel:
    name: str
    version: str
    features: list[str]
    model: xgb.XGBRegressor
    encoder: dict[str, int]
    metrics: dict = field(default_factory=dict)
    residual_quantiles: dict = field(default_factory=dict)
    training_data: str = "SYNTHETIC"
    trained_at: str | None = None
    objective: str = "reg:squarederror"
    model_holdout: xgb.XGBRegressor | None = None
    holdout_start: str | None = None
    data_range: list | None = None

    @property
    def key(self) -> str:
        return f"{self.name}:{self.version}"

    def predict(self, X: pd.DataFrame) -> np.ndarray:
        return np.clip(self.model.predict(X[self.features]), 0.0, None)

    @property
    def log_link(self) -> bool:
        """Poisson models add contributions in log space (multiplicative effects)."""
        return self.objective.startswith("count:")

    def contributions(self, X: pd.DataFrame) -> pd.DataFrame:
        """Exact TreeSHAP contributions; last column is the bias.

        Units/day for squared-error models; log-demand for Poisson models
        (exp(contribution) is the multiplicative effect on demand).
        """
        dm = xgb.DMatrix(X[self.features], missing=np.nan)
        contrib = self.model.get_booster().predict(dm, pred_contribs=True)
        return pd.DataFrame(contrib, columns=[*self.features, "bias"], index=X.index)


class Registry:
    def __init__(self) -> None:
        self.v2: DemandModel | None = None
        self.report: dict = {}
        self._lock = threading.Lock()

    def load(self) -> None:
        d: Path = get_settings().models_dir
        with self._lock:
            if not (d / V2_FILE).exists():
                return
            # The artifact is a pickle written by our own training job; never
            # point MODELS_DIR at a location other users can write to.
            with open(d / V2_FILE, "rb") as f:
                art = pickle.load(f)
            self.v2 = DemandModel("demand_xgb", "v2", art["features"], art["model"], art["encoder"],
                                  metrics=art.get("metrics", {}), residual_quantiles=art.get("residual_quantiles", {}),
                                  training_data=art.get("training_data", "SYNTHETIC"), trained_at=art.get("trained_at"),
                                  objective=art.get("objective", "reg:squarederror"),
                                  model_holdout=art.get("model_holdout"), holdout_start=art.get("holdout_start"),
                                  data_range=art.get("data_range"))
            self.report = art.get("report", {})

    @property
    def validated(self) -> bool:
        """True when the model beat the naive baseline on the time-based holdout."""
        return bool(self.report.get("validated"))

    def select(self, product: dict | None = None) -> DemandModel:
        """Model used for a product (a single model serves all products)."""
        if self.v2 is None:
            raise RuntimeError("No demand model available — run `python -m app.ml.training.train_demand`")
        return self.v2


_registry: Registry | None = None


def registry() -> Registry:
    global _registry
    if _registry is None:
        _registry = Registry()
        _registry.load()
    return _registry


def reload() -> Registry:
    global _registry
    _registry = Registry()
    _registry.load()
    return _registry


def predict_units(frame: pd.DataFrame, product: dict, model: DemandModel | None = None) -> np.ndarray:
    """Predict daily units for feature rows built by features.future_frame()."""
    return (model or registry().select(product)).predict(frame)


def shap_for(frame: pd.DataFrame, product: dict, model: DemandModel | None = None) -> tuple[pd.DataFrame, pd.DataFrame]:
    m = model or registry().select(product)
    return m.contributions(frame), frame[m.features]
