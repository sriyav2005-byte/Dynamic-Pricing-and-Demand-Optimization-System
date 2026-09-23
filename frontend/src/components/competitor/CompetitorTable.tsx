/**
 * components/competitor/CompetitorTable.tsx
 * ==========================================
 * Price comparison table showing our price vs all competitor platforms.
 * Color-codes prices: green = cheapest, red = most expensive.
 */

"use client";

import { MarketOverviewItem } from "@/lib/api";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";

const positionBadge: Record<string, { bg: string; color: string; label: string }> = {
  cheapest:       { bg: "rgba(16,185,129,0.15)", color: "#10b981", label: "Cheapest" },
  below_average:  { bg: "rgba(34,211,238,0.15)", color: "#22d3ee", label: "Below Avg" },
  above_average:  { bg: "rgba(245,158,11,0.15)", color: "#f59e0b", label: "Above Avg" },
  most_expensive: { bg: "rgba(239,68,68,0.15)",  color: "#ef4444", label: "Expensive" },
};

const fmt = (n: number) => `₹${n.toFixed(2)}`;

interface Props {
  data: MarketOverviewItem[];
  onSelectProduct?: (id: number) => void;
}

export default function CompetitorTable({ data, onSelectProduct }: Props) {
  return (
    <div className="glass rounded-2xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="data-table w-full">
          <thead>
            <tr>
              <th className="text-left">Product</th>
              <th className="text-left">Category</th>
              <th className="text-right">Our Price</th>
              <th className="text-right">Blinkit</th>
              <th className="text-right">Zepto</th>
              <th className="text-right">Instamart</th>
              <th className="text-right">BigBasket</th>
              <th className="text-right">Mkt Avg</th>
              <th className="text-center">Score</th>
              <th className="text-center">Position</th>
            </tr>
          </thead>
          <tbody>
            {data.map((item) => {
              const badge = positionBadge[item.price_position] || positionBadge.above_average;

              // Find each platform price
              const prices: Record<string, number> = {};
              item.competitors.forEach((c) => {
                prices[c.platform_key] = c.price;
              });

              const allPrices = [...item.competitors.map((c) => c.price), item.our_price];
              const minPrice = Math.min(...allPrices);
              const maxPrice = Math.max(...allPrices);

              const cellColor = (price: number) => {
                if (price === minPrice) return "#10b981";
                if (price === maxPrice) return "#ef4444";
                return "inherit";
              };

              return (
                <tr key={item.product_id}>
                  <td>
                    <button
                      onClick={() => onSelectProduct?.(item.product_id)}
                      className="font-semibold text-slate-800 hover:text-violet-600 transition-colors cursor-pointer text-left"
                    >
                      <div className="font-semibold text-slate-800 line-clamp-1">{item.product_name || `Product #${item.product_id}`}</div>
                      <div className="text-xs text-slate-400 font-mono">#{item.product_id}</div>
                    </button>
                  </td>
                  <td>
                    <span className="badge badge-blue capitalize">{item.category}</span>
                  </td>
                  <td className="text-right font-bold" style={{ color: cellColor(item.our_price) }}>
                    {fmt(item.our_price)}
                  </td>
                  {["Blinkit", "Zepto", "Instamart", "BigBasket"].map((key) => {
                    const price = prices[key];
                    const hasPrice = typeof price === "number" && price > 0;
                    const diff =
                      hasPrice && item.our_price > 0
                        ? ((price - item.our_price) / item.our_price) * 100
                        : 0;
                    return (
                      <td key={key} className="text-right">
                        {hasPrice ? (
                          <div className="flex flex-col items-end">
                            <span className="font-semibold" style={{ color: cellColor(price) }}>
                              {fmt(price)}
                            </span>
                            <span
                              className="text-xs flex items-center gap-0.5"
                              style={{ color: diff > 0 ? "#10b981" : diff < 0 ? "#ef4444" : "#64748b" }}
                            >
                              {diff > 0.5 ? <ArrowUp size={10} /> : diff < -0.5 ? <ArrowDown size={10} /> : <Minus size={10} />}
                              {Math.abs(diff).toFixed(1)}%
                            </span>
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="text-right text-slate-500 font-semibold">
                    {fmt(item.market_avg)}
                  </td>
                  <td className="text-center">
                    <div
                      className="inline-flex items-center justify-center w-10 h-10 rounded-full text-xs font-bold"
                      style={{
                        background:
                          item.competitiveness_score >= 70
                            ? "rgba(16,185,129,0.15)"
                            : item.competitiveness_score >= 40
                            ? "rgba(245,158,11,0.15)"
                            : "rgba(239,68,68,0.15)",
                        color:
                          item.competitiveness_score >= 70
                            ? "#10b981"
                            : item.competitiveness_score >= 40
                            ? "#f59e0b"
                            : "#ef4444",
                      }}
                    >
                      {Math.round(item.competitiveness_score)}
                    </div>
                  </td>
                  <td className="text-center">
                    <span
                      className="badge"
                      style={{ background: badge.bg, color: badge.color }}
                    >
                      {badge.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
