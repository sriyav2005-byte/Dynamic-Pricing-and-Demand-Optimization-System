"use client";

/** /inventory — stock intelligence, reorder advice and expiry markdown optimization. */

import Link from "next/link";
import { useMemo, useState } from "react";
import { Warehouse } from "lucide-react";
import { compactInr, dateFmt, getExpiryOptimization, getInventory, getMovements, inr, num, pct } from "@/lib/api";
import { useApp } from "@/components/providers/AppProvider";
import { Card, EmptyState, ErrorState, PageHeader, Pill, SkeletonCards, SkeletonRows, Tabs, Tile, useAsync } from "@/components/ui/kit";
import { StatusBarChart } from "@/components/charts/viz";

const STATUS_FILTERS = ["ALL", "OUT_OF_STOCK", "LOW_STOCK", "PREDICTED_STOCKOUT", "EXPIRY_RISK", "DEAD_STOCK", "OVERSTOCK"] as const;
type Tab = "intelligence" | "expiry" | "movements";

export default function InventoryPage() {
  const { storeId } = useApp();
  const [tab, setTab] = useState<Tab>("intelligence");
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]>("ALL");
  const inv = useAsync(() => getInventory(storeId), [storeId]);
  const d = inv.data;
  const rows = useMemo(() => (d?.products ?? []).filter((p) => status === "ALL" || p.statuses.includes(status))
    .sort((a, b) => (a.days_of_cover ?? 1e9) - (b.days_of_cover ?? 1e9)), [d, status]);

  return (
    <>
      <PageHeader title="Inventory intelligence" icon={Warehouse}
        subtitle={d ? `Velocity measured over the 28 days before ${dateFmt(d.reference_time)}${d.data_mode === "SYNTHETIC" ? " (end of the demo dataset)" : ""}` : undefined} />
      {inv.error ? <ErrorState message={inv.error} onRetry={inv.reload} /> : !d ? <SkeletonCards n={4} /> : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Tile label="Inventory value" value={compactInr(d.value_at_cost)} sub={`${compactInr(d.value_at_retail)} at retail`} />
          <Tile label="Units on hand" value={num(d.total_units)} tone="slate" sub={`${d.total_products} active products`} />
          <Tile label="Low / out of stock" value={(d.status_counts.LOW_STOCK ?? 0) + (d.status_counts.OUT_OF_STOCK ?? 0)} tone="amber" sub={`${d.status_counts.PREDICTED_STOCKOUT ?? 0} may stock out before a reorder arrives`} />
          <Tile label="Expiry risk" value={d.status_counts.EXPIRY_RISK ?? 0} tone="red" sub={`${inr(d.expiry_risk_value_at_cost, 0)} of stock may expire unsold`} />
        </div>
      )}
      <div className="my-6"><Tabs<Tab> tabs={[{ id: "intelligence", label: "Stock intelligence" }, { id: "expiry", label: "Expiry optimization" }, { id: "movements", label: "Stock movements" }]} value={tab} onChange={setTab} /></div>

      {tab === "intelligence" && d && (
        <div className="grid gap-6 xl:grid-cols-4">
          <Card title="Status distribution" className="xl:col-span-1"><StatusBarChart counts={d.status_counts} height={240} />
            <h3 className="mt-4 text-sm font-semibold text-slate-700">Category health</h3>
            <ul className="mt-2 space-y-1 text-sm">{d.categories.map((c) => (
              <li key={c.category} className="flex justify-between"><span>{c.category}</span><span className="num text-slate-600">{pct(c.health_pct, 0)} healthy · {c.at_risk} at risk</span></li>))}</ul>
          </Card>
          <Card title="Products" className="xl:col-span-3" actions={
            <select className="select !w-auto" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="Status filter">
              {STATUS_FILTERS.map((s) => <option key={s} value={s}>{s === "ALL" ? "All statuses" : s.replace(/_/g, " ").toLowerCase()}</option>)}</select>}>
            {rows.length === 0 ? <EmptyState title="No products with this status" /> : (
              <div className="table-wrap"><table className="data-table">
                <thead><tr><th>Product</th><th className="text-right">Stock</th><th className="text-right">Units/day</th><th className="text-right">Days of cover</th><th>Stock-out</th>
                  <th className="text-right">Safety stock</th><th className="text-right">Reorder qty</th><th>Expiry / wastage risk</th><th>Status</th></tr></thead>
                <tbody>{rows.map((p) => (
                  <tr key={p.product_id}>
                    <td className="min-w-[180px]"><Link href={`/product/${p.product_id}`} className="font-medium text-violet-700 hover:underline">{p.name}</Link><div className="text-[11px] text-slate-400">{p.sku} · {p.data_sufficiency} data</div></td>
                    <td className="num text-right">{p.stock}</td>
                    <td className="num text-right">{p.avg_daily_units}</td>
                    <td className="num text-right">{p.days_of_cover ?? "—"}</td>
                    <td className="text-xs">{p.predicted_stockout_date ? dateFmt(p.predicted_stockout_date) : "—"}</td>
                    <td className="num text-right" title="1.65 × σ × √lead time">{p.recommended_safety_stock ?? "—"}</td>
                    <td className="num text-right font-semibold">{p.recommended_reorder_qty || "—"}</td>
                    <td className="text-xs">{p.days_to_expiry === null ? "—" : p.days_to_expiry < 0 ? "expired" : `${p.days_to_expiry} d`}
                      {p.units_at_expiry_risk ? <div className="text-red-700" title="Units (and share of stock) not expected to sell before expiry at the current velocity">{p.units_at_expiry_risk} at risk{p.wastage_risk_pct !== null ? ` · ${pct(p.wastage_risk_pct, 0)}` : ""}</div> : null}</td>
                    <td><div className="flex flex-wrap gap-1">{p.statuses.length ? p.statuses.map((s) => <Pill key={s} tone={s.includes("OUT") || s.includes("EXPIRY") ? "red" : s.includes("OVER") || s.includes("DEAD") ? "sky" : "amber"}>{s.replace(/_/g, " ").toLowerCase()}</Pill>) : <Pill tone="green">healthy</Pill>}</div></td>
                  </tr>))}</tbody>
              </table></div>
            )}
          </Card>
        </div>
      )}
      {tab === "expiry" && <ExpiryTab />}
      {tab === "movements" && <MovementsTab />}
    </>
  );
}

