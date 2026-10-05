"""
ml/pricing/bandit.py — pricing bandits with state persisted in bandit_states.

1. ThompsonBandit  (policy "model_ts", production default)
   The original PriceIQ design is preserved: 10 Beta(alpha, beta) arms evenly
   spaced over [cost x 1.05, MRP], and Thompson Sampling picks an arm. Upgrades:

   * Informative, context-aware prior: arm i starts from
         Beta(k*m_i, k*(1 - m_i)),  m_i in [0.1, 0.9]
     where m_i is the demand model's normalized expected objective for that
     arm *under the current context* (expiry, stock, calendar, ...) and
     k = PRIOR_STRENGTH. Sales history is already encoded in the demand
     model, so it is not counted a second time.
   * Only real post-deployment outcomes update alpha/beta. Reward = realized
     daily profit mapped onto the same normalized scale as the prior (using
     the predicted profit range at decision time), clipped to [0, 1]. The old
     reward, profit / ((MRP - cost) x units) = (p - cost)/(MRP - cost), was a
     function of price only, so the old bandit could never learn from demand.
   * Only arms inside the allowed price band are eligible; when fewer than
     three arms fit, band prices are added as prior-only arms.

2. LinearThompson (policy "contextual_ts", challenger — shadow mode)
   Bayesian linear regression of normalized daily profit on a context/price
   feature vector; Thompson sample θ ~ N(μ, σ²A⁻¹) and pick the candidate price
   maximizing θ·x(p). Warm-started from history.
"""

from __future__ import annotations

import json
from datetime import date

import numpy as np
import pandas as pd

from app import db

NUM_ARMS = 10
PRIOR_STRENGTH = 20.0
TS_POLICY = "thompson_sampling"
LIN_POLICY = "contextual_ts"


def arm_prices(cost: float, mrp: float) -> list[float]:
    return [round(float(p), 2) for p in np.linspace(cost * 1.05, mrp, NUM_ARMS)]


def load_state(product_id: str, policy: str) -> dict | None:
    row = db.fetch_one("select state, n_updates from bandit_states where product_id = :p and policy = :pol",
                       p=product_id, pol=policy)
    if not row:
        return None
    st = row["state"] if isinstance(row["state"], dict) else json.loads(row["state"])
    st["n_updates"] = row["n_updates"]
    return st


def save_state(store_id: str, product_id: str, policy: str, state: dict, n_updates: int) -> None:
    db.execute(
        """insert into bandit_states(store_id, product_id, policy, state, n_updates, updated_at)
           values (:s, :p, :pol, cast(:st as jsonb), :n, now())
           on conflict (product_id, policy) do update set state = excluded.state, n_updates = excluded.n_updates, updated_at = now()""",
        s=store_id, p=product_id, pol=policy, st=json.dumps(state, default=float), n=n_updates,
    )


def daily_profit_series(hist: pd.DataFrame) -> pd.DataFrame:
    h = hist.copy()
    h["profit"] = (h["price"] - h["cost_price"]) * h["units"]
    return h


def reference_profit(hist: pd.DataFrame) -> float:
    if hist.empty:
        return 1.0
    prof = daily_profit_series(hist)["profit"]
    ref = float(np.nanpercentile(prof, 95)) if len(prof) else 1.0
    return max(ref, 1.0)


def normalize(values: dict, lo: float | None = None, hi: float | None = None) -> dict:
    """Map objective values onto [0.1, 0.9] (prior means and rewards share this scale)."""
    lo = min(values.values()) if lo is None else lo
    hi = max(values.values()) if hi is None else hi
    if hi - lo < 1e-9:
        return {k: 0.5 for k in values}
    return {k: float(np.clip(0.1 + 0.8 * (v - lo) / (hi - lo), 0.0, 1.0)) for k, v in values.items()}


