"""
ml/training/train_demand.py — train and validate the demand model (demand_xgb:v2).

    python -m app.ml.training.train_demand                              # synthetic dataset CSV
    python -m app.ml.training.train_demand --source db --store <uuid>   # a store's real history

Validation protocol (time-based, no shuffling — shuffled splits leak the
future into training and overstate accuracy):
    holdout   = the last 30 days of data
    selection = hyper-parameters are chosen on the 30 days before the holdout
Reported on the holdout:
    * naive baseline: mean of the previous 28 days
    * product-id baseline: XGBoost on raw product id + calendar features (the
      architecture of the retired v1 model) fitted on the same split
    * v2: lag / calendar / event features, monotone price constraints
The model is marked `validated` only when it beats the naive baseline.
The final artifact is refit on all data with the selected hyper-parameters;
the pre-holdout fit is stored alongside it for out-of-sample backtests.
"""

from __future__ import annotations

import argparse
import json
import pickle
from datetime import datetime, timezone

import numpy as np
import pandas as pd
import xgboost as xgb

from app.config import get_settings
from app.ml.evaluation.metrics import regression_metrics
from app.ml.features import FEATURES_V2, MONOTONE_V2, add_calendar_and_price, add_lag_features
from app.ml.inference.demand import V2_FILE

HOLDOUT_DAYS = 30
_TREES = [
    {"n_estimators": 400, "max_depth": 4, "learning_rate": 0.05, "min_child_weight": 3},
    {"n_estimators": 600, "max_depth": 5, "learning_rate": 0.03, "min_child_weight": 5},
    {"n_estimators": 800, "max_depth": 3, "learning_rate": 0.05, "min_child_weight": 3},
]
# Poisson suits count targets (units/day); squared error kept as a candidate.
GRID = [{**t, "objective": o} for o in ("count:poisson", "reg:squarederror") for t in _TREES]

# Baseline only: raw product id + calendar (cannot serve products unseen in training).
BASELINE_FEATURES = ["product_code", "category_enc", "price", "day_of_week", "month", "is_weekend",
                     "days_to_expiry", "season_factor", "cost_price", "mrp"]


def load_events() -> list[dict]:
    try:
        from app import db
        return db.fetch_all("select start_date, end_date from seasonal_events where organization_id is null and event_type <> 'SEASON'")
    except Exception as exc:  # training must still work offline
        print(f"[!] seasonal events unavailable ({exc}); event features will be zero")
        return []


def load_csv() -> pd.DataFrame:
    df = pd.read_csv(get_settings().dataset_path, parse_dates=["date"])
    return df.rename(columns={"units_sold": "units"})


def load_db(store_id: str) -> pd.DataFrame:
    from app.services import data
    p = data.panel(store_id)
    if p.empty:
        raise SystemExit("store has no history")
    return p


