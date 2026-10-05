"""
agents/fallback.py — deterministic Retail Copilot used without an LLM.

Maps the question to intents by keywords, calls the same controlled tools
(as the user) and formats the results. It never makes up numbers: every
figure comes from a tool result, and missing data is reported as such.
"""

from __future__ import annotations

import re

from app.agents.tools import ToolBox, ToolError

INTENTS = [
    ("policy", ["policy", "rule", "constraint", "how does", "what is mrp", "approval", "mode", "role", "margin rule", "synthetic", "why can't", "allowed"]),
    ("why_price", ["why", "recommend", "explain"]),
    ("simulate", ["what happens", "what if", "if i reduce", "if i increase", "reduce this price", "lower the price", "raise the price", "simulate"]),
    ("stockout", ["stock out", "stockout", "run out", "out of stock", "reorder", "low stock", "low inventory", "low on stock", "high demand but low stock"]),
    ("seasonal", ["season", "festival", "weather", "monsoon", "diwali"]),
    ("top_selling", ["top-selling", "top selling", "best-selling", "best selling", "bestseller", "sell the most", "most sold"]),
    ("expiry", ["expiry", "expire", "expiring", "waste", "shelf life", "markdown"]),
    ("competitor", ["competitor", "cheaper", "blinkit", "zepto", "instamart", "bigbasket", "market price", "undercut"]),
    ("profit", ["most profit", "profitable", "top products", "revenue", "profit"]),
    ("opportunities", ["opportunit", "pricing opportunities", "biggest"]),
    ("alerts", ["alert", "notification", "anomal", "issue"]),
    ("forecast", ["forecast", "demand next", "predict", "next week", "next month"]),
    ("greeting", ["hello", "hi ", "hey", "help", "what can you"]),
]


def classify(msg: str) -> str:
    m = " " + msg.lower() + " "
    best, score = "unknown", 0
    for intent, kws in INTENTS:
        s = sum(1 for k in kws if k in m)
        if s > score:
            best, score = intent, s
    return best


def _money(x) -> str:
    return "—" if x is None else f"₹{x:,.2f}"


async def _product_hint(box: ToolBox, msg: str) -> dict | None:
    """Find a product mentioned in the message (longest matching name)."""
    res = await box.find_products("", limit=50)
    low = msg.lower()
    found = [p for p in res["products"] if p["name"].lower() in low or p["sku"].lower() in low]
    if not found:
        words = [w for w in re.findall(r"[a-z0-9']+", low) if len(w) > 3]
        scored = [(sum(w in p["name"].lower() for w in words), p) for p in res["products"]]
        scored = [x for x in scored if x[0] >= 2]
        found = [max(scored, key=lambda x: x[0])[1]] if scored else []
    return max(found, key=lambda p: len(p["name"])) if found else None


async def answer(box: ToolBox, msg: str) -> dict:
    intent = classify(msg)
    calls: list[dict] = []

    async def tool(name, **kw):
        try:
            r = await box.run(name, kw)
            calls.append({"tool": name, "input": kw, "ok": True})
            return r
        except ToolError as exc:
            calls.append({"tool": name, "input": kw, "ok": False, "error": str(exc)})
            raise

    try:
        text = await _dispatch(intent, box, msg, tool)
    except ToolError as exc:
        text = f"I couldn't retrieve that data: {exc}"
    return {"answer": text, "tool_calls": calls, "sources": box.sources, "mode": "rule_based", "model": None, "intent": intent}


