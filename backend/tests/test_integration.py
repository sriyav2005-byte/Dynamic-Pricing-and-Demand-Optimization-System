"""Integration tests against the seeded development database (skipped when unavailable)."""

import pytest
from fastapi.testclient import TestClient

from conftest import requires_db


@pytest.fixture(scope="module")
def client():
    from app.main import app
    with TestClient(app) as c:
        yield c


H = {"X-Internal-Token": "test-token"}


def test_internal_token_required():
    from app.main import app
    c = TestClient(app)
    assert c.post("/v1/pricing/recommend", json={}).status_code == 401
    assert c.post("/v1/pricing/recommend", json={}, headers={"X-Internal-Token": "wrong"}).status_code == 401


def test_request_validation():
    from app.main import app
    c = TestClient(app)
    bad = {"store_id": "x", "product_id": "y", "bounds": {"lo": 10, "hi": 5}}
    assert c.post("/v1/pricing/recommend", json=bad, headers=H).status_code == 422


@requires_db
def test_recommendation_respects_band_and_explains(client, store_id, product_id):
    from app.services import data
    p = data.product(store_id, product_id)
    lo, hi = round(p["cost_price"], 2), round(p["price"], 2)
    r = client.post("/v1/pricing/recommend", headers=H,
                    json={"store_id": store_id, "product_id": product_id, "bounds": {"lo": lo, "hi": hi}})
    assert r.status_code == 200, r.text
    body = r.json()
    assert lo - 0.01 <= body["recommended_price"] <= hi + 0.01
    ex = body["explanation"]
    assert ex["summary"] and ex["factors"] and ex["shap"]["top"]
    assert {"demand_change_pct", "profit_change_pct", "margin_change_pts"} <= set(ex["impact"])
    assert ex["data_provenance"]["sales_history"] == "Synthetic/Training Data"
    assert 0 <= body["confidence"] <= 1


@requires_db
def test_unknown_product_is_404(client, store_id):
    r = client.post("/v1/pricing/recommend", headers=H, json={"store_id": store_id, "product_id": "00000000-0000-0000-0000-000000000000",
                                                              "bounds": {"lo": 1, "hi": 2}})
    assert r.status_code == 404


@requires_db
@pytest.mark.parametrize("horizon", [7, 14, 30])
def test_forecast_horizons(client, store_id, product_id, horizon):
    r = client.post("/v1/forecast", headers=H, json={"store_id": store_id, "product_id": product_id, "horizon": horizon})
    assert r.status_code == 200, r.text
    fc = r.json()
    assert len(fc["points"]) == horizon
    assert all(p["lower_bound"] <= p["predicted_demand"] <= p["upper_bound"] for p in fc["points"])
    assert fc["confidence"] in ("LOW", "MEDIUM", "HIGH")
    assert fc["accuracy"] is None or "not seen in training" in fc["accuracy"]["protocol"]
    assert any("Synthetic/Training Data" in w for w in fc["warnings"])


@requires_db
def test_simulation_scenarios(client, store_id, product_id):
    from app.services import data
    p = data.product(store_id, product_id)
    r = client.post("/v1/pricing/simulate", headers=H, json={
        "store_id": store_id, "product_id": product_id, "prices": [p["price"] * 0.9, p["price"]],
        "scenarios": [{"type": "demand_change", "pct": 20}, {"type": "competitor_price_change", "pct": -10}],
        "bounds": {"lo": p["cost_price"], "hi": p["price"]}})
    assert r.status_code == 200, r.text
    s = r.json()
    lower, current = s["results"]
    assert lower["demand"] >= current["demand"] - 1e-6        # monotone price effect
    assert s["scenarios"][0]["result"]["demand"] >= current["demand"] - 1e-6
    comp = s["scenarios"][1]
    assert comp["estimable"] is False                          # no competitor history ⇒ not invented


@requires_db
def test_elasticity_and_anomalies_and_seasonal(client, store_id, product_id):
    e = client.post("/v1/elasticity", headers=H, json={"store_id": store_id, "product_id": product_id}).json()
    assert e["status"] in ("ESTIMATED", "NOT_SIGNIFICANT", "INSUFFICIENT_DATA")
    a = client.post("/v1/anomalies/detect", headers=H, json={"store_id": store_id}).json()
    assert set(a["detectors"]) == {"sales", "prices", "inventory", "competitors", "store_days"}
    s = client.post("/v1/seasonal/insights", headers=H, json={"store_id": store_id}).json()
    assert s["available"] and s["history"]["data_mode"] == "SYNTHETIC"
    for ev in s["events"]:
        assert ev["occurrences"] >= 1
        if ev["occurrences"] == 1:
            assert ev["confidence"] == "LOW"                       # one occurrence is never high confidence


@requires_db
def test_expiry_optimization_never_below_cost(client, store_id):
    r = client.post("/v1/expiry/optimize", headers=H, json={"store_id": store_id, "settings": {"max_expiry_markdown_pct": 0.4}})
    assert r.status_code == 200
    for item in r.json()["items"]:
        assert item["recommended"]["price"] >= item["cost_price"] - 0.01
        assert item["recommended"]["waste_units"] <= item["at_current_price"]["waste_units"] + 1e-6


@requires_db
def test_knowledge_base_search():
    from app.rag import store as rag
    rag.seed_global_docs()
    hits = rag.search("what happens when a product is about to expire and can the price go below cost", None, k=3)
    assert hits and any("expir" in h["content"].lower() for h in hits)


@requires_db
def test_seasonal_consideration_feeds_forecast_and_pricing(client, store_id, product_id):
    """A staff-entered consideration scales demand, is labelled MANUAL, and never widens the price band."""
    from app import db
    from app.services import data
    db.execute(
        """insert into seasonal_considerations(store_id, name, kind, product_id, start_date, end_date,
                                               expected_demand_change_pct, supply_condition)
           values (:s, 'pytest spike', 'EVENT', :p, current_date - 1, current_date + 40, 50, 'SHORTAGE')""",
        s=store_id, p=product_id)
    try:
        fc = client.post("/v1/forecast", headers=H, json={"store_id": store_id, "product_id": product_id, "horizon": 7}).json()
        assert fc["considerations"][0]["source"] == "MANUAL"
        assert all(p["predicted_demand"] == pytest.approx(p["model_demand"] * 1.5, abs=0.02) for p in fc["points"])
        p = data.product(store_id, product_id)
        lo, hi = round(p["cost_price"], 2), round(p["mrp"], 2)
        rec = client.post("/v1/pricing/recommend", headers=H,
                          json={"store_id": store_id, "product_id": product_id, "bounds": {"lo": lo, "hi": hi}}).json()
        assert lo - 0.01 <= rec["recommended_price"] <= hi + 0.01
        assert rec["recommended_price"] >= p["price"] - 0.01          # SHORTAGE ⇒ no discount
        assert any(f["factor"] == "seasonal_consideration" for f in rec["explanation"]["factors"])
    finally:
        db.execute("delete from seasonal_considerations where name = 'pytest spike'")
