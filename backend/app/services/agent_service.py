"""
services/agent_service.py — Conversational AI Agent Engine
==========================================================
Rule-based intent classification and structured response generation
for shop owner queries about pricing, inventory, and competitors.

Intent classification
---------------------
Uses keyword matching with priority rules:
  1. pricing_explanation  → Why was this price recommended?
  2. discount_suggestions → Which products should be discounted today?
  3. expiry_risk          → What products are at expiry risk?
  4. competitor_comparison→ How does my pricing compare with competitors?
  5. profit_impact        → What is the expected profit impact?
  6. general_greeting     → Hello, Hi, etc.
  7. general_help         → Help, what can you do?
  8. fallback             → Unrecognised queries

Each handler queries the actual database and ML models to produce
real, data-backed responses — not canned text.
"""

from typing import Optional
from sqlalchemy.orm import Session

from app.models.product import Product
from app.services.pricing_engine import recommend_price, simulate_price
from app.services.competitor_service import get_competitor_prices, get_pricing_strategy
from app.services.inventory_service import get_expiry_risk, get_inventory_alerts
from app.services.forecasting_service import generate_forecast


# ── Intent patterns ──────────────────────────────────────────────────────────
INTENT_PATTERNS = [
    {
        "intent": "pricing_explanation",
        "keywords": ["why", "recommend", "price", "explanation", "explain", "reasoning",
                     "how did you", "how was", "logic", "justified"],
        "min_match": 2,
    },
    {
        "intent": "discount_suggestions",
        "keywords": ["discount", "should be discounted", "mark down", "reduce price",
                     "sale today", "promotions", "deals", "clearance"],
        "min_match": 1,
    },
    {
        "intent": "expiry_risk",
        "keywords": ["expiry", "expiring", "expire", "shelf life", "waste",
                     "about to expire", "at risk", "spoilage"],
        "min_match": 1,
    },
    {
        "intent": "competitor_comparison",
        "keywords": ["competitor", "blinkit", "zepto", "instamart", "bigbasket",
                     "market", "compare", "comparison", "competitive",
                     "other platforms", "how does my"],
        "min_match": 1,
    },
    {
        "intent": "profit_impact",
        "keywords": ["profit", "impact", "revenue", "margin", "what if",
                     "changing price", "expected profit", "how much will",
                     "earnings", "financial"],
        "min_match": 1,
    },
    {
        "intent": "general_greeting",
        "keywords": ["hello", "hi", "hey", "good morning", "good evening",
                     "greetings", "howdy"],
        "min_match": 1,
    },
    {
        "intent": "general_help",
        "keywords": ["help", "what can you", "capabilities", "what do you",
                     "features", "guide", "how to use"],
        "min_match": 1,
    },
]


def _classify_intent(message: str) -> str:
    """Classify user message into an intent using keyword matching."""
    msg_lower = message.lower()

    for pattern in INTENT_PATTERNS:
        matches = sum(1 for kw in pattern["keywords"] if kw in msg_lower)
        if matches >= pattern["min_match"]:
            return pattern["intent"]

    return "fallback"


def _extract_product_id(message: str) -> Optional[int]:
    """Try to extract a product ID from the message."""
    import re
    patterns = [
        r'product\s*#?\s*(\d+)',
        r'#(\d+)',
        r'product_id\s*[:=]?\s*(\d+)',
        r'\b(\d+)\b',
    ]
    for pat in patterns:
        match = re.search(pat, message, re.IGNORECASE)
        if match:
            return int(match.group(1))
    return None


def process_message(message: str, db: Session) -> dict:
    """
    Process a user chat message and generate a structured response.

    Parameters
    ----------
    message : str
        The user's natural language query.
    db : Session
        Database session for querying product data.

    Returns
    -------
    dict with keys:
        intent, response_text, data (optional), data_type,
        confidence, suggestions (follow-up questions)
    """
    intent = _classify_intent(message)
    product_id = _extract_product_id(message)

    handler = INTENT_HANDLERS.get(intent, _handle_fallback)
    return handler(message, db, product_id)