class ThompsonBandit:
    def __init__(self, store_id: str, product: dict, rng: np.random.Generator | None = None):
        self.store_id, self.product = store_id, product
        self.rng = rng or np.random.default_rng()
        self.arms = arm_prices(product["cost_price"], product["mrp"])
        st = load_state(product["id"], TS_POLICY)
        if st is None or len(st.get("alpha", [])) != NUM_ARMS:
            st = {"alpha": [0.0] * NUM_ARMS, "beta": [0.0] * NUM_ARMS, "n_updates": 0, "pending_day": None,
                  "arms": self.arms}
            save_state(store_id, product["id"], TS_POLICY, st, 0)
        self.state = st

    def candidates(self, lo: float, hi: float, band_prices: list[float]) -> list[float]:
        prices = [p for p in self.arms if lo - 1e-9 <= p <= hi + 1e-9]
        if len(prices) < 3:
            prices = sorted({*prices, *[round(p, 2) for p in band_prices if lo - 1e-9 <= p <= hi + 1e-9]})
        return prices

    def _arm_index(self, price: float) -> int | None:
        """Nearest persistent arm if the price lies within half an arm spacing."""
        i = int(np.argmin([abs(a - price) for a in self.arms]))
        spacing = (self.arms[-1] - self.arms[0]) / max(NUM_ARMS - 1, 1)
        return i if abs(self.arms[i] - price) <= spacing / 2 + 1e-9 else None

    def posterior(self, price: float, prior_mean: float) -> tuple[float, float, int]:
        a, b = PRIOR_STRENGTH * prior_mean, PRIOR_STRENGTH * (1 - prior_mean)
        i = self._arm_index(price)
        n = 0
        if i is not None:
            a += self.state["alpha"][i]
            b += self.state["beta"][i]
            n = int(round(self.state["alpha"][i] + self.state["beta"][i]))
        return max(a, 1e-3), max(b, 1e-3), n

    def select(self, prior_means: dict[float, float]) -> dict:
        samples, means, obs = {}, {}, {}
        for p, m in prior_means.items():
            a, b, n = self.posterior(p, m)
            samples[p] = float(self.rng.beta(a, b))
            means[p] = a / (a + b)
            obs[p] = n
        chosen = max(samples, key=samples.get)
        greedy = max(means, key=means.get)
        return {"price": chosen, "greedy_price": greedy, "explored": abs(chosen - greedy) > 1e-9,
                "table": [{"price": p, "prior_mean": round(prior_means[p], 4), "posterior_mean": round(means[p], 4),
                           "sample": round(samples[p], 4), "observed_days": obs[p]} for p in sorted(prior_means)]}

    def remember_decision(self, price: float, profit_lo: float, profit_hi: float) -> None:
        """Store the predicted objective range so realized profit is normalized consistently."""
        self.state["last_decision"] = {"price": price, "profit_lo": profit_lo, "profit_hi": profit_hi}
        save_state(self.store_id, self.product["id"], TS_POLICY, self.state, self.state.get("n_updates", 0))

    def record_sale(self, sold_on: date, price: float, profit: float) -> bool:
        """Accumulate a day's realized profit; finalize the previous day as one arm update."""
        st = self.state
        pend = st.get("pending_day")
        updated = False
        if pend and pend["date"] != sold_on.isoformat():
            i = self._arm_index(pend["price"])
            dec = st.get("last_decision") or {}
            lo, hi = dec.get("profit_lo"), dec.get("profit_hi")
            if i is not None and lo is not None and hi is not None and hi > lo:
                r = normalize({"x": pend["profit"]}, lo, hi)["x"]
                st["alpha"][i] += r
                st["beta"][i] += 1 - r
                st["n_updates"] = st.get("n_updates", 0) + 1
                updated = True
            pend = None
        if pend is None:
            pend = {"date": sold_on.isoformat(), "price": price, "profit": 0.0}
        pend["profit"] += profit
        pend["price"] = price
        st["pending_day"] = pend
        save_state(self.store_id, self.product["id"], TS_POLICY, st, st.get("n_updates", 0))
        return updated


# ── Contextual (linear) Thompson Sampling ───────────────────────────────────

