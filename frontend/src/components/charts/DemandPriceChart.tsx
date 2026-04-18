/**
 * components/charts/DemandPriceChart.tsx — Demand & Profit vs Price Curve
 * =========================================================================
 * Renders a line chart showing how predicted demand and expected profit
 * vary across the 10 Thompson Sampling price arms.
 *
 * Used by: Product Detail page `/product/[id]`
 *
 * Data source: PriceRecommendation.price_options (10 arm objects)
 * Each arm has: { price, predicted_demand, predicted_profit }
 *
 * Key visual elements
 * -------------------
 * - Blue line  = predicted demand (units sold) — typically decreases as price rises
 * - Cyan line  = predicted profit (₹)          — typically peaks somewhere in middle
 * - Amber dashed vertical line = current price
 * - Green dashed vertical line = ML recommended price
 *
 * The vertical reference lines make it easy to see at a glance whether
 * the recommendation is above or below the current price and where each
 * sits on the demand curve.
 */

"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { PriceOption } from "@/lib/api";

interface Props {
  options:          PriceOption[];  // the 10 bandit arms with demand/profit attached
  currentPrice:     number;
  recommendedPrice: number;
  costPrice:        number;         // kept for potential future use (break-even line)
}

/** Custom tooltip — glass-styled card matching the app's dark theme. */
const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;

  return (
    <div
      className="glass rounded-xl p-3"
      style={{ border: "1px solid rgba(99,102,241,0.3)" }}
    >
      <p className="text-xs text-gray-400 mb-1">Price: ₹{Number(label).toFixed(2)}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} className="text-sm font-semibold" style={{ color: p.color }}>
          {p.name}: {
            // Demand shows in "units", profit shows in "₹"
            p.dataKey === "predicted_demand"
              ? `${p.value.toFixed(1)} units`
              : `₹${p.value.toFixed(0)}`
          }
        </p>
      ))}
    </div>
  );
};

export default function DemandPriceChart({ options, currentPrice, recommendedPrice, costPrice }: Props) {
  // Flatten the arm objects into the shape Recharts expects
  const data = options.map((o) => ({
    price:            o.price,
    predicted_demand: o.predicted_demand,
    predicted_profit: o.predicted_profit,
  }));

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>

        {/* Faint horizontal grid lines only (no vertical) for a cleaner look */}
        <CartesianGrid stroke="rgba(255,255,255,0.04)" />

        {/* X axis: the price value of each arm */}
        <XAxis
          dataKey="price"
          stroke="#475569"
          tick={{ fontSize: 11, fill: "#64748b" }}
          tickFormatter={(v) => `₹${Number(v).toFixed(0)}`}
        />

        {/* Y axis: shared between demand (units) and profit (₹).
            Both are on the same scale which works because the dataset
            produces similar numeric ranges for both metrics. */}
        <YAxis stroke="#475569" tick={{ fontSize: 11, fill: "#64748b" }} />

        <Tooltip content={<CustomTooltip />} />

        {/* ── Reference lines (vertical dashed markers) ─────────────── */}

        {/* Amber dashed line = where the product is currently priced */}
        <ReferenceLine
          x={currentPrice}
          stroke="#f59e0b"
          strokeDasharray="4 4"
          label={{ value: "Current", fill: "#f59e0b", fontSize: 11 }}
        />

        {/* Green dashed line = the bandit's recommendation (after constraints) */}
        <ReferenceLine
          x={recommendedPrice}
          stroke="#10b981"
          strokeDasharray="4 4"
          label={{ value: "Rec.", fill: "#10b981", fontSize: 11 }}
        />

        {/* ── Data lines ───────────────────────────────────────────────── */}

        {/* Demand curve — indigo.  dot={false} keeps the line clean. */}
        <Line
          type="monotone"
          dataKey="predicted_demand"
          stroke="#6366f1"
          strokeWidth={2.5}
          dot={false}
          name="Demand"
        />

        {/* Profit curve — cyan.  Should peak near the optimal price. */}
        <Line
          type="monotone"
          dataKey="predicted_profit"
          stroke="#22d3ee"
          strokeWidth={2.5}
          dot={false}
          name="Profit"
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
