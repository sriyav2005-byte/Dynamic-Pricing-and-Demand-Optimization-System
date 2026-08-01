/**
 * components/competitor/CompetitorTable.tsx
 * ==========================================
 * Multi-platform price table (Blinkit, Zepto, Instamart, BigBasket, etc.).
 *
 * NOTE: This intentionally does NOT compare against "our price" —
 * the current product catalog is synthetic demo data, not real
 * products, so a price comparison against it would be meaningless.
 * Once real product data is wired in, re-add an "Our Price" column
 * and a diff/competitiveness comparison here.
 */

"use client";

import { useState } from "react";
import { MarketOverviewItem } from "@/lib/api";
import { ExternalLink, RefreshCw, CheckCircle2 } from "lucide-react";

const fmt = (n: number) => `₹${n.toFixed(2)}`;

interface Props {
  data: MarketOverviewItem[];
  onSelectProduct?: (id: number) => void;
  onFetchLiveSingle?: (id: number) => Promise<void>;
}

export default function CompetitorTable({ data, onSelectProduct, onFetchLiveSingle }: Props) {
  const [loadingIds, setLoadingIds] = useState<Record<number, boolean>>({});

  const handleFetchLive = async (id: number) => {
    if (!onFetchLiveSingle) return;
    setLoadingIds((prev) => ({ ...prev, [id]: true }));
    try {
      await onFetchLiveSingle(id);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingIds((prev) => ({ ...prev, [id]: false }));
    }
  };

  return (
    <div className="glass rounded-2xl overflow-hidden shadow-sm">
      <div className="overflow-x-auto">
        <table className="data-table w-full">
          <thead>
            <tr>
              <th className="text-left">Product</th>
              <th className="text-left">Category</th>
              <th className="text-right">⚡ Blinkit</th>
              <th className="text-right">🟣 Zepto</th>
              <th className="text-right">🛒 Instamart</th>
              <th className="text-right">🧺 BigBasket</th>
              <th className="text-right">Market Avg</th>
              <th className="text-center">Cheapest On</th>
              <th className="text-center">Real-Time</th>
            </tr>
          </thead>
          <tbody>
            {data.map((item) => {
              // Find each platform price and URL
              const platformMap: Record<string, { price: number; url?: string; unit?: string }> = {};
              item.competitors.forEach((c) => {
                const normKey = c.platform.toLowerCase();
                if (normKey.includes("blinkit")) platformMap["blinkit"] = { price: c.price, url: c.url, unit: c.unit };
                else if (normKey.includes("zepto")) platformMap["zepto"] = { price: c.price, url: c.url, unit: c.unit };
                else if (normKey.includes("instamart") || normKey.includes("swiggy")) platformMap["instamart"] = { price: c.price, url: c.url, unit: c.unit };
                else if (normKey.includes("bigbasket")) platformMap["bigbasket"] = { price: c.price, url: c.url, unit: c.unit };
              });

              const platformPrices = item.competitors.map((c) => c.price).filter((p) => p > 0);
              const minPrice = platformPrices.length ? Math.min(...platformPrices) : 0;
              const maxPrice = platformPrices.length ? Math.max(...platformPrices) : 0;

              const cellColor = (price: number) => {
                if (price === minPrice) return "#10b981";
                if (price === maxPrice) return "#ef4444";
                return "#1e293b";
              };

              const isRowLoading = loadingIds[item.product_id] || false;

              return (
                <tr key={item.product_id} className="hover:bg-slate-50/50 transition-colors">
                  <td>
                    <div className="flex flex-col">
                      <button
                        onClick={() => onSelectProduct?.(item.product_id)}
                        className="font-bold text-slate-800 hover:text-violet-600 transition-colors cursor-pointer text-left"
                      >
                        Product #{item.product_id}
                      </button>
                      {item.is_live && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 font-medium">
                          <CheckCircle2 size={10} />
                          Estimated {item.live_fetched_at || ""}
                        </span>
                      )}
                    </div>
                  </td>
                  <td>
                    <span className="badge badge-blue capitalize">{item.category}</span>
                  </td>

                  {["blinkit", "zepto", "instamart", "bigbasket"].map((key) => {
                    const info = platformMap[key];
                    const price = info?.price ?? 0;

                    return (
                      <td key={key} className="text-right">
                        {price > 0 ? (
                          <div className="flex items-center justify-end gap-1">
                            <span className="font-semibold" style={{ color: cellColor(price) }}>{fmt(price)}</span>
                            {info?.url && info.url !== "#" && (
                              <a
                                href={info.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="View on store"
                                className="text-slate-400 hover:text-violet-600 transition-colors"
                              >
                                <ExternalLink size={10} />
                              </a>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-slate-300">—</span>
                        )}
                      </td>
                    );
                  })}

                  <td className="text-right text-slate-600 font-semibold">
                    {fmt(item.market_avg)}
                  </td>
                  <td className="text-center">
                    <span className="badge badge-blue">{item.cheapest_platform}</span>
                  </td>
                  <td className="text-center">
                    <button
                      onClick={() => handleFetchLive(item.product_id)}
                      disabled={isRowLoading}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all hover:scale-[1.03] active:scale-95 cursor-pointer disabled:opacity-50"
                      style={{
                        background: item.is_live ? "rgba(16,185,129,0.08)" : "rgba(124,58,237,0.08)",
                        border: item.is_live ? "1px solid rgba(16,185,129,0.2)" : "1px solid rgba(124,58,237,0.2)",
                        color: item.is_live ? "#10b981" : "#7c3aed",
                      }}
                      title="Refresh estimated prices"
                    >
                      <RefreshCw size={10} className={isRowLoading ? "animate-spin" : ""} />
                      {isRowLoading ? "Updating..." : item.is_live ? "Refetched" : "Fetch Live"}
                    </button>
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