def v2_model(params: dict) -> xgb.XGBRegressor:
    mono = tuple(MONOTONE_V2.get(f, 0) for f in FEATURES_V2)
    return xgb.XGBRegressor(subsample=0.8, colsample_bytree=0.8, monotone_constraints=mono,
                            random_state=42, verbosity=0, **params)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", choices=["csv", "db"], default="csv")
    ap.add_argument("--store", help="store id when --source db")
    ap.add_argument("--no-register", action="store_true")
    args = ap.parse_args()
    s = get_settings()

    raw = load_csv() if args.source == "csv" else load_db(args.store)
    events = load_events()
    encoder = {c: i for i, c in enumerate(sorted(raw["category"].str.lower().unique()))}
    df = add_lag_features(raw, group="product_id")
    df = add_calendar_and_price(df, events, encoder)

    max_date = df["date"].max()
    cut_test = max_date - pd.Timedelta(days=HOLDOUT_DAYS - 1)
    cut_val = cut_test - pd.Timedelta(days=HOLDOUT_DAYS)
    train, test = df[df["date"] < cut_test], df[df["date"] >= cut_test]
    fit_part, val_part = train[train["date"] < cut_val], train[train["date"] >= cut_val]
    print(f"[*] rows={len(df)} products={df.product_id.nunique()} range={df.date.min().date()}..{max_date.date()}")
    print(f"    train={len(train)} (< {cut_test.date()})  holdout={len(test)}")

    # ── hyper-parameter selection on the validation window ──────────────────
    best, best_mae = None, np.inf
    for params in GRID:
        m = v2_model(params).fit(fit_part[FEATURES_V2], fit_part["units"])
        mae = regression_metrics(val_part["units"], np.clip(m.predict(val_part[FEATURES_V2]), 0, None))["mae"]
        print(f"    grid {params} -> val MAE {mae}")
        if mae < best_mae:
            best, best_mae = params, mae

    v2 = v2_model(best).fit(train[FEATURES_V2], train["units"])
    p_v2 = np.clip(v2.predict(test[FEATURES_V2]), 0, None)
    report: dict = {
        "protocol": f"time-based holdout: last {HOLDOUT_DAYS} days ({cut_test.date()}..{max_date.date()})",
        "source": args.source,
        "selected_params": best,
        "naive_28d_mean": regression_metrics(test["units"], test["base_demand_28"].fillna(train["units"].mean())),
        "v2": regression_metrics(test["units"], p_v2),
    }

    # ── product-id baseline on the same split ───────────────────────────────
    codes = {pid: i for i, pid in enumerate(sorted(df["product_id"].unique(), key=str))}
    train_b = train.assign(product_code=train["product_id"].map(codes))
    test_b = test.assign(product_code=test["product_id"].map(codes))
    baseline = xgb.XGBRegressor(n_estimators=300, max_depth=6, learning_rate=0.1, subsample=0.8,
                                colsample_bytree=0.8, random_state=42, verbosity=0)
    baseline.fit(train_b[BASELINE_FEATURES], train_b["units"])
    report["baseline_xgb_product_id"] = regression_metrics(
        test_b["units"], np.clip(baseline.predict(test_b[BASELINE_FEATURES]), 0, None))
    report["validated"] = bool(report["v2"]["mae"] < report["naive_28d_mean"]["mae"])

    # Relative residuals on the holdout → fallback prediction intervals.
    rel = (test["units"].to_numpy() - p_v2) / np.maximum(p_v2, 1.0)
    residual_q = {f"q{int(q*100)}": float(np.quantile(rel, q)) for q in (0.05, 0.1, 0.2, 0.5, 0.8, 0.9, 0.95)}

    # ── refit on everything and save ────────────────────────────────────────
    final = v2_model(best).fit(df[FEATURES_V2], df["units"])
    importance = dict(sorted(zip(FEATURES_V2, map(float, final.feature_importances_)), key=lambda kv: -kv[1]))
    art = {
        "features": FEATURES_V2, "model": final, "encoder": encoder, "metrics": report["v2"],
        "residual_quantiles": residual_q, "report": report, "feature_importance": importance,
        "objective": best["objective"],
        # Model fitted only on data before the holdout: lets backtests on the
        # training history stay out-of-sample.
        "model_holdout": v2, "holdout_start": str(cut_test.date()),
        "training_data": "SYNTHETIC" if args.source == "csv" else "REAL",
        "data_range": [str(df.date.min().date()), str(max_date.date())],
        "trained_at": datetime.now(timezone.utc).isoformat(),
    }
    s.models_dir.mkdir(parents=True, exist_ok=True)
    with open(s.models_dir / V2_FILE, "wb") as f:
        pickle.dump(art, f)
    print(json.dumps({k: v for k, v in report.items()}, indent=2, default=str))
    print(f"[OK] saved {s.models_dir / V2_FILE}")

    if not args.no_register:
        register(report, importance, art)


def register(report: dict, importance: dict, art: dict) -> None:
    """Record the model in model_versions (shown on the Settings page)."""
    from app import db
    try:
        db.execute(
            """insert into model_versions(name, version, algorithm, training_data, metrics, features, artifact_path, is_active, notes, trained_at)
               values ('demand_xgb', 'v2', 'XGBRegressor (monotone price constraints)', :td, cast(:m as jsonb), cast(:f as jsonb),
                       'models/demand_model_xgb_v2.pkl', true, :notes, now())
               on conflict (name, version) do update set metrics = excluded.metrics, features = excluded.features,
                   is_active = true, notes = excluded.notes, trained_at = now(), training_data = excluded.training_data""",
            td=art["training_data"], m=json.dumps({**report, "feature_importance": importance}, default=str),
            f=json.dumps(FEATURES_V2),
            notes=f"{report['protocol']}; data {art['data_range'][0]}..{art['data_range'][1]}",
        )
        # The v1 model (2023 dataset, product-id feature) is retired.
        db.execute("""update model_versions set is_active = false,
                             notes = 'Retired: trained on the 2023 dataset; superseded by v2'
                      where name = 'demand_xgb' and version = 'v1'""")
        print("[OK] model_versions updated")
    except Exception as exc:
        print(f"[!] model registry not updated: {exc}")


if __name__ == "__main__":
    main()