def _handle_pricing_explanation(message: str, db: Session,
                                 product_id: Optional[int]) -> dict:
    """Explain why a particular price was recommended."""
    if product_id is None:
        # If no product specified, pick the first product as example
        product = db.query(Product).first()
        if not product:
            return _no_products_response()
        product_id = product.product_id
    else:
        product = db.query(Product).filter(
            Product.product_id == product_id
        ).first()
        if not product:
            return _product_not_found(product_id)

    rec = recommend_price(
        product_id=product.product_id,
        category=product.category,
        cost_price=product.cost_price,
        mrp=product.mrp,
        current_price=product.current_price,
        stock_level=product.stock_level,
        days_to_expiry=product.days_to_expiry,
        season_factor=product.season_factor,
    )

    constraint = rec.get("constraint_applied") or "none"
    constraint_explanations = {
        "expiry_discount": (
            f"An **expiry discount** was applied because the product expires "
            f"in just {product.days_to_expiry} day(s). The price was capped "
            f"near cost to accelerate sales and minimise waste."
        ),
        "min_margin": (
            "A **minimum margin constraint** was applied to ensure the price "
            "stays at least 15% above the cost price, protecting profitability."
        ),
        "max_increase": (
            "A **max increase constraint** was triggered because the bandit's "
            "optimal price was more than 10% above the current price. "
            "Price jumps are capped to prevent customer shock."
        ),
        "none": (
            "No constraints were triggered — the Thompson Sampling bandit "
            "selected this price freely based on historical profit patterns."
        ),
    }

    explanation = constraint_explanations.get(constraint, constraint_explanations["none"])

    text = (
        f"**Price Recommendation for {product.name}** "
        f"({product.category}, #{product.product_id})\n\n"
        f"📊 **Recommended Price**: ₹{rec['recommended_price']}\n"
        f"📈 **Expected Demand**: {rec['expected_demand']} units\n"
        f"💰 **Expected Profit**: ₹{rec['expected_profit']}\n\n"
        f"**How it was decided:**\n\n"
        f"1. The **Thompson Sampling bandit** evaluated 10 price points "
        f"between ₹{round(product.cost_price * 1.05, 2)} and "
        f"₹{product.mrp} using learned profit distributions.\n\n"
        f"2. The **XGBoost demand model** predicted how many units would "
        f"sell at each price, factoring in seasonality "
        f"(×{product.season_factor}), stock level ({product.stock_level}), "
        f"and expiry ({product.days_to_expiry}d).\n\n"
        f"3. {explanation}"
    )

    return {
        "intent": "pricing_explanation",
        "response_text": text,
        "data": {
            "product_id": product.product_id,
            "product_name": product.name,
            "category": product.category,
            "current_price": product.current_price,
            "recommended_price": rec["recommended_price"],
            "expected_demand": rec["expected_demand"],
            "expected_profit": rec["expected_profit"],
            "constraint": constraint,
        },
        "data_type": "pricing",
        "confidence": 0.95,
        "suggestions": [
            f"What's the profit impact if I set {product.name} to ₹{round(product.mrp * 0.85, 2)}?",
            f"How does {product.name} compare with competitors?",
            "Which products should be discounted today?",
        ],
    }


