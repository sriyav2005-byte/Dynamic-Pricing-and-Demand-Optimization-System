"use client";

/** /forecasting — store-wide demand outlook and per-product forecasts. */

import { useState } from "react";
import { TrendingUp } from "lucide-react";
import { dateFmt, getForecastOverview, num, pct } from "@/lib/api";
import { useApp } from "@/components/providers/AppProvider";
import { Card, EmptyState, ErrorState, Notice, PageHeader, Pill, SkeletonRows, Tabs, useAsync } from "@/components/ui/kit";
import ForecastPanel from "@/components/forecast/ForecastPanel";

export default function ForecastingPage() {
  const { storeId } = useApp();
  const [h, setH] = useState<"7" | "14" | "30">("7");
  const ov = useAsync(() => getForecastOverview(storeId, Number(h) as 7 | 14 | 30), [storeId, h]);
  const [selected, setSelected] = useState<string | null>(null);
  const items = (ov.data?.items ?? []).filter((i) => !i.error);
  const sel = selected ?? items[0]?.product_id ?? null;

  return (
    <>
      <PageHeader title="Demand forecasting" icon={TrendingUp} subtitle="XGBoost demand model with out-of-sample accuracy and prediction intervals"
        actions={<Tabs tabs={[{ id: "7", label: "7 days" }, { id: "14", label: "14 days" }, { id: "30", label: "30 days" }]} value={h} onChange={setH} />} />
      {ov.data?.store_accuracy && (
        <Notice>Store-level backtest: MAE {ov.data.store_accuracy.mae?.toFixed(2)} units/day · RMSE {ov.data.store_accuracy.rmse?.toFixed(2)} · WAPE {pct(ov.data.store_accuracy.wape_pct)} ·
          R² {ov.data.store_accuracy.r2?.toFixed(2)} over {num(ov.data.store_accuracy.n)} product-days. {ov.data.protocol}.</Notice>
      )}
      <div className="mt-5 grid gap-6 xl:grid-cols-5">
        <Card title="All products" subtitle="Click a product for its forecast" className="xl:col-span-2 min-w-0">
          {ov.error ? <ErrorState message={ov.error} onRetry={ov.reload} /> : !ov.data ? <SkeletonRows rows={10} cols={3} /> : items.length === 0 ? <EmptyState title="No forecastable products" /> : (
            <div className="table-wrap max-h-[640px] overflow-y-auto"><table className="data-table">
              <thead><tr><th>Product</th><th className="text-right">{h}-day demand</th><th>Trend</th><th>Confidence</th></tr></thead>
              <tbody>{items.map((i) => (
                <tr key={i.product_id} className={`cursor-pointer ${sel === i.product_id ? "bg-violet-50" : ""}`} onClick={() => setSelected(i.product_id)}>
                  <td className="min-w-[160px]"><span className="font-medium">{i.product_name}</span>{i.stockout_date && <div className="text-[11px] text-red-700">stock-out {dateFmt(i.stockout_date)}</div>}</td>
                  <td className="num text-right">{num(i.total_predicted_demand)}<div className="text-[11px] text-slate-400">{i.avg_daily_demand.toFixed(1)}/day</div></td>
                  <td className="capitalize">{i.trend}</td>
                  <td><Pill tone={i.confidence === "HIGH" ? "green" : i.confidence === "MEDIUM" ? "amber" : "red"}>{i.confidence}</Pill></td>
                </tr>))}</tbody>
            </table></div>
          )}
        </Card>
        <Card title={items.find((i) => i.product_id === sel)?.product_name ?? "Forecast"} className="xl:col-span-3 min-w-0">
          {sel ? <ForecastPanel key={sel} productId={sel} /> : <EmptyState title="Select a product" />}
        </Card>
      </div>
    </>
  );
}