async def _dispatch(intent: str, box: ToolBox, msg: str, tool) -> str:
    if intent == "stockout":
        r = await tool("get_inventory", status="PREDICTED_STOCKOUT", limit=10)
        low = await tool("get_inventory", status="LOW_STOCK", limit=10)
        rows = {p["product_id"]: p for p in r["products"] + low["products"]}.values()
        if not rows:
            return "No products are currently low on stock or predicted to stock out."
        lines = [f"| {p['name']} | {p['stock']} | {p['avg_daily_units']} | {p['days_of_cover'] if p['days_of_cover'] is not None else '—'} | {p['recommended_reorder_qty']} |" for p in rows]
        note = " (Synthetic/Training Data)" if r["data_mode"] == "SYNTHETIC" else ""
        return ("**Products at risk of stocking out**" + note + "\n\n| Product | Stock | Units/day | Days of cover | Reorder qty |\n|---|---|---|---|---|\n"
                + "\n".join(lines))
    if intent == "expiry":
        r = await tool("get_expiry_risk", limit=10)
        if not r["items"]:
            return "No products with stock expire within the markdown window."
        lines = [f"| {i['product_name']} | {i['days_to_expiry']} | {i['stock']} | {i['waste_at_current_price']:.0f} | {i['recommended_markdown_pct']:.0f}% → {_money(i['recommended_price'])} | {i['waste_reduction_units']:.0f} |" for i in r["items"]]
        return ("**Products close to expiry**\n\n| Product | Days left | Stock | Waste at current price | Recommended markdown | Waste avoided |\n|---|---|---|---|---|---|\n"
                + "\n".join(lines) + f"\n\nMarkdowns never go below {r['floor']}.")
    if intent == "competitor":
        p = await _product_hint(box, msg)
        if p:
            c = await tool("get_competitor_prices", product=p["id"])
            obs = "\n".join(f"- {o['competitor_name']}: {_money(o['price'])} [{o['status']}]" + (f" — {o['error']}" if o.get("error") and o["status"] == "UNAVAILABLE" else "")
                            for o in c["observations"])
            m = c["market"]
            head = (f"Market average {_money(m['average'])}; our price {_money(m['our_price'])} ({m['diff_vs_avg_pct']:+.1f}% vs market)."
                    if m["average"] else "No live or cached competitor prices exist for this product.")
            return f"**{c['product']}** — {head}\n\n{obs}"
        c = await tool("get_competitor_prices")
        cheaper = [x for x in c["products"] if x["lowest"] is not None and x["lowest"] < x["our_price"]]
        if not c["products"]:
            return "No competitor prices are available yet (all platforms UNAVAILABLE or no listings linked). Link listings from Competitor Search or record manual observations."
        return "**Products where a competitor is cheaper**\n\n" + "\n".join(
            f"- {x['name']}: ours {_money(x['our_price'])}, lowest {_money(x['lowest'])} on {x['lowest_platform']}" for x in cheaper) \
            if cheaper else "We are not undercut on any product with live/cached competitor data."
    if intent == "profit":
        r = await tool("get_profit_analysis", days=30, sort="profit", limit=10)
        return "**Top products by profit (last 30 days of data)**\n\n| Product | Profit | Revenue | Units | Margin |\n|---|---|---|---|---|\n" + "\n".join(
            f"| {p['name']} | {_money(p['profit'])} | {_money(p['revenue'])} | {p['units']} | {p['margin_pct']:.1f}% |" for p in r["products"])
    if intent == "top_selling":
        r = await tool("get_profit_analysis", days=30, sort="units", limit=10)
        return "**Top-selling products by units (last 30 days of data)**\n\n| Product | Units | Revenue | Profit |\n|---|---|---|---|\n" + "\n".join(
            f"| {p['name']} | {p['units']} | {_money(p['revenue'])} | {_money(p['profit'])} |" for p in r["products"])
    if intent == "seasonal":
        r = await tool("get_seasonal_factors")
        lines = [f"- **{c['name']}** ({c['kind'].lower()}, {c['phase'].lower()}, {c['start_date']} → {c['end_date']}): "
                 f"{(c.get('product_name') or c.get('category_name') or 'whole store')}, expected demand {c['expected_demand_change_pct']:+.0f}%, supply {c['supply_condition'].lower()}"
                 for c in r["considerations"]]
        ev = [f"- {e['name']}: {e['start_date']} (in {e['days_until']} days){' — date approximate' if e.get('is_date_approximate') else ''}"
              for e in r["upcoming_calendar_events"]]
        head = ("**Seasonal considerations in effect or upcoming** (manual planning assumptions entered by staff, not measured effects)\n\n" + "\n".join(lines)
                if lines else "No seasonal considerations are active or upcoming for this store.")
        return head + ("\n\n**Calendar events in the next 60 days**\n\n" + "\n".join(ev) if ev else "")
    if intent == "opportunities":
        r = await tool("list_pricing_opportunities", limit=10)
        if not r["opportunities"]:
            return r["note"]
        return "**Biggest pricing opportunities (pending recommendations)**\n\n" + "\n".join(
            f"- {o['product']}: {_money(o['current_price'])} → {_money(o['recommended_price'])} (expected profit {o['profit_change_pct']:+.1f}%)"
            for o in r["opportunities"] if o["profit_change_pct"] is not None)
    if intent == "alerts":
        r = await tool("get_alerts", limit=10)
        if not r["alerts"]:
            return "There are no open alerts."
        return f"**{r['total_open']} open alert(s)**\n\n" + "\n".join(f"- [{a['severity']}] {a['title']}" for a in r["alerts"])
    if intent in ("why_price", "simulate", "forecast"):
        p = await _product_hint(box, msg)
        if not p:
            return "I couldn't find a product from your question in this store. Mention its exact name or SKU (products of other stores are not visible here)."
        if intent == "why_price":
            r = await tool("get_price_recommendation", product=p["id"])
            if not r.get("recommended_price"):
                r = await tool("get_price_recommendation", product=p["id"], generate=True)
            factors = "\n".join(f"- **{f['label']}**: {f['detail']}" for f in r["factors"])
            cons = "\n".join(f"- {c['rule']}: {c['message']}" for c in r["constraints_applied"]) or "- none"
            return (f"**{r['product']}** — {r['summary']}\n\n{factors}\n\n**Constraints applied**\n{cons}\n\n"
                    f"Confidence {r['confidence']:.2f}; status {r['status']}. No price has been changed.")
        if intent == "simulate":
            pct = re.search(r"(\d+(?:\.\d+)?)\s*%", msg)
            sign = -1 if any(w in msg.lower() for w in ("reduce", "lower", "cut", "decrease", "drop")) else 1
            change = sign * float(pct.group(1)) if pct else -5.0
            r = await tool("simulate_price", product=p["id"], scenarios=[{"type": "our_price_change", "pct": change}])
            sc = r["scenarios"][0]
            res, cur = sc["result"], r["current"]
            return (f"**{r['product_name']}: {sc['label']}** over {r['horizon_days']} days\n\n"
                    f"- Demand: {cur['demand']:.1f} → {res['demand']:.1f} units/day\n- Revenue: {_money(cur['revenue'])} → {_money(res['revenue'])} per day\n"
                    f"- Profit (net of expected waste): {_money(cur['profit'])} → {_money(res['profit'])} per day\n- Margin: {cur['margin_pct']:.1f}% → {res['margin_pct']:.1f}%\n"
                    f"- Risk: {sc['risk']['level']} — {sc['risk']['reason']}")
        r = await tool("get_forecast", product=p["id"], horizon=7)
        return (f"**{r['product_name']} — 7-day forecast**: {r['total_predicted_demand']:.0f} units ({r['avg_daily_demand']:.1f}/day, trend {r['trend']}, "
                f"confidence {r['confidence']}).\n\n" + "\n".join(f"- {w}" for w in r["warnings"]))
    if intent == "policy":
        r = await tool("search_knowledge_base", query=msg)
        if not r["passages"]:
            return "I couldn't find that in the PriceIQ knowledge base."
        top = r["passages"][0]
        return f"From **{top['title']}**:\n\n{top['content']}"
    if intent == "greeting":
        return ("I can answer questions from your store's live data, for example:\n- Which products may stock out?\n- Which products are close to expiry?\n"
                "- Which competitors are cheaper?\n- Why was this price recommended?\n- What happens if I reduce the price of Amul Butter by 5%?\n"
                "- Which products generated the most profit?\n- Show my biggest pricing opportunities.")
    r = await tool("search_knowledge_base", query=msg)
    if r["passages"]:
        return f"I'm not sure I understood. The closest policy passage is from **{r['passages'][0]['title']}**:\n\n{r['passages'][0]['content'][:800]}"
    return "I'm not sure I understood. Try asking about stock-outs, expiry, competitor prices, profits, forecasts or a product's price recommendation."
