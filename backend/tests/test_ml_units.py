"""Unit tests for ML building blocks (no database required)."""

import json
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from app.ml.evaluation.metrics import confidence_label, regression_metrics
from app.ml.features import add_lag_features, event_features
from app.ml.pricing.bandit import normalize
from app.ml.pricing.elasticity import _bh, apply_fdr, own_price_elasticity


def synthetic_history(elasticity: float, days: int = 150, price_cv: float = 0.1, seed: int = 1) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    dates = pd.date_range("2024-01-01", periods=days, freq="D")
    price = 50 * np.exp(rng.normal(0, price_cv, days))
    lam = 20 * (price / 50) ** elasticity * np.where(dates.dayofweek >= 5, 1.2, 1.0)
    return pd.DataFrame({"date": dates, "units": rng.poisson(lam).astype(float), "price": price}).set_index("date")


def test_elasticity_recovers_known_value():
    res = own_price_elasticity(synthetic_history(-1.5))
    assert res["status"] == "ESTIMATED"
    assert res["ci_low"] <= -1.5 <= res["ci_high"]
    assert abs(res["elasticity"] + 1.5) < 0.35


def test_elasticity_refuses_without_price_variation():
    h = synthetic_history(-1.5, price_cv=0.0)
    res = own_price_elasticity(h)
    assert res["status"] == "INSUFFICIENT_DATA" and res["elasticity"] is None
    res = own_price_elasticity(synthetic_history(-1.5, days=20))
    assert res["status"] == "INSUFFICIENT_DATA" and "days" in res["reason"]


def test_elasticity_is_calibrated():
    """With no true price effect, 'significant' results must stay near the nominal 5%;
    with a true effect, the 95% CI must usually contain it (measured: ~6.5% / ~90%)."""
    null = [own_price_elasticity(synthetic_history(0.0, seed=s)) for s in range(60)]
    assert sum(r["p_value"] < 0.05 for r in null) / len(null) <= 0.12
    assert abs(np.mean([r["elasticity"] for r in null])) < 0.1
    cov = [own_price_elasticity(synthetic_history(-1.5, seed=s)) for s in range(60)]
    assert np.mean([r["ci_low"] <= -1.5 <= r["ci_high"] for r in cov]) >= 0.85


def test_benjamini_hochberg():
    p = [0.001, 0.008, 0.039, 0.041, 0.042, 0.06, 0.074, 0.205, 0.212, 0.216]
    assert _bh(p, 0.05) == [True, True] + [False] * 8
    res = apply_fdr([{"p_value": 0.2}, {"p_value": 0.0001}], 0.1)
    assert [r["significant"] for r in res] == [False, True]


def test_regression_metrics_and_confidence():
    m = regression_metrics([10, 0, 5], [8, 1, 5])
    assert m["mae"] == 1.0 and m["mape_days"] == 2 and m["mape_pct"] == 10.0
    assert regression_metrics([], [])["n"] == 0
    assert confidence_label(None, 100) == "LOW"
    assert confidence_label(20, 90) == "HIGH"
    assert confidence_label(35, 90) == "MEDIUM"


def test_lag_features_do_not_leak_the_target():
    df = pd.DataFrame({"product_id": "p", "date": pd.date_range("2024-01-01", periods=40), "units": np.arange(40, dtype=float),
                       "price": 10.0})
    out = add_lag_features(df)
    row = out.iloc[30]
    assert row["base_demand_28"] == pytest.approx(np.mean(np.arange(2, 30)))  # days 2..29, never day 30 itself
    assert np.isnan(out.iloc[3]["base_demand_28"])  # fewer than 7 prior days


def test_event_features():
    ev = [{"start_date": "2024-01-10", "end_date": "2024-01-12"}]
    f = event_features(pd.Series(pd.to_datetime(["2024-01-05", "2024-01-11", "2024-03-30"])), ev)
    assert f["event_flag"].tolist() == [0, 1, 0]
    assert f["days_to_event"].tolist() == [5, 0, 60]


def test_bandit_normalization_scale():
    n = normalize({1: -100.0, 2: 0.0, 3: 100.0})
    assert n[1] == pytest.approx(0.1) and n[3] == pytest.approx(0.9) and n[2] == pytest.approx(0.5)
    assert normalize({1: 5.0, 2: 5.0}) == {1: 0.5, 2: 0.5}
    # Realized profit above the predicted range is clipped to 1.
    assert normalize({"x": 500.0}, 0.0, 100.0)["x"] == 1.0


