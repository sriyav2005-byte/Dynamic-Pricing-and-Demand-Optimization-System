/**
 * components/competitor/PriceComparisonBar.tsx
 * =============================================
 * Visual price range bar showing the spread between the cheapest and most
 * expensive platform, with labelled end-points and a summary strip.
 */

"use client";

import { PlatformPriceResult } from "@/lib/competitorsApi";

interface Props {
  platforms: PlatformPriceResult[];
  mrp: number;
  marketAvg: number;
}

export default function PriceComparisonBar({ platforms, mrp, marketAvg }: Props) {
  if (!platforms.length) return null;

  const prices = platforms.map((p) => p.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const spread = max - min;
  const cheapest = platforms.find((p) => p.is_cheapest);
  const highest = platforms.find((p) => p.is_highest);

  // Position of market avg and MRP on the bar (0–100%)
  const toPercent = (v: number) =>
    spread > 0 ? Math.max(0, Math.min(100, ((v - min) / spread) * 100)) : 50;

  const avgPct = toPercent(marketAvg);
  const mrpPct = 100; // MRP is always above all platform prices

  return (
    <div
      className="rounded-2xl p-5"
      style={{
        background: "linear-gradient(135deg,rgba(124,58,237,0.03),rgba(34,211,238,0.03))",
        border: "1px solid rgba(124,58,237,0.1)",
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
          Price Spread Across Platforms
        </span>
        <span className="text-xs font-semibold text-slate-500">
          ₹{spread.toFixed(2)} range
        </span>
      </div>

      {/* Bar */}
      <div className="relative h-4 rounded-full overflow-visible mb-6" style={{ background: "rgba(0,0,0,0.06)" }}>
        {/* Filled segment: min → max */}
        <div
          className="absolute top-0 left-0 h-full rounded-full"
          style={{
            width: "100%",
            background: "linear-gradient(90deg,#10b981,#f59e0b,#ef4444)",
          }}
        />

        {/* Market avg marker */}
        <div
          className="absolute top-1/2 -translate-y-1/2 z-10"
          style={{ left: `calc(${avgPct}% - 1px)` }}
        >
          <div
            className="w-0.5 h-6 rounded-full -mt-1"
            style={{ background: "#7c3aed" }}
          />
          <div
            className="absolute left-1/2 -translate-x-1/2 mt-0.5 text-[9px] font-bold whitespace-nowrap px-1.5 py-0.5 rounded-md top-full"
            style={{ background: "rgba(124,58,237,0.1)", color: "#7c3aed" }}
          >
            Avg ₹{marketAvg.toFixed(0)}
          </div>
        </div>
      </div>

      {/* Labels */}
      <div className="flex items-end justify-between">
        <div className="flex flex-col">
          <span
            className="text-[10px] font-bold px-2 py-0.5 rounded-full mb-1"
            style={{ background: "rgba(16,185,129,0.12)", color: "#10b981" }}
          >
            ⚡ CHEAPEST
          </span>
          <span className="text-sm font-extrabold" style={{ color: "#10b981" }}>
            ₹{min.toFixed(2)}
          </span>
          <span className="text-[11px] text-slate-400 font-medium mt-0.5">
            {cheapest?.platform}
          </span>
        </div>

        <div className="flex flex-col items-center text-center">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
            Mkt Avg
          </span>
          <span className="text-sm font-extrabold text-slate-700">
            ₹{marketAvg.toFixed(2)}
          </span>
          <span className="text-[11px] text-slate-400 font-medium mt-0.5">
            {platforms.length} platforms
          </span>
        </div>

        <div className="flex flex-col items-end">
          <span
            className="text-[10px] font-bold px-2 py-0.5 rounded-full mb-1"
            style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}
          >
            HIGHEST
          </span>
          <span className="text-sm font-extrabold" style={{ color: "#ef4444" }}>
            ₹{max.toFixed(2)}
          </span>
          <span className="text-[11px] text-slate-400 font-medium mt-0.5">
            {highest?.platform}
          </span>
        </div>
      </div>

      {/* MRP row */}
      <div
        className="flex items-center justify-between mt-4 pt-3 rounded-xl px-3 py-2"
        style={{ background: "rgba(0,0,0,0.03)", border: "1px dashed rgba(0,0,0,0.08)" }}
      >
        <span className="text-[11px] font-semibold text-slate-400">MRP (Maximum Retail Price)</span>
        <span className="text-[11px] font-bold text-slate-600">₹{mrp.toFixed(2)}</span>
        <span
          className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
          style={{ background: "rgba(16,185,129,0.1)", color: "#10b981" }}
        >
          Avg {Math.round(((mrp - marketAvg) / mrp) * 100)}% below MRP
        </span>
      </div>
    </div>
  );
}
