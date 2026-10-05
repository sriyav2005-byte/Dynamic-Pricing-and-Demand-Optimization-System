"""
main.py — PriceIQ AI service (FastAPI).

Internal service behind the Go API: demand models, forecasting, pricing
policies, elasticity, explainability, simulation, anomaly detection, seasonal
intelligence, competitor fetching, RAG and the LLM Retail Copilot.

    uvicorn app.main:app --port 8000          # from backend/ (no --reload on Windows if using Playwright)
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.routes import router
from app.config import get_settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("priceiq.ai")


@asynccontextmanager
async def lifespan(app: FastAPI):
    get_settings()  # fail fast on missing configuration
    from app.ml.inference import demand
    reg = demand.registry()
    if reg.v2 is None:
        log.warning("demand model v2 missing — run: python -m app.ml.training.train_demand")
    try:
        from app.rag import store as rag
        n = rag.seed_global_docs()
        if n:
            log.info("knowledge base: %d document(s) (re)indexed", n)
    except Exception as exc:
        log.warning("knowledge base not seeded: %s", exc)
    yield
    from app.services.competitors import adapters
    if adapters._worker is not None:
        adapters._worker.shutdown()


app = FastAPI(title="PriceIQ AI Service", version="6.0.0", lifespan=lifespan,
              description="Internal ML/AI service for PriceIQ. All /v1 routes require X-Internal-Token.")
app.include_router(router)


@app.get("/health", tags=["health"])
def health():
    from app.agents import llm
    from app.ml.inference import demand
    reg = demand.registry()
    return {"status": "ok", "service": "priceiq-ai", "models": {"demand_xgb_v2": reg.v2 is not None},
            "copilot": llm.status()["mode"]}
