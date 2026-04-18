"""
services/bandit.py — Thompson Sampling Contextual Bandit
=========================================================
Implements a multi-armed bandit that selects the best price for each product.

Why a bandit?
-------------
Unlike a fixed pricing rule, the bandit learns from actual sales outcomes.
Each time a sale is recorded (POST /update-sales), the bandit reward is
measured and the arm's probability distribution is updated.  Over time,
arms (prices) that generate higher profit are selected more frequently.

Algorithm: Thompson Sampling
-----------------------------
For each product we maintain a Beta distribution per price arm:
    arm_i ~ Beta(alpha_i, beta_i)

On each recommendation call:
  1. Sample θ_i ~ Beta(α_i, β_i) for every arm
  2. Select arm with highest θ  →  argmax(θ)
  3. Return the price at that arm index

On each sales update call:
  1. Normalise profit to [0, 1] as the reward signal
  2. alpha_i += reward       (success count)
  3. beta_i  += (1 - reward) (failure count)

This is a Bernoulli bandit approximation — we treat the continuous reward
as a success probability and update the Beta prior accordingly.

Initialisation: alpha=1, beta=1 (uniform prior — no preference initially).

State persistence:
    Bandit α/β values are saved to ml/bandit_state.json after every update
    so the model survives server restarts.
"""

import os
import json
import numpy as np
from typing import List, Dict

# Path to the JSON file that persists bandit state across server restarts
BANDIT_STATE_PATH = os.path.join(
    os.path.dirname(__file__), "..", "..", "ml", "bandit_state.json"
)


class ThompsonBandit:
    """
    Thompson Sampling bandit with 10 discrete price arms per product.

    Price arms are evenly spaced between cost × 1.05 and MRP.
    State (alpha, beta) is keyed by str(product_id) for JSON compatibility.
    """

    NUM_ARMS = 10  # Number of discrete price options to explore

    def __init__(self):
        # alpha[product_id][arm] = accumulated successes + 1 (Beta prior)
        self.alpha: Dict[str, List[float]] = {}
        # beta_[product_id][arm] = accumulated failures + 1 (Beta prior)
        self.beta_: Dict[str, List[float]] = {}
        self._load()

    # ── Persistence ──────────────────────────────────────────────────────────

    def _load(self):
        """Load previously saved α/β params from JSON, if the file exists."""
        os.makedirs(os.path.dirname(BANDIT_STATE_PATH), exist_ok=True)
        if os.path.exists(BANDIT_STATE_PATH):
            try:
                with open(BANDIT_STATE_PATH, "r") as f:
                    state = json.load(f)
                self.alpha = state.get("alpha", {})
                self.beta_ = state.get("beta", {})
            except Exception:
                pass  # corrupt file — start fresh

    def _save(self):
        """Persist current α/β values to JSON after every bandit update."""
        with open(BANDIT_STATE_PATH, "w") as f:
            json.dump({"alpha": self.alpha, "beta": self.beta_}, f)

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _init_product(self, pid: str):
        """
        Initialise α/β arrays for a new product with a uniform Beta(1,1) prior.
        Beta(1,1) = Uniform[0,1] — no initial preference for any arm.
        """
        if pid not in self.alpha:
            self.alpha[pid] = [1.0] * self.NUM_ARMS
            self.beta_[pid] = [1.0] * self.NUM_ARMS

    def _price_arms(self, cost: float, mrp: float) -> List[float]:
        """
        Generate the 10 price action points (arms) for a given product.

        Arms are evenly spaced from cost*1.05 (just above cost) to MRP.
        This ensures arm 0 is always the cheapest viable price,
        and arm 9 is always the most expensive allowed price.
        """
        low = cost * 1.05
        return list(np.linspace(low, mrp, self.NUM_ARMS))

    # ── Public API ────────────────────────────────────────────────────────────

    def select_arm(self, product_id: int, cost: float, mrp: float) -> tuple[int, float]:
        """
        Thompson Sampling: sample a θ per arm from Beta(α, β) and
        pick the arm with the highest sample.

        Parameters
        ----------
        product_id : Product to select a price arm for.
        cost, mrp  : Used to compute the 10 price arm values.

        Returns
        -------
        (arm_index, price)
            The selected arm index and its corresponding price in ₹.
        """
        pid = str(product_id)
        self._init_product(pid)
        arms = self._price_arms(cost, mrp)

        # Sample one θ per arm from its Beta distribution
        samples = [
            np.random.beta(self.alpha[pid][i], self.beta_[pid][i])
            for i in range(self.NUM_ARMS)
        ]

        # Choose the arm with the highest sampled value (optimistic selection)
        best_arm = int(np.argmax(samples))
        return best_arm, arms[best_arm]

    def get_all_arms(self, product_id: int, cost: float, mrp: float) -> List[dict]:
        """
        Return all 10 arms with their prices and expected reward estimates.

        Expected reward = α / (α + β) = mean of the Beta distribution.
        This is shown in the Product Detail page as the bandit's confidence
        in each price tier.
        """
        pid = str(product_id)
        self._init_product(pid)
        arms = self._price_arms(cost, mrp)
        result = []
        for i, price in enumerate(arms):
            a = self.alpha[pid][i]
            b = self.beta_[pid][i]
            # Mean of Beta(α, β) = α / (α + β)
            expected = a / (a + b)
            result.append({
                "arm": i,
                "price": round(price, 2),
                "expected_reward": round(expected, 4),
            })
        return result

    def update(self, product_id: int, arm_idx: int, reward: float, cost: float, mrp: float):
        """
        Update Beta distribution parameters after observing a reward.

        The reward must be normalised to [0, 1] by the caller.
        We use a Bernoulli approximation:
            alpha_i += reward        (treat as fractional success)
            beta_i  += (1 - reward)  (treat as fractional failure)

        Parameters
        ----------
        product_id : Product whose arm is being updated.
        arm_idx    : Index of the arm that was chosen (0–9).
        reward     : Normalised profit ∈ [0, 1].
        cost, mrp  : Needed to (re)initialise the product if first seen.
        """
        pid = str(product_id)
        self._init_product(pid)

        # Clip reward to valid [0, 1] range
        r = min(1.0, max(0.0, reward))

        self.alpha[pid][arm_idx] += r
        self.beta_[pid][arm_idx] += (1 - r)

        # Persist state so it survives a server restart
        self._save()


# ── Singleton ─────────────────────────────────────────────────────────────────
_bandit = None


def get_bandit() -> ThompsonBandit:
    """
    Returns the shared ThompsonBandit instance.
    Loaded once on first call; state (α/β) is read from JSON.
    """
    global _bandit
    if _bandit is None:
        _bandit = ThompsonBandit()
    return _bandit