def test_thompson_reward_depends_on_realized_profit(monkeypatch):
    """The old reward was a function of price only; the new one must use realized profit."""
    import app.ml.pricing.bandit as b
    monkeypatch.setattr(b, "load_state", lambda *a: None)
    monkeypatch.setattr(b, "save_state", lambda *a: None)
    product = {"id": "p", "cost_price": 80.0, "mrp": 120.0}
    ts = b.ThompsonBandit("s", product, np.random.default_rng(0))
    arm = ts.arms[3]
    ts.remember_decision(arm, profit_lo=0.0, profit_hi=100.0)
    from datetime import date
    ts.record_sale(date(2026, 1, 1), arm, 20.0)
    ts.record_sale(date(2026, 1, 1), arm, 20.0)           # same day accumulates to 40
    assert ts.record_sale(date(2026, 1, 2), arm, 1.0)     # finalizes day 1
    assert ts.state["alpha"][3] == pytest.approx(0.1 + 0.8 * 0.4)
    assert ts.state["alpha"][3] + ts.state["beta"][3] == pytest.approx(1.0)


def test_optimizer_counts_waste_as_loss(monkeypatch):
    from app.ml.pricing import optimizer
    monkeypatch.setattr(optimizer, "predict_units", lambda frame, product, model: np.full(len(frame), 10.0))
    product = {"cost_price": 8.0, "mrp": 15.0, "category": "x", "stock": 50, "days_to_expiry": 2, "season_factor": 1.0}
    hist = pd.DataFrame({"date": pd.date_range("2024-01-01", periods=30), "units": 10.0, "price": 12.0})
    ev = optimizer.evaluate([12.0], product, hist.set_index("date"), [], {}, model=None, horizon=3)[0]
    # 3 selling days (0..2) × 10 = 30 sold, 20 expire unsold.
    assert ev.sold == 30 and ev.waste_units == 20
    assert ev.profit == pytest.approx((12 - 8) * 30 - 8 * 20)
    assert optimizer.planning_horizon({"days_to_expiry": 2}) == 3
    assert optimizer.planning_horizon({"days_to_expiry": None}) == 7


def test_blinkit_parser():
    from app.services.competitors.adapters import BlinkitAdapter
    payload = {"response": {"snippets": [
        {"data": {"title": {"text": "header"}}},
        {"data": {"identity": {"id": "1391202"}, "name": {"text": "Amul Salted Butter"}, "variant": {"text": "100 g"},
                  "mrp": {"text": "₹62"}, "normal_price": {"text": "₹58"}, "inventory": 5, "image": {"url": "https://x/y.png"}}},
        {"data": {"identity": {"id": "9"}, "name": {"text": "Out of stock item"}, "normal_price": {"text": "₹1,250"}, "inventory": 0}},
    ]}}
    items = BlinkitAdapter.parse(payload)
    assert len(items) == 2
    a = items[0]
    assert (a.external_id, a.price, a.mrp, a.pack_size, a.in_stock) == ("1391202", 58.0, 62.0, "100 g", True)
    assert a.discount_pct == pytest.approx(6.5, abs=0.1) and a.url.endswith("/prid/1391202")
    assert items[1].price == 1250.0 and items[1].in_stock is False and items[1].mrp == 1250.0


def test_copilot_intents():
    from app.agents.fallback import classify
    assert classify("Which products may stock out?") == "stockout"
    assert classify("Which products are close to expiry?") == "expiry"
    assert classify("Which competitors are cheaper?") == "competitor"
    assert classify("What happens if I reduce this price by 5%?") == "simulate"
    assert classify("Which products generated the most profit?") == "profit"
    assert classify("Show my biggest pricing opportunities.") == "opportunities"


def test_rag_chunking_and_lexical_ranking():
    from app.rag.store import chunk, embed
    doc = Path(__file__).resolve().parents[1].joinpath("app/rag/docs/pricing_policy.md").read_text(encoding="utf-8")
    chunks = chunk(doc)
    assert len(chunks) >= 2 and all(len(c) <= 1300 for c in chunks)
    vecs, model = embed(chunks + ["maximum price change allowed per update"])
    scores = vecs[:-1] @ vecs[-1]
    assert "Maximum price change" in chunks[int(np.argmax(scores))]
    assert model == "hashing-512"


