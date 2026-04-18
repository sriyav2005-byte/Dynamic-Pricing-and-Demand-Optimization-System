/**
 * components/PriceSimulator.tsx — Interactive Price Simulator Slider
 * ====================================================================
 * Allows users to manually drag a slider to any price between cost and MRP
 * and instantly see the XGBoost-predicted demand, expected profit, and
 * margin percentage — without recording a sale or changing anything.
 *
 * How it works
 * ------------
 * 1. User drags the range slider → local `price` state updates.
 * 2. User clicks "Run Simulation" → calls GET /pricing/simulate/{id}?price=X.
 * 3. Backend runs XGBoost inference and returns demand / profit / margin.
 * 4. Results are displayed in a 3-cell mini-grid below the button.
 *
 * This component does NOT update the Thompson Sampling bandit.
 * It is purely exploratory — a "what-if" tool for store managers.
 *
 * Props
 * -----
 * productId    : Which product to simulate.
 * costPrice    : Slider minimum (selling below cost is blocked in the API).
 * mrp          : Slider maximum (selling above MRP is blocked in the API).
 * currentPrice : Initial slider position.
 */

"use client";

import { useState } from "react";
import { simulatePrice, SimulationResult } from "@/lib/api";
import { SlidersHorizontal, TrendingUp, DollarSign, Percent } from "lucide-react";

interface Props {
  productId:    number;
  costPrice:    number;
  mrp:          number;
  currentPrice: number;
}

export default function PriceSimulator({ productId, costPrice, mrp, currentPrice }: Props) {
  // Local state — no global store needed, this component is self-contained
  const [price,   setPrice]   = useState(currentPrice);   // current slider value
  const [result,  setResult]  = useState<SimulationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  /** Call the backend simulation endpoint and update result state. */
  const handleSimulate = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await simulatePrice(productId, price);
      setResult(res);
    } catch (e: any) {
      // Surface the API error message (e.g. "price exceeds MRP")
      setError(e?.response?.data?.detail || "Simulation failed");
    } finally {
      setLoading(false);
    }
  };

  // Live margin estimate shown even before running the simulation
  // so users get immediate feedback as they drag the slider
  const margin = ((price - costPrice) / costPrice) * 100;

  return (
    <div className="glass rounded-2xl p-6">
      <div className="flex items-center gap-2 mb-6">
        <SlidersHorizontal size={18} style={{ color: "#22d3ee" }} />
        <h3 className="font-semibold text-white">Price Simulator</h3>
      </div>

      {/* ── Slider ───────────────────────────────────────────────────────── */}
      <div className="mb-6">
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm" style={{ color: "#94a3b8" }}>Simulated Price</span>
          {/* Live price value updates as slider moves */}
          <span className="text-xl font-bold text-white">₹{price.toFixed(2)}</span>
        </div>
        <input
          type="range"
          min={costPrice}
          max={mrp}
          step={0.5}         // 50-paise increments feel natural for ₹ prices
          value={price}
          onChange={(e) => setPrice(parseFloat(e.target.value))}
          className="w-full h-2 rounded-full appearance-none cursor-pointer"
          style={{ accentColor: "#6366f1" }}
        />
        {/* Min/max labels below the slider track */}
        <div className="flex justify-between text-xs mt-1" style={{ color: "#64748b" }}>
          <span>Cost ₹{costPrice.toFixed(0)}</span>
          <span>MRP ₹{mrp.toFixed(0)}</span>
        </div>
      </div>

      {/* ── Live margin indicator (updates on every slider drag) ─────────── */}
      <div className="glass rounded-xl p-3 mb-4">
        <div className="text-xs" style={{ color: "#94a3b8" }}>Estimated Margin</div>
        <div
          className="text-lg font-bold"
          style={{
            // Colour code: green ≥ 15%, amber 5–15%, red < 5%
            color: margin >= 15 ? "#10b981" : margin >= 5 ? "#f59e0b" : "#ef4444",
          }}
        >
          {margin.toFixed(1)}%
        </div>
      </div>

      {/* ── Trigger button ─────────────────────────────────────────────── */}
      <button
        onClick={handleSimulate}
        disabled={loading}
        className="glow-btn w-full py-3 rounded-xl font-semibold text-white text-sm transition-all"
        style={{ opacity: loading ? 0.7 : 1 }}
      >
        {loading ? "Simulating..." : "Run Simulation"}
      </button>

      {/* Error state */}
      {error && (
        <div
          className="mt-4 p-3 rounded-xl text-sm"
          style={{
            background: "rgba(239,68,68,0.1)",
            color: "#ef4444",
            border: "1px solid rgba(239,68,68,0.2)",
          }}
        >
          {error}
        </div>
      )}

      {/* ── Results grid — only shown after a successful simulation ────── */}
      {result && (
        <div className="mt-4 grid grid-cols-2 gap-3">
          {/* Predicted demand */}
          <div className="glass rounded-xl p-3">
            <div className="flex items-center gap-1 text-xs mb-1" style={{ color: "#94a3b8" }}>
              <TrendingUp size={12} /> Demand
            </div>
            <div className="text-lg font-bold text-white">{result.expected_demand.toFixed(1)}</div>
            <div className="text-xs" style={{ color: "#64748b" }}>units</div>
          </div>

          {/* Expected profit */}
          <div className="glass rounded-xl p-3">
            <div className="flex items-center gap-1 text-xs mb-1" style={{ color: "#94a3b8" }}>
              <DollarSign size={12} /> Profit
            </div>
            <div className="text-lg font-bold" style={{ color: "#10b981" }}>
              ₹{result.expected_profit.toFixed(0)}
            </div>
          </div>

          {/* Actual margin % at the simulated price */}
          <div className="glass rounded-xl p-3 col-span-2">
            <div className="flex items-center gap-1 text-xs mb-1" style={{ color: "#94a3b8" }}>
              <Percent size={12} /> Margin
            </div>
            <div className="text-lg font-bold" style={{ color: "#6366f1" }}>
              {result.margin_pct.toFixed(1)}%
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