LIN_FEATURES = ["bias", "rel_price", "rel_price_sq", "expiry_pressure", "weekend", "event", "comp_gap", "has_comp"]
LAMBDA = 1.0


def context_vector(price: float, ref_price: float, dte: float | None, weekend: int, event: int,
                   market_avg: float | None) -> np.ndarray:
    rel = price / ref_price - 1 if ref_price > 0 else 0.0
    ep = 1.0 / (1.0 + dte) if dte is not None and not pd.isna(dte) and dte >= 0 else 0.0
    gap = (price - market_avg) / market_avg if market_avg else 0.0
    return np.array([1.0, rel, rel * rel, ep, float(weekend), float(event), gap, 1.0 if market_avg else 0.0])


class LinearThompson:
    def __init__(self, store_id: str, product: dict, hist: pd.DataFrame, rng: np.random.Generator | None = None):
        self.store_id, self.product = store_id, product
        self.rng = rng or np.random.default_rng()
        d = len(LIN_FEATURES)
        st = load_state(product["id"], LIN_POLICY)
        if st is None or len(st.get("b", [])) != d:
            st = self._warm_start(hist, d)
            save_state(store_id, product["id"], LIN_POLICY, st, 0)
        self.state = st
        self.A = np.asarray(st["A"], dtype=float)
        self.b = np.asarray(st["b"], dtype=float)

    def _warm_start(self, hist: pd.DataFrame, d: int) -> dict:
        A, b = LAMBDA * np.eye(d), np.zeros(d)
        ref = reference_profit(hist)
        ref_price = float(hist["price"].mean()) if not hist.empty else float(self.product["price"])
        sq, n = 0.0, 0
        if not hist.empty:
            h = daily_profit_series(hist).reset_index()
            for _, r in h.iterrows():
                x = context_vector(r["price"], ref_price, r.get("days_to_expiry"),
                                   int(pd.Timestamp(r["date"]).dayofweek >= 5), 0, None)
                y = float(np.clip(r["profit"] / ref, 0, 1.5))
                A += np.outer(x, x)
                b += y * x
                n += 1
            mu = np.linalg.solve(A, b)
            for _, r in h.iterrows():
                x = context_vector(r["price"], ref_price, r.get("days_to_expiry"),
                                   int(pd.Timestamp(r["date"]).dayofweek >= 5), 0, None)
                sq += (float(np.clip(r["profit"] / ref, 0, 1.5)) - x @ mu) ** 2
        sigma2 = sq / max(n - d, 1) if n > d else 0.25
        return {"A": A.tolist(), "b": b.tolist(), "sigma2": sigma2, "ref_profit": ref, "ref_price": ref_price,
                "warm_start_days": n, "features": LIN_FEATURES}

    @property
    def ref_price(self) -> float:
        return float(self.state.get("ref_price") or self.product["price"])

    def choose(self, candidates: list[float], dte: float | None, weekend: int, event: int,
               market_avg: float | None) -> dict:
        Ainv = np.linalg.inv(self.A)
        mu = Ainv @ self.b
        sigma2 = float(self.state.get("sigma2", 0.25))
        theta = self.rng.multivariate_normal(mu, sigma2 * Ainv)
        X = np.array([context_vector(p, self.ref_price, dte, weekend, event, market_avg) for p in candidates])
        sampled, mean = X @ theta, X @ mu
        i, g = int(np.argmax(sampled)), int(np.argmax(mean))
        return {"price": float(candidates[i]), "greedy_price": float(candidates[g]), "explored": i != g,
                "expected_reward": float(mean[i]), "coefficients": dict(zip(LIN_FEATURES, map(float, mu)))}

    def update(self, x: np.ndarray, reward: float) -> None:
        self.A += np.outer(x, x)
        self.b += reward * x
        self.state["A"], self.state["b"] = self.A.tolist(), self.b.tolist()
        n = int(self.state.get("n_updates", 0)) + 1
        self.state["n_updates"] = n
        save_state(self.store_id, self.product["id"], LIN_POLICY, self.state, n)
