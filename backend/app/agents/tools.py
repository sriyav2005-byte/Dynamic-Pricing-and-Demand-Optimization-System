"""
agents/tools.py — controlled tools for the Retail Copilot.

Every tool calls the Go API **with the end user's own bearer token**, so the
copilot can only see and do what that user may (RBAC + PostgreSQL RLS). There
is no SQL access. Tools only read data, except get_price_recommendation with
generate=true, which creates a *recommendation* (it never changes a price).
Outputs are compacted to the fields the model needs.
"""

from __future__ import annotations

import re
import uuid
from typing import Any

import httpx

from app.config import get_settings
from app.rag import store as rag

UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)


class ToolError(Exception):
    pass


TOOL_DEFINITIONS: list[dict] = [
    {"name": "find_products",
     "description": "Search the store's products by name, brand, SKU or barcode. Returns ids, prices, stock and expiry. Use this to resolve a product the user mentions.",
     "input_schema": {"type": "object", "properties": {
         "query": {"type": "string", "description": "Name, brand, SKU or barcode fragment; empty for all products"},
         "stock_status": {"type": "string", "enum": ["out", "low", "over", "in"], "description": "Optional stock filter"},
         "expiring_within_days": {"type": "integer", "minimum": 0, "maximum": 365},
         "limit": {"type": "integer", "minimum": 1, "maximum": 50}}, "required": []}},
    {"name": "get_product",
     "description": "Full details of one product plus its inventory intelligence (sales velocity, days of cover, reorder advice, expiry risk).",
     "input_schema": {"type": "object", "properties": {"product": {"type": "string", "description": "Product id, SKU or name"}},
                      "required": ["product"]}},
    {"name": "get_inventory",
     "description": "Store inventory intelligence: valuation, status counts and the products with a given status (OUT_OF_STOCK, LOW_STOCK, PREDICTED_STOCKOUT, OVERSTOCK, DEAD_STOCK, EXPIRY_RISK).",
     "input_schema": {"type": "object", "properties": {
         "status": {"type": "string", "enum": ["OUT_OF_STOCK", "LOW_STOCK", "PREDICTED_STOCKOUT", "OVERSTOCK", "DEAD_STOCK", "EXPIRY_RISK"]},
         "limit": {"type": "integer", "minimum": 1, "maximum": 50}}, "required": []}},
    {"name": "get_sales",
     "description": "Sales totals (revenue, profit, units, margin) for the last N days with the change vs the previous period; optionally for one product with its daily trend.",
     "input_schema": {"type": "object", "properties": {
         "days": {"type": "integer", "minimum": 1, "maximum": 365},
         "product": {"type": "string", "description": "Optional product id, SKU or name"}}, "required": []}},
    {"name": "get_profit_analysis",
     "description": "Rank products by revenue, profit, units or margin over the last N days (top or bottom).",
     "input_schema": {"type": "object", "properties": {
         "days": {"type": "integer", "minimum": 1, "maximum": 365},
         "sort": {"type": "string", "enum": ["revenue", "profit", "units", "margin"]},
         "order": {"type": "string", "enum": ["desc", "asc"]},
         "limit": {"type": "integer", "minimum": 1, "maximum": 50}}, "required": []}},
    {"name": "get_forecast",
     "description": "Demand forecast for a product over 7, 14 or 30 days with 80% intervals, trend, peak day, expected stockout, out-of-sample accuracy and warnings.",
     "input_schema": {"type": "object", "properties": {
         "product": {"type": "string"}, "horizon": {"type": "integer", "enum": [7, 14, 30]}}, "required": ["product"]}},
    {"name": "get_competitor_prices",
     "description": "Competitor prices with their status (LIVE, MANUAL_VERIFIED, CACHED, ESTIMATED, UNAVAILABLE). With a product: per-platform observations and market stats. Without: products that have market data and how our price compares.",
     "input_schema": {"type": "object", "properties": {"product": {"type": "string"}}, "required": []}},
    {"name": "get_price_recommendation",
     "description": "Latest AI price recommendation for a product with its explanation, constraints and expected impact. Set generate=true to create a fresh one (this does NOT change the price).",
     "input_schema": {"type": "object", "properties": {
         "product": {"type": "string"}, "generate": {"type": "boolean"}}, "required": ["product"]}},
    {"name": "list_pricing_opportunities",
     "description": "Pending price recommendations ranked by expected profit improvement.",
     "input_schema": {"type": "object", "properties": {"limit": {"type": "integer", "minimum": 1, "maximum": 30}}, "required": []}},
    {"name": "simulate_price",
     "description": "What-if simulation: expected demand, revenue, profit, margin, waste, competitor position and risk at given prices, plus scenarios (our_price_change, demand_change, competitor_price_change with pct).",
     "input_schema": {"type": "object", "properties": {
         "product": {"type": "string"},
         "prices": {"type": "array", "items": {"type": "number", "exclusiveMinimum": 0}, "maxItems": 10},
         "scenarios": {"type": "array", "maxItems": 5, "items": {"type": "object", "properties": {
             "type": {"type": "string", "enum": ["our_price_change", "demand_change", "competitor_price_change"]},
             "pct": {"type": "number"}}, "required": ["type", "pct"]}}}, "required": ["product"]}},
    {"name": "get_expiry_risk",
     "description": "Perishable products expiring soon with expected waste at the current price and the recommended markdown (demand-model optimized).",
     "input_schema": {"type": "object", "properties": {"limit": {"type": "integer", "minimum": 1, "maximum": 30}}, "required": []}},
    {"name": "get_alerts",
     "description": "Open alerts (low stock, stockout, expiry, competitor undercut, demand spike/drop, anomalies, pricing opportunities) by severity.",
     "input_schema": {"type": "object", "properties": {
         "severity": {"type": "string", "enum": ["LOW", "MEDIUM", "HIGH", "CRITICAL"]},
         "type": {"type": "string"}, "limit": {"type": "integer", "minimum": 1, "maximum": 50}}, "required": []}},
    {"name": "get_analytics",
     "description": "Store KPIs for the last N days: revenue, profit, margin, units, inventory value, at-risk products, competitor gap, pending recommendations, open alerts, and performance by category.",
     "input_schema": {"type": "object", "properties": {"days": {"type": "integer", "minimum": 1, "maximum": 365}}, "required": []}},
    {"name": "get_seasonal_factors",
     "description": "Seasonal considerations entered by staff (season, festival, event or weather assumptions with expected demand change and supply condition; they adjust forecasts and recommendations) plus upcoming calendar festivals. Considerations are MANUAL assumptions, not measured effects.",
     "input_schema": {"type": "object", "properties": {"include_ended": {"type": "boolean"}}, "required": []}},
    {"name": "search_knowledge_base",
     "description": "Search PriceIQ's policy documents (pricing constraints, approval workflow, inventory rules, data labels, model limitations, roles). Use for any policy or 'how does PriceIQ…' question.",
     "input_schema": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}},
]