def _handle_discount_suggestions(message: str, db: Session,
                                  product_id: Optional[int]) -> dict:
    """Identify products that should be discounted today."""
    products = db.query(Product).all()
    if not products:
        return _no_products_response()

    # Products to discount: expiring soon, overstocked, or both
    candidates = []
    for p in products:
        reasons = []
        priority = 0

        if p.days_to_expiry < 3:
            reasons.append(f"Expires in {p.days_to_expiry}d (critical)")
            priority += 3
        elif p.days_to_expiry < 7:
            reasons.append(f"Expires in {p.days_to_expiry}d")
            priority += 2

        if p.stock_level > 150:
            reasons.append(f"Overstocked ({p.stock_level} units)")
            priority += 1

        if reasons:
            markdown = min(40, max(10, (7 - p.days_to_expiry) * 8 +
                                  max(0, (p.stock_level - 100) // 20)))
            suggested = round(p.current_price * (1 - markdown / 100), 2)
            suggested = max(suggested, p.cost_price * 1.05)

            candidates.append({
                "product_id": p.product_id,
                "product_name": p.name,
                "category": p.category,
                "current_price": p.current_price,
                "suggested_price": suggested,
                "markdown_pct": markdown,
                "reasons": reasons,
                "priority": priority,
                "days_to_expiry": p.days_to_expiry,
                "stock_level": p.stock_level,
            })

    candidates.sort(key=lambda x: x["priority"], reverse=True)
    top = candidates[:10]

    if not top:
        text = (
            "✅ **No products need discounting today!**\n\n"
            "All products have healthy stock levels and expiry dates. "
            "Current pricing strategy is working well."
        )
    else:
        lines = [f"🏷️ **{len(top)} products recommended for discount today:**\n"]
        for c in top:
            lines.append(
                f"• **{c['product_name']}** ({c['category']}, #{c['product_id']}): "
                f"₹{c['current_price']} → ₹{c['suggested_price']} "
                f"(-{c['markdown_pct']}%) — {', '.join(c['reasons'])}"
            )
        text = "\n".join(lines)

    return {
        "intent": "discount_suggestions",
        "response_text": text,
        "data": top,
        "data_type": "discount_table",
        "confidence": 0.90,
        "suggestions": [
            "What products are at expiry risk?",
            "What's the expected profit impact of these discounts?",
            "How do our prices compare with competitors?",
        ],
    }


def _handle_expiry_risk(message: str, db: Session,
                         product_id: Optional[int]) -> dict:
    """List products at expiry risk."""
    products = db.query(Product).all()
    if not products:
        return _no_products_response()

    at_risk = get_expiry_risk(products)

    if not at_risk:
        text = (
            "✅ **No products at expiry risk!**\n\n"
            "All products have more than 14 days until expiry. "
            "Inventory health looks good."
        )
    else:
        critical = [p for p in at_risk if p["risk_level"] == "critical"]
        warning = [p for p in at_risk if p["risk_level"] == "warning"]
        watch = [p for p in at_risk if p["risk_level"] == "watch"]

        total_waste = sum(p["potential_waste_value"] for p in at_risk)

        lines = [
            f"⚠️ **{len(at_risk)} products at expiry risk** "
            f"(potential waste: ₹{round(total_waste, 2)})\n"
        ]

        if critical:
            lines.append(f"\n🔴 **CRITICAL** ({len(critical)} products — expires in < 3 days):")
            for p in critical:
                name = p.get("product_name") or f"Product #{p['product_id']}"
                lines.append(
                    f"  • {name} ({p['category']}, #{p['product_id']}): "
                    f"{p['days_to_expiry']}d left, {p['stock_level']} units, "
                    f"recommend -{p['markdown_pct']}% → ₹{p['suggested_price']}"
                )

        if warning:
            lines.append(f"\n🟡 **WARNING** ({len(warning)} products — expires in 3-7 days):")
            for p in warning:
                name = p.get("product_name") or f"Product #{p['product_id']}"
                lines.append(
                    f"  • {name} ({p['category']}, #{p['product_id']}): "
                    f"{p['days_to_expiry']}d left, {p['stock_level']} units, "
                    f"recommend -{p['markdown_pct']}%"
                )

        if watch:
            lines.append(f"\n🟢 **WATCH** ({len(watch)} products — expires in 7-14 days):")
            for p in watch[:5]:
                name = p.get("product_name") or f"Product #{p['product_id']}"
                lines.append(
                    f"  • {name} ({p['category']}, #{p['product_id']}): "
                    f"{p['days_to_expiry']}d left"
                )

        text = "\n".join(lines)

    return {
        "intent": "expiry_risk",
        "response_text": text,
        "data": at_risk,
        "data_type": "expiry_table",
        "confidence": 0.95,
        "suggestions": [
            "Which products should be discounted today?",
            "What's the total potential waste value?",
            "Show me the inventory overview",
        ],
    }


def _handle_competitor_comparison(message: str, db: Session,
                                   product_id: Optional[int]) -> dict:
    """Compare pricing with competitors."""
    if product_id is not None:
        product = db.query(Product).filter(
            Product.product_id == product_id
        ).first()
        if not product:
            return _product_not_found(product_id)

        comp = get_competitor_prices(
            product.product_id, product.cost_price, product.mrp,
            product.category, product.current_price
        )

        lines = [
            f"📊 **Competitor Comparison for {product.name}** "
            f"({product.category}, #{product.product_id})\n",
            f"**Our Price**: ₹{product.current_price}",
            f"**Market Average**: ₹{comp['market_avg']}",
            f"**Competitiveness Score**: {comp['competitiveness_score']}/100\n",
            "| Platform | Price | vs Ours |",
            "|----------|-------|---------|",
        ]
        for c in comp["competitors"]:
            diff_str = f"+{c['diff_pct']}%" if c['diff_pct'] > 0 else f"{c['diff_pct']}%"
            lines.append(f"| {c['platform']} | ₹{c['price']} | {diff_str} |")

        text = "\n".join(lines)
        data = comp
    else:
        products = db.query(Product).limit(10).all()
        if not products:
            return _no_products_response()

        results = []
        below_avg = 0
        above_avg = 0
        for p in products:
            comp = get_competitor_prices(
                p.product_id, p.cost_price, p.mrp,
                p.category, p.current_price
            )
            if comp["competitiveness_score"] >= 50:
                below_avg += 1
            else:
                above_avg += 1
            results.append(comp)

        avg_score = round(sum(r["competitiveness_score"] for r in results) / len(results), 1)
        text = (
            f"📊 **Market Competitiveness Overview**\n\n"
            f"Across {len(results)} products:\n"
            f"• **Average competitiveness score**: {avg_score}/100\n"
            f"• **Competitively priced**: {below_avg} products\n"
            f"• **Above market average**: {above_avg} products\n\n"
            f"Visit the Competitor Analysis page for detailed per-product "
            f"comparisons with Blinkit, Zepto, Instamart, and BigBasket."
        )
        data = results

    return {
        "intent": "competitor_comparison",
        "response_text": text,
        "data": data,
        "data_type": "competitor_table",
        "confidence": 0.90,
        "suggestions": [
            "Which products are priced above market average?",
            "What pricing strategy should I use for my least competitive products?",
            "Why was this price recommended?",
        ],
    }


def _handle_profit_impact(message: str, db: Session,
                           product_id: Optional[int]) -> dict:
    """Estimate profit impact of pricing changes."""
    if product_id is None:
        product = db.query(Product).first()
        if not product:
            return _no_products_response()
        product_id = product.product_id
    else:
        product = db.query(Product).filter(
            Product.product_id == product_id
        ).first()
        if not product:
            return _product_not_found(product_id)

    # Simulate at 3 price points: -10%, current, +10%
    prices = [
        round(product.current_price * 0.90, 2),
        product.current_price,
        round(min(product.current_price * 1.10, product.mrp), 2),
    ]

    simulations = []
    for price in prices:
        price = max(price, product.cost_price * 1.05)
        price = min(price, product.mrp)
        sim = simulate_price(
            product_id=product.product_id,
            category=product.category,
            cost_price=product.cost_price,
            mrp=product.mrp,
            current_price=product.current_price,
            stock_level=product.stock_level,
            days_to_expiry=product.days_to_expiry,
            season_factor=product.season_factor,
            simulated_price=round(price, 2),
        )
        simulations.append(sim)

    current_sim = simulations[1]
    lines = [
        f"💰 **Profit Impact Analysis for Product #{product.product_id}** "
        f"({product.category})\n",
        "| Scenario | Price | Demand | Profit | Margin |",
        "|----------|-------|--------|--------|--------|",
    ]

    labels = ["-10% Discount", "Current Price", "+10% Premium"]
    for label, sim in zip(labels, simulations):
        profit_delta = sim["expected_profit"] - current_sim["expected_profit"]
        delta_str = f" ({'+' if profit_delta >= 0 else ''}{round(profit_delta, 2)})"
        lines.append(
            f"| {label} | ₹{sim['simulated_price']} | "
            f"{sim['expected_demand']} units | "
            f"₹{sim['expected_profit']}{delta_str} | "
            f"{sim['margin_pct']}% |"
        )

    text = "\n".join(lines)

    return {
        "intent": "profit_impact",
        "response_text": text,
        "data": simulations,
        "data_type": "simulation_table",
        "confidence": 0.90,
        "suggestions": [
            f"Why was product #{product.product_id}'s price recommended?",
            f"How does product #{product.product_id} compare with competitors?",
            "Which products should be discounted today?",
        ],
    }


def _handle_greeting(message: str, db: Session,
                      product_id: Optional[int]) -> dict:
    """Respond to greetings."""
    product_count = db.query(Product).count()

    return {
        "intent": "general_greeting",
        "response_text": (
            f"👋 **Hello! I'm your PriceIQ AI Assistant.**\n\n"
            f"I'm currently monitoring **{product_count} products** "
            f"in your store. I can help you with:\n\n"
            f"• 💰 **Pricing explanations** — Why was a price recommended?\n"
            f"• 🏷️ **Discount suggestions** — What should go on sale today?\n"
            f"• ⚠️ **Expiry alerts** — Which products are at risk?\n"
            f"• 📊 **Competitor analysis** — How do we compare with the market?\n"
            f"• 📈 **Profit impact** — What happens if I change a price?\n\n"
            f"Try asking me a question!"
        ),
        "data": None,
        "data_type": None,
        "confidence": 1.0,
        "suggestions": [
            "Which products should be discounted today?",
            "What products are at expiry risk?",
            "How does my pricing compare with competitors?",
        ],
    }


def _handle_help(message: str, db: Session,
                  product_id: Optional[int]) -> dict:
    """Explain what the agent can do."""
    return {
        "intent": "general_help",
        "response_text": (
            "🤖 **PriceIQ AI Agent — Capabilities**\n\n"
            "I analyse your product data in real-time and can answer:\n\n"
            "**1. Price Recommendations**\n"
            "Ask: *\"Why was product #5's price recommended?\"*\n"
            "I'll explain the Thompson Sampling decision, constraints, "
            "and demand prediction.\n\n"
            "**2. Discount Strategy**\n"
            "Ask: *\"Which products should be discounted today?\"*\n"
            "I'll identify products with expiry risk or excess stock.\n\n"
            "**3. Expiry Risk**\n"
            "Ask: *\"What products are at expiry risk?\"*\n"
            "I'll show critical, warning, and watch-list products.\n\n"
            "**4. Competitor Comparison**\n"
            "Ask: *\"How does product #3 compare with Blinkit/Zepto?\"*\n"
            "I'll show prices across all platforms.\n\n"
            "**5. Profit Impact**\n"
            "Ask: *\"What's the profit impact of changing product #2's price?\"*\n"
            "I'll simulate demand and profit at different price points.\n\n"
            "💡 **Tip**: Include a product number (e.g. #5) for "
            "product-specific answers!"
        ),
        "data": None,
        "data_type": None,
        "confidence": 1.0,
        "suggestions": [
            "Why was product #0's price recommended?",
            "Which products should be discounted today?",
            "How does my pricing compare with competitors?",
        ],
    }


def _handle_fallback(message: str, db: Session,
                      product_id: Optional[int]) -> dict:
    """Handle unrecognised queries."""
    return {
        "intent": "fallback",
        "response_text": (
            "🤔 I'm not sure I understand that question. "
            "I can help with:\n\n"
            "• **Pricing** — \"Why was this price recommended?\"\n"
            "• **Discounts** — \"Which products should be discounted?\"\n"
            "• **Expiry** — \"What products are at expiry risk?\"\n"
            "• **Competitors** — \"How do we compare with Blinkit?\"\n"
            "• **Profit** — \"What's the profit impact of a price change?\"\n\n"
            "Try rephrasing, or pick a suggestion below."
        ),
        "data": None,
        "data_type": None,
        "confidence": 0.3,
        "suggestions": [
            "Which products should be discounted today?",
            "What products are at expiry risk?",
            "How does my pricing compare with competitors?",
        ],
    }


def _no_products_response() -> dict:
    """Helper for when no products exist in the database."""
    return {
        "intent": "error",
        "response_text": "❌ No products found in the database. Please seed the data first.",
        "data": None,
        "data_type": None,
        "confidence": 1.0,
        "suggestions": [],
    }


def _product_not_found(product_id: int) -> dict:
    """Helper for when a specific product doesn't exist."""
    return {
        "intent": "error",
        "response_text": f"❌ Product #{product_id} not found. Please check the product ID and try again.",
        "data": None,
        "data_type": None,
        "confidence": 1.0,
        "suggestions": [
            "Which products should be discounted today?",
            "What products are at expiry risk?",
        ],
    }


def get_suggested_questions(db: Session) -> list:
    """
    Generate contextual suggested questions based on current data state.

    Returns more urgent suggestions when there are products at risk.
    """
    products = db.query(Product).all()
    suggestions = []

    # Check for expiry urgency
    critical = [p for p in products if p.days_to_expiry < 3]
    if critical:
        suggestions.append({
            "text": f"⚠️ {len(critical)} products expire in < 3 days! What should I do?",
            "category": "urgent",
            "icon": "alert",
        })

    suggestions.extend([
        {"text": "Which products should be discounted today?", "category": "pricing", "icon": "tag"},
        {"text": "What products are at expiry risk?", "category": "inventory", "icon": "clock"},
        {"text": "How does my pricing compare with competitors?", "category": "competitor", "icon": "chart"},
        {"text": "Why was product #0's price recommended?", "category": "explanation", "icon": "help"},
        {"text": "What's the profit impact of changing prices?", "category": "profit", "icon": "trending"},
    ])

    return suggestions


# ── Intent → Handler mapping ─────────────────────────────────────────────────
INTENT_HANDLERS = {
    "pricing_explanation": _handle_pricing_explanation,
    "discount_suggestions": _handle_discount_suggestions,
    "expiry_risk": _handle_expiry_risk,
    "competitor_comparison": _handle_competitor_comparison,
    "profit_impact": _handle_profit_impact,
    "general_greeting": _handle_greeting,
    "general_help": _handle_help,
    "fallback": _handle_fallback,
}
