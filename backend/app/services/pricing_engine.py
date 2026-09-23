"""
services/pricing_engine.py — Core Pricing Logic
================================================
Orchestrates the full pricing recommendation pipeline:

    1. Call Thompson Sampling bandit → get best price arm
    2. Apply hard pricing constraints (margin, expiry, MRP cap)
    3. Call XGBoost demand predictor at the constrained price
    4. Compute expected profit = (price - cost) × predicted_demand
    5. Build all 10 arm options with demand/profit for the frontend chart

Also provides a `simulate_price()` helper used by the price simulator slider
on the Product Detail page — does NOT update the bandit, just returns
what-if numbers for any price the user enters.

Constraints applied (in priority order)
-----------------------------------------
1. Expiry discount  : If days_to_expiry < 7, force price ≤ cost × 1.16
                      (sell fast at minimal margin before product expires)
2. Min margin       : Price must be ≥ cost × 1.15 (15% margin floor)
3. Max increase     : Price must not rise more than 10% above current price
4. MRP cap          : Price must never exceed MRP
"""

from app.services.demand_predictor import get_predictor
from app.services.bandit import get_bandit
from app.utils.product_names import PRODUCT_NAMES

# ── Constraint constants ─────────────────────────────────────────────────────
MAX_PRICE_INCREASE_PCT = 0.10   # allow at most +10% above current price
MIN_MARGIN_PCT         = 0.15   # price must be ≥ cost + 15%
EXPIRY_THRESHOLD_DAYS  = 7      # if fewer than 7 days left → discount mode


def recommend_price(
    product_id: int,
    category: str,
    cost_price: float,
    mrp: float,
    current_price: float,
    stock_level: int,
    days_to_expiry: int,
    season_factor: float,
) -> dict:
    """
    Generate a price recommendation for a product.

    Pipeline
    --------
    1. Thompson Sampling picks the arm with the highest sampled θ.
    2. Hard constraints are applied to the candidate price.
    3. XGBoost predicts demand at the constrained price.
    4. Profit = (price - cost) × demand is calculated.
    5. All 10 arms are evaluated for the frontend chart.

    Returns
    -------
    dict with keys:
        product_id, current_price, recommended_price,
        expected_demand, expected_profit, price_options, constraint_applied
    """
    predictor = get_predictor()
    bandit = get_bandit()

    # ── Step 1: Bandit selects best arm via Thompson Sampling ────────────────
    arm_idx, candidate_price = bandit.select_arm(product_id, cost_price, mrp)

    # ── Step 2: Apply pricing constraints ────────────────────────────────────
    constraint_applied = None

    # Constraint A — Expiry: force near-cost pricing to clear stock
    if days_to_expiry < EXPIRY_THRESHOLD_DAYS:
        min_viable = cost_price * (1 + MIN_MARGIN_PCT)
        candidate_price = min(candidate_price, min_viable * 1.01)
        constraint_applied = "expiry_discount"

    # Constraint B — Minimum margin floor
    floor_price = cost_price * (1 + MIN_MARGIN_PCT)
    if candidate_price < floor_price:
        candidate_price = floor_price
        constraint_applied = constraint_applied or "min_margin"

    # Constraint C — Maximum price increase (fairness / anti-gouging)
    ceiling_price = current_price * (1 + MAX_PRICE_INCREASE_PCT)
    if candidate_price > ceiling_price:
        candidate_price = ceiling_price
        constraint_applied = constraint_applied or "max_increase"

    # Constraint D — Hard MRP cap
    candidate_price = min(candidate_price, mrp)
    candidate_price = float(round(candidate_price, 2))

    # ── Step 3: Predict demand at the recommended price ──────────────────────
    expected_demand = predictor.predict(
        product_id=product_id,
        category=category,
        price=candidate_price,
        cost_price=cost_price,
        mrp=mrp,
        stock_level=stock_level,
        days_to_expiry=days_to_expiry,
        season_factor=season_factor,
    )

    # ── Step 4: Calculate expected profit ────────────────────────────────────
    expected_profit = (candidate_price - cost_price) * expected_demand

    # ── Step 5: Evaluate all 10 arms for the frontend demand-price chart ─────
    all_arms = bandit.get_all_arms(product_id, cost_price, mrp)
    for arm in all_arms:
        p = float(arm["price"])
        d = predictor.predict(
            product_id=product_id,
            category=category,
            price=p,
            cost_price=cost_price,
            mrp=mrp,
            stock_level=stock_level,
            days_to_expiry=days_to_expiry,
            season_factor=season_factor,
        )
        arm["price"] = float(round(p, 2))
        arm["predicted_demand"] = float(round(d, 2))
        arm["predicted_profit"] = float(round((p - cost_price) * d, 2))

    return {
        "product_id": product_id,
        "product_name": PRODUCT_NAMES.get(product_id, f"Product #{product_id}"),
        "current_price": float(current_price),
        "recommended_price": candidate_price,
        "expected_demand": float(round(expected_demand, 2)),
        "expected_profit": float(round(expected_profit, 2)),
        "price_options": all_arms,
        "constraint_applied": constraint_applied,
    }


def simulate_price(
    product_id: int,
    category: str,
    cost_price: float,
    mrp: float,
    current_price: float,
    stock_level: int,
    days_to_expiry: int,
    season_factor: float,
    simulated_price: float,
) -> dict:
    """
    What-if simulation: predict demand and profit at any given price.

    Unlike recommend_price(), this does NOT:
      - consult the bandit
      - apply pricing constraints
      - update any state

    It is purely a read-only query — used by the price simulator slider
    on the Product Detail page so users can explore the demand curve manually.
    """
    predictor = get_predictor()

    expected_demand = predictor.predict(
        product_id=product_id,
        category=category,
        price=simulated_price,
        cost_price=cost_price,
        mrp=mrp,
        stock_level=stock_level,
        days_to_expiry=days_to_expiry,
        season_factor=season_factor,
    )

    profit = (simulated_price - cost_price) * expected_demand
    margin_pct = (
        ((simulated_price - cost_price) / cost_price) * 100
        if cost_price > 0
        else 0.0
    )

    return {
        "product_id": product_id,
        "product_name": PRODUCT_NAMES.get(product_id, f"Product #{product_id}"),
        "simulated_price": float(round(simulated_price, 2)),
        "expected_demand": float(round(expected_demand, 2)),
        "expected_profit": float(round(profit, 2)),
        "margin_pct": float(round(margin_pct, 2)),
    }