def test_blinkit_parser_tolerates_layout_changes():
    """Product cards are recognised by their fields, wherever the layout nests them."""
    from app.services.competitors.adapters import BlinkitAdapter
    card = {"identity": {"id": "7"}, "name": {"text": "Nandini Curd"}, "variant": {"text": "500 g"},
            "mrp": {"text": "₹28"}, "normal_price": {"text": "₹30"}, "inventory": 3}
    payload = {"response": {"snippets": [{"data": {"items": [{"data": card}, {"data": card}]}}]}}
    items = BlinkitAdapter.parse(payload)
    assert len(items) == 1                                   # duplicates collapsed
    assert items[0].mrp == 30.0 and items[0].discount_pct == 0.0   # MRP below price is never trusted
    assert BlinkitAdapter.parse({"response": {"snippets": []}}) == []
    assert BlinkitAdapter.parse({"unexpected": "shape"}) == []


def test_blocked_platforms_are_classified_not_guessed():
    from app.services.competitors.adapters import ProbeAdapter
    by, reason = ProbeAdapter.classify(202, {"x-amzn-waf-action": "challenge"}, "")
    assert by == "AWS WAF bot challenge" and "does not solve or bypass" in reason
    by, _ = ProbeAdapter.classify(403, {}, "<h1>Access Denied</h1> errors.edgesuite.net")
    assert by == "Akamai access control"
    by, reason = ProbeAdapter.classify(503, {}, "upstream error")
    assert by is None and "server error" in reason


def test_one_failing_platform_does_not_break_search(monkeypatch):
    import asyncio
    from app.services.competitors import adapters, service

    class Boom(adapters.Adapter):
        key, name, search_template = "boom", "Boom", "https://boom.test/?q={q}"

        async def search(self, query, location):
            raise RuntimeError("selector changed")

    class Good(adapters.Adapter):
        key, name, search_template = "good", "Good", "https://good.test/?q={q}"

        async def search(self, query, location):
            return adapters.PlatformResult("good", "Good", "LIVE", self.search_url(query),
                                           listings=[adapters.Listing("1", "Milk", "500 ml", 29.0, 30.0, 3.3, True, None)])

    monkeypatch.setattr(service, "ADAPTERS", {"boom": Boom(), "good": Good()})
    out = asyncio.run(service.search("milk"))
    status = {p["key"]: p["status"] for p in out["platforms"]}
    assert status == {"boom": "UNAVAILABLE", "good": "LIVE"}
    assert out["summary"]["average"] == 29.0                  # only the LIVE listing counts
    assert all(r["price"] is None for r in out["results"] if r["status"] == "UNAVAILABLE")   # never a made-up price


def test_seasonal_considerations_scale_demand():
    from datetime import date
    from app.services import considerations as sc
    dates = list(pd.date_range("2026-11-03", periods=4))
    diwali = {"id": "1", "name": "Diwali", "kind": "FESTIVAL", "scope": "CATEGORY", "start_date": date(2026, 11, 4),
              "end_date": date(2026, 11, 9), "change_pct": 40.0, "supply_condition": "LIMITED",
              "weather_sensitivity": None, "festival_sensitivity": "LOW"}
    # Category-wide consideration is scaled by the product's own festival sensitivity…
    mult, applied = sc.daily_multipliers({"festival_sensitivity": 0.5}, [diwali], dates)
    assert mult.tolist() == pytest.approx([1.0, 1.2, 1.2, 1.2]) and applied[0]["applied_change_pct"] == 20.0
    # …falls back to the level entered on the consideration when the product has none…
    mult, _ = sc.daily_multipliers({"festival_sensitivity": None}, [diwali], dates)
    assert mult[1] == pytest.approx(1.2)
    # …and applies in full when the consideration targets the product itself.
    mult, applied = sc.daily_multipliers({"festival_sensitivity": 0.0}, [{**diwali, "scope": "PRODUCT"}], dates)
    assert mult[1] == pytest.approx(1.4) and applied[0]["source"] == "MANUAL"
    # Stacked extreme assumptions are clipped.
    crash = {**diwali, "scope": "PRODUCT", "change_pct": -90.0}
    mult, _ = sc.daily_multipliers({}, [crash, crash], dates)
    assert mult[1] == sc.MIN_MULT


def test_optimizer_applies_per_day_multipliers(monkeypatch):
    from app.ml.pricing import optimizer
    monkeypatch.setattr(optimizer, "predict_units", lambda frame, product, model: np.full(len(frame), 10.0))
    product = {"cost_price": 8.0, "mrp": 15.0, "category": "x", "stock": 500, "days_to_expiry": None, "season_factor": 1.0}
    hist = pd.DataFrame({"date": pd.date_range("2026-01-01", periods=30), "units": 10.0, "price": 12.0}).set_index("date")
    a, b = optimizer.evaluate([11.0, 12.0], product, hist, [], {}, model=None, horizon=2, demand_multiplier=np.array([1.0, 1.5]))
    assert a.sold == b.sold == 25                              # 10 + 15 units for each candidate price
