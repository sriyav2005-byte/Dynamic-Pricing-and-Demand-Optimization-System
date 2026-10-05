"use client";

/** ForecastPanel — 7/14/30-day demand forecast with interval, accuracy and caveats. */

import { useState } from "react";
import { getForecast, num, pct, dateFmt } from "@/lib/api";
import { useApp } from "@/components/providers/AppProvider";
import { ErrorState, Notice, Pill, SkeletonRows, Tabs, useAsync } from "@/components/ui/kit";
import { ForecastChart } from "@/components/charts/viz";

export default function ForecastPanel({ productId }: { productId: string }) {
  const { storeId } = useApp();
  const [h, setH] = useState<"7" | "14" | "30">("7");
  const fc = useAsync(() => getForecast(storeId, productId, Number(h) as 7 | 14 | 30), [storeId, productId, h]);
  const f = fc.data;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs tabs={[{ id: "7", label: "7 days" }, { id: "14", label: "14 days" }, { id: "30", label: "30 days" }]} value={h} onChange={setH} />
        {f && <Pill tone={f.confidence === "HIGH" ? "green" : f.confidence === "MEDIUM" ? "amber" : "red"}>{f.confidence} confidence</Pill>}
      </div>
      {fc.error ? <ErrorState message={fc.error} onRetry={fc.reload} /> : !f ? <SkeletonRows rows={6} cols={1} /> : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-5">
            {[
              ["Predicted demand", `${num(f.total_predicted_demand)} units`, `${f.avg_daily_demand.toFixed(1)}/day`],
              ["Expected sales", `${num(f.total_expected_sales)} units`, "limited by stock & expiry"],
              ["Recent sales", f.recent_avg_daily_units === null ? "—" : `${f.recent_avg_daily_units.toFixed(1)}/day`, "last 28 days of history"],
              ["Trend", f.trend, `${f.trend_slope_per_day >= 0 ? "+" : ""}${f.trend_slope_per_day.toFixed(2)} units/day²`],
              ["Peak day", f.peak ? dateFmt(f.peak.date) : "—", f.peak ? `${f.peak.demand.toFixed(1)} units` : ""],
            ].map(([k, v, s]) => (
              <div key={k} className="rounded-xl border border-slate-100 bg-white p-3"><p className="text-[11px] uppercase text-slate-500">{k}</p><p className="text-lg font-bold capitalize text-slate-800">{v}</p><p className="text-[11px] text-slate-500">{s}</p></div>
            ))}
          </div>
          <ForecastChart points={f.points} />
          <p className="text-xs text-slate-500">Model {f.model_version} (trained on {f.training_data.toLowerCase()} data) at the current price {`₹${f.price.toFixed(2)}`}. Shaded band: {Math.round(f.interval.level * 100)}% prediction interval ({f.interval.method}).</p>
          {f.accuracy ? (
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 text-xs text-slate-600">
              <b>Out-of-sample accuracy for this product</b> ({f.accuracy.n} days): MAE {f.accuracy.mae?.toFixed(2)} · RMSE {f.accuracy.rmse?.toFixed(2)} ·
              MAPE {pct(f.accuracy.mape_pct)} · WAPE {pct(f.accuracy.wape_pct)} · R² {f.accuracy.r2?.toFixed(2)}
              <p className="mt-0.5 text-slate-500">{f.accuracy.protocol}</p>
            </div>
          ) : <Notice tone="warning">No backtest available for this product (needs at least 60 days of history), so accuracy is unknown.</Notice>}
          {f.warnings.map((w, i) => <Notice key={i} tone={w.startsWith("History is the synthetic") ? "info" : "warning"}>{w}</Notice>)}
        </>
      )}
    </div>
  );
}