function ExpiryTab() {
  const { storeId } = useApp();
  const ex = useAsync(() => getExpiryOptimization(storeId), [storeId]);
  if (ex.error) return <ErrorState message={ex.error} onRetry={ex.reload} />;
  if (!ex.data) return <SkeletonRows rows={6} cols={7} />;
  return (
    <Card title="Markdown recommendations for expiring stock"
      subtitle={`Products expiring within ${ex.data.window_days} days (or 14). Markdowns up to ${ex.data.max_markdown_pct.toFixed(0)}%, never below ${ex.data.floor}. ${ex.data.method}`}>
      {ex.data.items.length === 0 ? <EmptyState title="No stock is close to expiry" /> : (
        <div className="table-wrap"><table className="data-table">
          <thead><tr><th>Product</th><th className="text-right">Days left</th><th className="text-right">Stock</th><th className="text-right">Wastage risk at current price</th>
            <th className="text-right">Recommended</th><th className="text-right">Expected liquidation</th><th className="text-right">Waste avoided</th><th className="text-right">Profit gain</th></tr></thead>
          <tbody>{ex.data.items.map((i) => (
            <tr key={i.product_id}>
              <td className="min-w-[180px]"><Link href={`/product/${i.product_id}`} className="font-medium text-violet-700 hover:underline">{i.product_name}</Link><div className="flex flex-wrap gap-1"><Pill tone={i.expiry_risk === "CRITICAL" ? "red" : i.expiry_risk === "HIGH" ? "amber" : "slate"}>{i.expiry_risk}</Pill>
                {i.considerations && i.considerations.length > 0 && <Pill tone="violet" title={i.considerations.map((c) => `${c.name} (${c.applied_change_pct > 0 ? "+" : ""}${c.applied_change_pct}% demand)`).join("; ")}>seasonal consideration</Pill>}</div></td>
              <td className="num text-right">{i.days_to_expiry}</td><td className="num text-right">{i.stock}</td>
              <td className="num text-right">{num(i.at_current_price.waste_units)} units{i.wastage_risk_pct != null ? <div className="text-[11px] text-slate-500">{pct(i.wastage_risk_pct, 0)} of stock</div> : null}</td>
              <td className="num text-right font-semibold">{i.recommended.markdown_pct > 0 ? `−${i.recommended.markdown_pct}% → ${inr(i.recommended.price)}` : `Hold ${inr(i.recommended.price)}`}</td>
              <td className="num text-right">{pct(i.recommended.liquidation_pct, 0)}</td>
              <td className="num text-right text-emerald-700">{num(i.waste_reduction_units)}</td>
              <td className={`num text-right font-semibold ${i.profit_gain >= 0 ? "text-emerald-700" : "text-red-700"}`}>{inr(i.profit_gain)}</td>
            </tr>))}</tbody>
        </table></div>
      )}
      <p className="mt-2 text-xs text-slate-500">Apply a markdown by generating a price recommendation on the product page — it passes the same constraint checks and approval workflow.</p>
    </Card>
  );
}

function MovementsTab() {
  const { storeId } = useApp();
  const mv = useAsync(() => getMovements(storeId), [storeId]);
  if (mv.error) return <ErrorState message={mv.error} onRetry={mv.reload} />;
  if (!mv.data) return <SkeletonRows rows={6} cols={6} />;
  return (
    <Card title="Recent stock movements" subtitle="Every stock change is logged automatically (sales, restocks, adjustments, waste, imports)">
      {mv.data.data.length === 0 ? <EmptyState title="No movements yet" /> : (
        <div className="table-wrap"><table className="data-table">
          <thead><tr><th>When</th><th>Product</th><th>Reason</th><th className="text-right">Change</th><th className="text-right">Stock after</th><th>By</th></tr></thead>
          <tbody>{mv.data.data.map((m) => (
            <tr key={m.id}><td className="text-xs">{dateFmt(m.created_at, true)}</td><td>{m.product_name}</td><td><Pill>{m.reason}</Pill></td>
              <td className={`num text-right ${m.change < 0 ? "text-red-700" : "text-emerald-700"}`}>{m.change > 0 ? "+" : ""}{m.change}</td><td className="num text-right">{m.stock_after}</td><td className="text-xs">{m.created_by ?? "system"}</td></tr>))}</tbody>
        </table></div>
      )}
    </Card>
  );
}
