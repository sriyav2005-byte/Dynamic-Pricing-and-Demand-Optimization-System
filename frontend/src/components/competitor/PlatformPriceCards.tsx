/**
 * components/competitor/PlatformPriceCards.tsx
 * =============================================
 * Renders a responsive grid of platform price cards for a product search result.
 * Each card shows: platform emoji + name, price, MRP, discount %, availability,
 * delivery time, and a link to open the platform's search page.
 *
 * Cards animate in on mount with a staggered entrance effect.
 * The cheapest card gets a green glow ring; the highest gets a subtle red border.
 */

"use client";

import { useEffect, useState } from "react";
import { ExternalLink, TrendingDown, TrendingUp, Clock, CheckCircle2, Package } from "lucide-react";
import { PlatformPriceResult } from "@/lib/competitorsApi";

interface Props {
  platforms: PlatformPriceResult[];
  sortOrder?: "asc" | "desc" | "none";
  visiblePlatforms?: string[];
}

function PlatformCard({
  result,
  rank,
  animDelay,
}: {
  result: PlatformPriceResult;
  rank: number;
  animDelay: number;
}) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), animDelay);
    return () => clearTimeout(t);
  }, [animDelay]);

  const borderColor = result.is_cheapest
    ? "rgba(16, 185, 129, 0.4)"
    : result.is_highest
    ? "rgba(239, 68, 68, 0.25)"
    : `${result.color}30`;

  const shadowColor = result.is_cheapest
    ? "0 0 18px rgba(16, 185, 129, 0.18), 0 4px 16px rgba(0,0,0,0.04)"
    : result.is_highest
    ? "0 4px 16px rgba(239,68,68,0.07)"
    : "0 4px 16px rgba(0,0,0,0.04)";

  return (
    <div
      className="relative flex flex-col rounded-2xl overflow-hidden transition-all duration-300 group hover:-translate-y-1"
      style={{
        background: result.bg || "#f8fafc",
        border: `1.5px solid ${borderColor}`,
        boxShadow: shadowColor,
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(14px)",
        transition: `opacity 0.35s ease ${animDelay}ms, transform 0.35s ease ${animDelay}ms, box-shadow 0.25s ease, border-color 0.25s ease`,
      }}
    >
      {/* Cheapest ribbon */}
      {result.is_cheapest && (
        <div
          className="absolute top-0 left-0 right-0 flex items-center justify-center gap-1 py-1 text-[10px] font-bold text-white z-10"
          style={{ background: "linear-gradient(90deg,#10b981,#059669)" }}
        >
          <TrendingDown size={9} />
          BEST PRICE
        </div>
      )}
      {/* Highest price tag */}
      {result.is_highest && !result.is_cheapest && (
        <div
          className="absolute top-0 left-0 right-0 flex items-center justify-center gap-1 py-1 text-[10px] font-bold z-10"
          style={{ background: "rgba(239,68,68,0.08)", color: "#ef4444" }}
        >
          <TrendingUp size={9} />
          HIGHEST
        </div>
      )}

      {/* Card body */}
      <div className={`flex flex-col flex-1 p-4 ${result.is_cheapest || result.is_highest ? "pt-7" : ""}`}>

        {/* Platform header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div
              className="w-8 h-8 rounded-xl flex items-center justify-center text-base font-extrabold shadow-sm flex-shrink-0"
              style={{ background: `${result.color}18`, color: result.color }}
            >
              {result.emoji}
            </div>
            <span
              className="text-xs font-bold leading-tight"
              style={{ color: result.color }}
            >
              {result.platform}
            </span>
          </div>
          {/* Platform rank badge */}
          <span
            className="text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center"
            style={{
              background: rank === 1 ? "rgba(16,185,129,0.12)" : "rgba(0,0,0,0.05)",
              color: rank === 1 ? "#10b981" : "#94a3b8",
            }}
          >
            {rank}
          </span>
        </div>

        {/* Price */}
        <div className="mb-1">
          <div
            className="text-2xl font-extrabold tracking-tight leading-none"
            style={{ color: result.is_cheapest ? "#10b981" : "#1e293b" }}
          >
            ₹{result.price.toFixed(2)}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-[11px] text-slate-400 line-through">
              MRP ₹{result.mrp.toFixed(2)}
            </span>
            <span
              className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
              style={{ background: "rgba(16,185,129,0.1)", color: "#10b981" }}
            >
              {result.discount_pct}% off
            </span>
          </div>
        </div>

        {/* Unit */}
        {result.unit && (
          <div className="flex items-center gap-1 mb-2">
            <Package size={10} className="text-slate-400" />
            <span className="text-[11px] text-slate-400 font-medium">{result.unit}</span>
          </div>
        )}

        {/* Divider */}
        <div className="border-t border-black/5 my-2" />

        {/* Meta row */}
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <CheckCircle2 size={11} style={{ color: "#10b981" }} />
            <span className="text-[11px] font-semibold" style={{ color: "#10b981" }}>
              {result.availability}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Clock size={11} className="text-slate-400" />
              <span className="text-[11px] text-slate-500 font-medium">{result.delivery_time}</span>
            </div>
            {result.is_live ? (
              <span
                className="text-[9px] font-extrabold px-1.5 py-0.5 rounded-full animate-pulse"
                style={{ background: "rgba(16,185,129,0.15)", color: "#10b981" }}
              >
                ● LIVE
              </span>
            ) : (
              <span
                className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                style={{ background: "rgba(0,0,0,0.05)", color: "#94a3b8" }}
              >
                ESTIMATE
              </span>
            )}
          </div>
        </div>

        {/* View link */}
        <a
          href={result.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 flex items-center justify-center gap-1.5 py-2 rounded-xl text-[11px] font-bold transition-all hover:scale-[1.03] active:scale-95 shadow-xs"
          style={{
            background: `${result.color}18`,
            border: `1.5px solid ${result.color}40`,
            color: result.color,
          }}
          title={`Open live search for ${result.platform}`}
        >
          <ExternalLink size={11} />
          Check Live on {result.platform.split(" ")[0]}
        </a>
      </div>
    </div>
  );
}

export default function PlatformPriceCards({
  platforms,
  sortOrder = "asc",
  visiblePlatforms,
}: Props) {
  const displayed = (
    visiblePlatforms && visiblePlatforms.length > 0
      ? platforms.filter((p) => visiblePlatforms.includes(p.platform_key))
      : [...platforms]
  ).sort((a, b) =>
    sortOrder === "desc" ? b.price - a.price : a.price - b.price
  );

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
      {displayed.map((p, i) => (
        <PlatformCard
          key={p.platform_key}
          result={p}
          rank={i + 1}
          animDelay={i * 60}
        />
      ))}
    </div>
  );
}