class ToolBox:
    def __init__(self, store_id: str, user_token: str, org_id: str | None):
        self.store_id, self.org_id = store_id, org_id
        self.base = f"{get_settings().go_api_url}/api/v1/stores/{store_id}"
        self.headers = {"Authorization": user_token} if user_token.lower().startswith("bearer ") \
            else {"Authorization": f"Bearer {user_token}"}
        self.client = httpx.AsyncClient(timeout=90, headers=self.headers)
        self.sources: list[dict] = []

    async def close(self) -> None:
        await self.client.aclose()

    async def _get(self, path: str, **params) -> Any:
        r = await self.client.get(self.base + path, params={k: v for k, v in params.items() if v is not None})
        return self._json(r)

    async def _post(self, path: str, body: dict) -> Any:
        r = await self.client.post(self.base + path, json=body)
        return self._json(r)

    @staticmethod
    def _json(r: httpx.Response) -> Any:
        if r.status_code >= 400:
            try:
                msg = r.json().get("error", {}).get("message", r.text)
            except Exception:
                msg = r.text
            raise ToolError(f"{r.status_code}: {msg}")
        return r.json()

    async def resolve(self, product: str) -> dict:
        p = (product or "").strip()
        if UUID_RE.match(p):
            return await self._get(f"/products/{p}")
        res = await self._get("/products", q=p, page_size=10)
        items = res.get("data", [])
        if not items:
            raise ToolError(f"No product matches '{product}'")
        exact = [i for i in items if i["name"].lower() == p.lower() or i["sku"].lower() == p.lower()]
        if len(exact) == 1 or len(items) == 1:
            return (exact or items)[0]
        raise ToolError("Ambiguous product; candidates: " + "; ".join(f"{i['name']} (SKU {i['sku']}, id {i['id']})" for i in items[:6]))

    # ── tools ───────────────────────────────────────────────────────────────
    async def find_products(self, query: str = "", stock_status: str | None = None, expiring_within_days: int | None = None, limit: int = 20):
        res = await self._get("/products", q=query or None, stock_status=stock_status, expiring_within=expiring_within_days,
                              page_size=limit, sort="name")
        return {"total": res["total"], "products": [
            {"id": p["id"], "name": p["name"], "sku": p["sku"], "category": p["category"], "price": p["selling_price"],
             "mrp": p["mrp"], "cost": p["cost_price"], "stock": p["stock"], "days_to_expiry": p["days_to_expiry"],
             "synthetic_data": p["is_synthetic"]} for p in res["data"]]}

    async def get_product(self, product: str):
        p = await self.resolve(product)
        inv = await self._get(f"/products/{p['id']}/inventory")
        return {"product": {k: p[k] for k in ("id", "name", "sku", "brand", "category", "selling_price", "cost_price", "mrp",
                                              "stock", "expiry_date", "days_to_expiry", "margin_pct", "is_synthetic")},
                "inventory": {k: inv.get(k) for k in ("avg_daily_units", "days_of_cover", "predicted_stockout_date",
                                                      "recommended_safety_stock", "reorder_point", "recommended_reorder_qty",
                                                      "units_at_expiry_risk", "expiry_risk", "statuses", "data_sufficiency", "last_sold_at")}}

    async def get_inventory(self, status: str | None = None, limit: int = 15):
        ov = await self._get("/inventory")
        items = [p for p in ov["products"] if status is None or status in p["statuses"]]
        items.sort(key=lambda p: (p["days_of_cover"] if p["days_of_cover"] is not None else 1e9))
        return {"reference_time": ov["reference_time"], "data_mode": ov["data_mode"], "value_at_cost": ov["value_at_cost"],
                "value_at_retail": ov["value_at_retail"], "status_counts": ov["status_counts"],
                "expiry_risk_counts": ov["expiry_risk_counts"], "matching": len(items),
                "products": [{k: p.get(k) for k in ("product_id", "name", "stock", "avg_daily_units", "days_of_cover",
                                                    "predicted_stockout_date", "recommended_reorder_qty", "days_to_expiry",
                                                    "units_at_expiry_risk", "expiry_risk", "statuses", "data_sufficiency")}
                             for p in items[:limit]]}

    async def get_sales(self, days: int = 30, product: str | None = None):
        s = await self._get("/analytics/summary", days=days)
        out = {"range": s["range"], "data_mode": s["data_mode"], "current": s["current"], "previous": s["previous"],
               "avg_margin_pct": s["avg_margin_pct"], "revenue_change_pct": s["revenue_change_pct"],
               "profit_change_pct": s["profit_change_pct"], "units_change_pct": s["units_change_pct"]}
        if product:
            p = await self.resolve(product)
            t = await self._get("/analytics/trends", days=days, product_id=p["id"])
            pts = t["points"]
            out["product"] = {"id": p["id"], "name": p["name"], "revenue": round(sum(x["revenue"] for x in pts), 2),
                              "profit": round(sum(x["profit"] for x in pts), 2), "units": sum(x["units"] for x in pts),
                              "last_7_days": pts[-7:]}
        return out

    async def get_profit_analysis(self, days: int = 30, sort: str = "profit", order: str = "desc", limit: int = 10):
        r = await self._get("/analytics/products", days=days, sort=sort, order=order, limit=limit)
        return r

    async def get_forecast(self, product: str, horizon: int = 7):
        p = await self.resolve(product)
        f = await self._get(f"/products/{p['id']}/forecast", horizon=horizon)
        return {k: f.get(k) for k in ("product_name", "horizon", "price", "model_version", "training_data", "total_predicted_demand",
                                      "total_expected_sales", "avg_daily_demand", "recent_avg_daily_units", "trend", "peak",
                                      "stockout_date", "accuracy", "confidence", "warnings")} | {
            "days": [{k: d[k] for k in ("date", "predicted_demand", "lower_bound", "upper_bound", "expected_sales")} for d in f["points"]]}

    async def get_competitor_prices(self, product: str | None = None):
        if product:
            p = await self.resolve(product)
            c = await self._get(f"/products/{p['id']}/competitors")
            return {"product": c["product_name"], "market": c["market"], "observations": [
                {k: o.get(k) for k in ("competitor_name", "status", "price", "mrp", "discount_pct", "in_stock", "external_name",
                                       "pack_size", "observed_at", "diff_pct", "error", "linked")} for o in c["observations"]]}
        ov = await self._get("/competitors")
        with_data = [p for p in ov["products"] if p["market"]["observed_count"] > 0]
        return {"status_counts": ov["status_counts"], "products_with_market_data": ov["products_with_market_data"],
                "products_above_market": ov["products_above_market"], "avg_gap_pct": ov["avg_gap_pct"],
                "products": [{"name": p["product_name"], "our_price": p["market"]["our_price"], "market_avg": p["market"]["average"],
                              "lowest": p["market"]["lowest"], "lowest_platform": p["market"]["lowest_platform"],
                              "diff_vs_avg_pct": p["market"]["diff_vs_avg_pct"], "position": p["market"]["position"]} for p in with_data[:25]],
                "note": "Only observed prices count (LIVE, MANUAL_VERIFIED, CACHED); products without them have no competitor data."}

    async def get_price_recommendation(self, product: str, generate: bool = False):
        p = await self.resolve(product)
        if generate:
            r = await self._post("/pricing/recommendations", {"product_id": p["id"]})
        else:
            res = await self._get("/pricing/recommendations", product_id=p["id"], page_size=1)
            if not res["data"]:
                return {"product": p["name"], "recommendation": None,
                        "note": "No recommendation exists yet. Call again with generate=true to create one (no price is changed)."}
            r = res["data"][0]
        ex = r.get("explanation") or {}
        return {"product": r["product_name"], "id": r["id"], "status": r["status"], "created_at": r["created_at"],
                "current_price": r["current_price"], "recommended_price": r["recommended_price"], "model_price": r["model_price"],
                "change_pct": round(r["change_pct"], 2), "expected_demand_per_day": r["expected_demand"],
                "expected_profit_per_day": r["expected_profit"], "confidence": r["confidence"], "policy": r["policy"],
                "requires_approval": r["requires_approval"], "constraints_applied": r["constraints_applied"],
                "summary": ex.get("summary"), "factors": [{"label": f.get("label"), "detail": f.get("detail")} for f in ex.get("factors", [])],
                "impact": {k: v for k, v in (ex.get("impact") or {}).items() if k not in ("current", "recommended")},
                "top_model_drivers": [{"feature": s["label"], "effect_pct": s.get("effect_pct")} for s in (ex.get("shap") or {}).get("top", [])[:5]],
                "data_provenance": ex.get("data_provenance"), "generated_now": generate}

    async def list_pricing_opportunities(self, limit: int = 10):
        res = await self._get("/pricing/recommendations", status="PENDING", page_size=100)
        items = []
        for r in res["data"]:
            imp = (r.get("explanation") or {}).get("impact") or {}
            items.append({"product": r["product_name"], "current_price": r["current_price"], "recommended_price": r["recommended_price"],
                          "profit_change_pct": imp.get("profit_change_pct"), "expected_profit_per_day": r["expected_profit"],
                          "requires_approval": r["requires_approval"], "created_at": r["created_at"]})
        items.sort(key=lambda x: -(x["profit_change_pct"] or -1e9))
        return {"pending": len(items), "opportunities": items[:limit],
                "note": None if items else "No pending recommendations. Generate recommendations first (Pricing page or get_price_recommendation with generate=true)."}

    async def simulate_price(self, product: str, prices: list[float] | None = None, scenarios: list[dict] | None = None):
        p = await self.resolve(product)
        return await self._post("/pricing/simulate", {"product_id": p["id"], "prices": prices or [], "scenarios": scenarios or []})

    async def get_expiry_risk(self, limit: int = 10):
        r = await self._get("/inventory/expiry-optimization")
        return {"window_days": r["window_days"], "floor": r["floor"], "items": [
            {k: i[k] for k in ("product_name", "stock", "days_to_expiry", "current_price", "expiry_risk", "waste_reduction_units", "profit_gain")}
            | {"waste_at_current_price": i["at_current_price"]["waste_units"], "recommended_markdown_pct": i["recommended"]["markdown_pct"],
               "recommended_price": i["recommended"]["price"], "liquidation_pct": i["recommended"]["liquidation_pct"]}
            for i in r["items"][:limit]]}

    async def get_alerts(self, severity: str | None = None, type: str | None = None, limit: int = 20):
        r = await self._get("/alerts", severity=severity, type=type, page_size=limit)
        return {"total_open": r["total"], "alerts": [{k: a[k] for k in ("severity", "alert_type", "title", "message", "product_name", "created_at")}
                                                      for a in r["data"]]}

    async def get_analytics(self, days: int = 30):
        s = await self._get("/analytics/summary", days=days)
        c = await self._get("/analytics/categories", days=days)
        return {"summary": s, "categories": c["categories"]}

    async def get_seasonal_factors(self, include_ended: bool = False):
        cons = await self._get("/seasonal/considerations")
        events = await self._get("/seasonal/events")
        keep = ("name", "kind", "scope", "product_name", "category_name", "start_date", "end_date", "expected_demand_change_pct",
                "supply_condition", "phase", "days_until", "notes")
        return {"considerations": [{k: c.get(k) for k in keep} for c in cons
                                   if c.get("is_active") and (include_ended or c.get("phase") != "ENDED")],
                "upcoming_calendar_events": [{k: e.get(k) for k in ("name", "event_type", "start_date", "end_date", "days_until", "is_date_approximate")}
                                             for e in events if 0 <= e.get("days_until", -1) <= 60][:8],
                "note": "Considerations are MANUAL planning assumptions entered by staff, not measured effects. Dates are relative to today."}

    async def search_knowledge_base(self, query: str):
        hits = rag.search(query, self.org_id, k=4)
        for h in hits:
            if h["source"] not in [s["source"] for s in self.sources]:
                self.sources.append({"title": h["title"], "source": h["source"]})
        return {"passages": [{"title": h["title"], "content": h["content"], "score": h["score"]} for h in hits]}

    async def run(self, name: str, args: dict) -> Any:
        fn = getattr(self, name, None)
        if fn is None or name.startswith("_") or name not in {t["name"] for t in TOOL_DEFINITIONS}:
            raise ToolError(f"Unknown tool {name}")
        return await fn(**(args or {}))


def new_call_id() -> str:
    return uuid.uuid4().hex[:12]
