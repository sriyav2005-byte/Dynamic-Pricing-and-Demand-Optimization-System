"""
api/routes.py — internal AI endpoints (called only by the Go API).

All routes require X-Internal-Token. CPU-bound ML endpoints are plain `def`
(FastAPI runs them in a worker thread pool); I/O-bound ones are async.
"""

from __future__ import annotations

import hmac

from fastapi import APIRouter, Depends, Header, HTTPException, Query

from app.config import get_settings
from app.ml import anomalies, seasonal
from app.ml.forecasting import forecaster
from app.ml.inference import demand
from app.schemas.requests import (ChatRequest, DocumentRequest, ExpiryRequest, FeedbackRequest, ForecastOverviewRequest,
                                  ForecastRequest, ProductRef, RecommendRequest, SimulateRequest, StoreRef)
from app.services import data, expiry, ml_admin, pricing, weather
from app.services.competitors import service as competitors


def require_internal(x_internal_token: str = Header(default="")) -> None:
    if not hmac.compare_digest(x_internal_token.encode(), get_settings().ai_service_token.encode()):
        raise HTTPException(status_code=401, detail="invalid internal token")


router = APIRouter(prefix="/v1", dependencies=[Depends(require_internal)])


def _guard(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


# ── Pricing ─────────────────────────────────────────────────────────────────

@router.post("/pricing/recommend")
def recommend(req: RecommendRequest):
    return _guard(pricing.recommend, req.store_id, req.product_id, req.bounds.model_dump(), req.settings)


@router.post("/pricing/simulate")
def simulate(req: SimulateRequest):
    return _guard(pricing.simulate, req.store_id, req.product_id, req.prices,
                  [s.model_dump() for s in (req.scenarios or [])], req.horizon_days, req.bounds.model_dump())


@router.post("/pricing/feedback")
def feedback(req: FeedbackRequest):
    return _guard(pricing.feedback, req.store_id, req.product_id, req.price, req.quantity, req.unit_cost, req.sold_at)


@router.post("/elasticity")
def elasticity(req: ProductRef):
    if data.product(req.store_id, req.product_id) is None:
        raise HTTPException(404, "product not found")
    return pricing.elasticity_for(req.store_id, req.product_id)


@router.post("/cross-effects")
def cross_effects(req: ProductRef):
    if data.product(req.store_id, req.product_id) is None:
        raise HTTPException(404, "product not found")
    rows = data.db.fetch_all(
        """select p.name as related_product, r.relationship, r.cross_elasticity, r.p_value, r.n_obs, r.computed_at,
                  case when r.product_id = cast(:p as uuid) then 'this product responds to the related product''s price'
                       else 'the related product responds to this product''s price' end as direction
           from product_relationships r
           join products p on p.id = case when r.product_id = cast(:p as uuid) then r.related_product_id else r.product_id end
           where (r.product_id = cast(:p as uuid) or r.related_product_id = cast(:p as uuid)) and r.store_id = cast(:s as uuid)""",
        p=req.product_id, s=req.store_id)
    return {"relationships": rows,
            "note": "Only statistically supported relationships (Benjamini–Hochberg FDR 10%) are listed; none means no evidence of "
                    "substitution or complementarity was found in the history.",
            "method": "Poisson GLM cross-price elasticity with day-of-week / month / expiry controls"}


# ── Forecasting, expiry, anomalies, seasonal, weather ───────────────────────

@router.post("/forecast")
def forecast(req: ForecastRequest):
    fc = _guard(forecaster.forecast, req.store_id, req.product_id, req.horizon)
    try:
        forecaster.persist(req.store_id, fc, fc["model_version"])
    except Exception:
        pass
    return fc


@router.post("/forecast/overview")
def forecast_overview(req: ForecastOverviewRequest):
    return _guard(forecaster.overview, req.store_id, req.horizon)


@router.post("/expiry/optimize")
def expiry_optimize(req: ExpiryRequest):
    return _guard(expiry.optimize, req.store_id, req.settings)


@router.post("/anomalies/detect")
def detect_anomalies(req: StoreRef):
    return _guard(anomalies.detect, req.store_id)


@router.post("/seasonal/insights")
def seasonal_insights(req: StoreRef):
    return _guard(seasonal.insights, req.store_id)


@router.post("/weather")
async def store_weather(req: StoreRef):
    try:
        return await weather.outlook(req.store_id)
    except LookupError as exc:
        raise HTTPException(404, str(exc))


# ── Competitors ─────────────────────────────────────────────────────────────

@router.get("/competitors/search")
async def competitor_search(q: str = Query(min_length=2, max_length=120), store_id: str | None = Query(default=None)):
    # store_id selects the delivery location the platforms are queried for.
    return await competitors.search(q, store_id)


@router.post("/competitors/refresh")
async def competitor_refresh(req: ProductRef):
    try:
        return await competitors.refresh(req.store_id, req.product_id)
    except LookupError as exc:
        raise HTTPException(404, str(exc))


# ── Copilot & knowledge base ────────────────────────────────────────────────

@router.post("/copilot/chat")
async def copilot_chat(req: ChatRequest, x_user_authorization: str = Header(default="")):
    from app.agents import copilot
    if not x_user_authorization:
        raise HTTPException(401, "user token required")
    st = data.store(req.store_id)
    if st is None:
        raise HTTPException(404, "store not found")
    return await copilot.chat(req.store_id, st["organization_id"], req.message, req.history or [], req.user, x_user_authorization)


@router.post("/rag/documents")
def add_document(req: DocumentRequest):
    from app.rag import store as rag
    return {"document_id": rag.ingest(req.title, req.content, req.doc_type, req.organization_id, "upload")}


# ── Models & ML maintenance ─────────────────────────────────────────────────

@router.get("/models")
def models():
    from app.agents import llm
    reg = demand.registry()
    rows = data.db.fetch_all("select name, version, algorithm, training_data, metrics, is_active, notes, trained_at from model_versions order by name, version")
    return {"active_policy": get_settings().pricing_policy,
            "loaded": {"demand": reg.v2.key if reg.v2 else None},
            "validated": reg.validated,
            "training": None if reg.v2 is None else {"data": reg.v2.training_data, "range": reg.v2.data_range,
                                                     "trained_at": reg.v2.trained_at, "holdout_metrics": reg.v2.metrics},
            "registry": rows,
            "copilot": llm.status()}


@router.post("/ml/refresh")
def ml_refresh(req: StoreRef):
    return _guard(ml_admin.refresh, req.store_id)


@router.post("/ml/evaluate-policies")
def evaluate_policies(req: StoreRef):
    return _guard(ml_admin.evaluate_policies, req.store_id)
