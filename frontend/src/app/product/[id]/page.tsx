"use client";

/** /product/[id] — everything about one product: pricing, simulation, forecast, competitors, history. */

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Boxes, Package, Pencil, ShoppingCart, Sparkles } from "lucide-react";
import {
  adjustStock, dateFmt, errorMessage, generateRecommendation, getCategories, getCrossEffects, getElasticity, getMovements, getPriceHistory, getProduct,
  getProductCompetitors, getProductInventory, getRecommendations, inr, num, pct, recordSale,
} from "@/lib/api";
import { useApp } from "@/components/providers/AppProvider";
import {
  Card, EmptyState, ErrorState, Field, Modal, Notice, PageHeader, Pill, RoleGate, Skeleton, SkeletonRows, Spinner, SyntheticBadge, Tabs, Tile, useAsync,
} from "@/components/ui/kit";
import ProductForm from "@/components/products/ProductForm";
import RecommendationCard from "@/components/pricing/RecommendationCard";
import SimulatorPanel from "@/components/pricing/SimulatorPanel";
import CompetitorPanel from "@/components/competitors/CompetitorPanel";
import ForecastPanel from "@/components/forecast/ForecastPanel";
import { OwnPriceHistoryChart } from "@/components/charts/viz";

type Tab = "overview" | "simulate" | "forecast" | "competitors" | "history";

export default function ProductPage() {
  const { id } = useParams<{ id: string }>();
  const { storeId, toastError, toast } = useApp();
  const [tab, setTab] = useState<Tab>("overview");
  const [edit, setEdit] = useState(false);
  const [sale, setSale] = useState(false);
  const [stock, setStock] = useState(false);
  const [generating, setGenerating] = useState(false);
  const product = useAsync(() => getProduct(storeId, id), [storeId, id]);
  const inv = useAsync(() => getProductInventory(storeId, id), [storeId, id]);
  const recs = useAsync(() => getRecommendations(storeId, { product_id: id, page_size: 5 }), [storeId, id]);
  const cats = useAsync(() => getCategories(storeId), [storeId], edit);
  const p = product.data;

  async function generate() {
    setGenerating(true);
    try {
      await generateRecommendation(storeId, id);
      recs.reload();
      product.reload();
      toast("Recommendation generated — no price has been changed");
    } catch (e) { toastError(e); } finally { setGenerating(false); }
  }

  if (product.error) return <ErrorState message={product.error} onRetry={product.reload} />;
  if (!p) return <div className="space-y-4"><Skeleton className="h-10 w-72" /><SkeletonRows rows={6} cols={4} /></div>;
  const latest = recs.data?.data[0];

  return (
    <>
      <Link href="/products" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-violet-700"><ArrowLeft size={14} /> Products</Link>
      <PageHeader title={p.name} icon={Package}
        subtitle={`${p.sku}${p.brand ? ` · ${p.brand}` : ""}${p.category ? ` · ${p.category}` : ""}${p.barcode ? ` · ${p.barcode}` : ""}`}
        actions={<>
          {p.is_synthetic && <SyntheticBadge />}
          <RoleGate min="STORE_MANAGER">
            <button className="btn-secondary" onClick={() => setSale(true)}><ShoppingCart size={15} /> Record sale</button>
            <button className="btn-secondary" onClick={() => setStock(true)}><Boxes size={15} /> Adjust stock</button>
            <button className="btn-secondary" onClick={() => setEdit(true)}><Pencil size={15} /> Edit</button>
          </RoleGate>
        </>} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Selling price" value={inr(p.selling_price)} sub={`MRP ${inr(p.mrp)} · cost ${inr(p.cost_price)}`} />
        <Tile label="Gross margin" value={pct(p.margin_pct)} tone="green" sub={`${inr(p.selling_price - p.cost_price)} per unit`} />
        <Tile label="Stock" value={num(p.stock)} tone="cyan" sub={inv.data ? (inv.data.days_of_cover === null ? "no recent sales" : `${inv.data.days_of_cover.toFixed(1)} days of cover`) : "…"} />
        <Tile label="Expiry" tone={p.days_to_expiry !== null && p.days_to_expiry <= 7 ? "amber" : "slate"}
          value={p.days_to_expiry === null ? "None" : p.days_to_expiry < 0 ? "Expired" : `${p.days_to_expiry} days`}
          sub={p.expiry_date ? `${dateFmt(p.expiry_date)}${p.batch_number ? ` · batch ${p.batch_number}` : ""}${p.shelf_life_days ? ` · shelf life ${p.shelf_life_days} d` : ""}` : p.is_perishable ? "perishable — no expiry date recorded" : "no expiry date"} />
      </div>

      <div className="my-6 overflow-x-auto">
        <Tabs<Tab> tabs={[{ id: "overview", label: "Pricing & inventory" }, { id: "simulate", label: "What-if simulator" }, { id: "forecast", label: "Forecast" },
          { id: "competitors", label: "Competitors" }, { id: "history", label: "History & elasticity" }]} value={tab} onChange={setTab} />
      </div>

      {tab === "overview" && (
        <div className="grid gap-6 xl:grid-cols-3">
          <div className="space-y-4 xl:col-span-2">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-800">Price recommendation</h2>
              <RoleGate min="ANALYST"><button className="btn-primary" onClick={generate} disabled={generating}>{generating ? <Spinner /> : <Sparkles size={15} />} Generate new</button></RoleGate>
            </div>
            {recs.error ? <ErrorState message={recs.error} /> : !recs.data ? <SkeletonRows rows={4} cols={2} /> : latest ? (
              <RecommendationCard rec={latest} onChanged={() => { recs.reload(); product.reload(); inv.reload(); }} />
            ) : <EmptyState title="No recommendation yet" message="Generate one to see the AI's price, its reasons and the constraints it passed." />}
            {recs.data && recs.data.data.length > 1 && (
              <Card title="Earlier recommendations">
                <ul className="divide-y divide-slate-100 text-sm">{recs.data.data.slice(1).map((r) => (
                  <li key={r.id} className="flex justify-between py-2"><span>{dateFmt(r.created_at, true)} · {inr(r.current_price)} → <b>{inr(r.recommended_price)}</b></span><Pill>{r.status}</Pill></li>))}</ul>
              </Card>
            )}
          </div>
          <Card title="Inventory intelligence" subtitle={inv.data ? `Sales velocity over the last 28 days of data · ${inv.data.data_sufficiency} data` : undefined}>
            {inv.error ? <ErrorState message={inv.error} /> : !inv.data ? <SkeletonRows rows={6} cols={2} /> : (
              <dl className="space-y-2 text-sm">
                {([
                  ["Average daily sales", `${inv.data.avg_daily_units} units (σ ${inv.data.std_daily_units})`],
                  ["Days of cover", inv.data.days_of_cover === null ? "—" : `${inv.data.days_of_cover} days`],
                  ["Predicted stock-out", inv.data.predicted_stockout_date ? dateFmt(inv.data.predicted_stockout_date) : "—"],
                  ["Supplier lead time", `${inv.data.lead_time_days} days`],
                  ["Recommended safety stock", inv.data.recommended_safety_stock === null ? "Not enough history" : `${inv.data.recommended_safety_stock} units (95% service level)`],
                  ["Reorder point", inv.data.reorder_point === null ? "—" : `${inv.data.reorder_point} units`],
                  ["Suggested reorder", inv.data.recommended_reorder_qty ? `${inv.data.recommended_reorder_qty} units` : "Not needed now"],
                  ["Units at expiry risk", inv.data.units_at_expiry_risk === null ? "—" : `${inv.data.units_at_expiry_risk} (${inv.data.expiry_risk})`],
                  ["Wastage risk", inv.data.wastage_risk_pct === null ? "—" : `${pct(inv.data.wastage_risk_pct, 0)} of stock may expire unsold`],
                  ["Perishable / shelf life", `${p.is_perishable ? "Yes" : "No"}${p.shelf_life_days ? ` · ${p.shelf_life_days} days` : ""}`],
                  ["Sensitivity (season / festival / weather)", [p.seasonal_sensitivity, p.festival_sensitivity, p.weather_sensitivity].map((v) => (v === null ? "—" : v.toFixed(1))).join(" / ")],
                  ["Value at cost / retail", `${inr(inv.data.value_at_cost, 0)} / ${inr(inv.data.value_at_retail, 0)}`],
                  ["Last sale", dateFmt(inv.data.last_sold_at)],
                ] as const).map(([k, v]) => <div key={k} className="flex justify-between gap-3"><dt className="text-slate-500">{k}</dt><dd className="text-right font-medium text-slate-700">{v}</dd></div>)}
                <div className="flex flex-wrap gap-1 pt-2">{inv.data.statuses.length ? inv.data.statuses.map((s) => <Pill key={s} tone="amber">{s.replace(/_/g, " ")}</Pill>) : <Pill tone="green">Healthy</Pill>}</div>
              </dl>
            )}
          </Card>
        </div>
      )}

      {tab === "simulate" && <Card title="What-if price simulator" subtitle="Model-based estimates; the allowed band shows prices the constraint engine would accept."><SimulatorPanel key={id} productId={id} currentPrice={p.selling_price} mrp={p.mrp} /></Card>}
      {tab === "forecast" && <Card title="Demand forecast"><ForecastPanel productId={id} /></Card>}
      {tab === "competitors" && <CompetitorsTab productId={id} />}
      {tab === "history" && <HistoryTab productId={id} />}

      <Modal open={edit} title={`Edit ${p.name}`} onClose={() => setEdit(false)} wide>
        {edit && <ProductForm product={p} categories={cats.data?.map((c) => c.name) ?? []} onCancel={() => setEdit(false)} onSaved={() => { setEdit(false); product.reload(); inv.reload(); }} />}
      </Modal>
      <SaleModal open={sale} onClose={() => setSale(false)} productId={id} price={p.selling_price} mrp={p.mrp} stock={p.stock} recommendationId={latest?.status === "APPLIED" ? latest.id : undefined}
        onDone={() => { setSale(false); product.reload(); inv.reload(); }} />
      <StockModal open={stock} onClose={() => setStock(false)} productId={id} onDone={() => { setStock(false); product.reload(); inv.reload(); }} />
    </>
  );
}

function CompetitorsTab({ productId }: { productId: string }) {
  const { storeId } = useApp();
  const c = useAsync(() => getProductCompetitors(storeId, productId), [storeId, productId]);
  return (
    <Card title="Competitor intelligence" subtitle="Blinkit, Zepto, Swiggy Instamart and BigBasket">
      {c.error ? <ErrorState message={c.error} onRetry={c.reload} /> : !c.data ? <SkeletonRows rows={5} cols={6} /> : <CompetitorPanel data={c.data} onChange={c.setData} />}
    </Card>
  );
}

function HistoryTab({ productId }: { productId: string }) {
  const { storeId } = useApp();
  const [days, setDays] = useState<"30" | "90" | "365">("90");
  const hist = useAsync(() => getPriceHistory(storeId, productId, Number(days)), [storeId, productId, days]);
  const el = useAsync(() => getElasticity(storeId, productId), [storeId, productId]);
  const cross = useAsync(() => getCrossEffects(storeId, productId), [storeId, productId]);
  const mv = useAsync(() => getMovements(storeId, productId), [storeId, productId]);
  const points = (hist.data ?? []).slice().reverse().map((h) => ({ t: h.created_at, price: h.new_price }));
  const changes = (hist.data ?? []).filter((h) => h.source !== "IMPORT").slice(0, 15);
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card title="Our price history" actions={<Tabs tabs={[{ id: "30", label: "30d" }, { id: "90", label: "90d" }, { id: "365", label: "1y" }]} value={days} onChange={setDays} />}>
        {hist.error ? <ErrorState message={hist.error} /> : !hist.data ? <SkeletonRows rows={4} cols={1} /> : points.length < 2 ? <EmptyState title="Not enough price changes in this range" /> : <OwnPriceHistoryChart points={points} />}
        <p className="mt-2 text-xs text-slate-500">Range is relative to the store&apos;s latest data. Imported (dataset) changes are charted but not listed below.</p>
        {changes.length > 0 && (
          <ul className="mt-3 divide-y divide-slate-100 text-sm">{changes.map((h, i) => (
            <li key={i} className="flex justify-between py-2"><span>{dateFmt(h.created_at, true)} · {inr(h.old_price)} → <b>{inr(h.new_price)}</b> <Pill>{h.source}</Pill></span>
              <span className="text-xs text-slate-500">{h.changed_by ?? "system"}{h.reason ? ` — ${h.reason}` : ""}</span></li>))}</ul>
        )}
      </Card>
      <Card title="Price elasticity" subtitle="How demand responds to this product's own price">
        {el.error ? <ErrorState message={el.error} /> : !el.data ? <SkeletonRows rows={3} cols={2} /> : (
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2"><Pill tone={el.data.status === "ESTIMATED" ? "green" : el.data.status === "NOT_SIGNIFICANT" ? "amber" : "slate"}>{el.data.status.replace(/_/g, " ")}</Pill>
              {el.data.elasticity !== null && <span className="text-2xl font-bold text-slate-800">{el.data.elasticity.toFixed(2)}</span>}</div>
            {el.data.interpretation && <p className="text-slate-700">{el.data.interpretation}.</p>}
            {el.data.reason && <p className="text-slate-600">{el.data.reason}</p>}
            {el.data.ci_low !== undefined && <p className="text-xs text-slate-500">95% CI {el.data.ci_low?.toFixed(2)} to {el.data.ci_high?.toFixed(2)} · p = {el.data.p_value?.toPrecision(2)} · {el.data.n_obs} days · price variation {pct((el.data.price_cv ?? 0) * 100)}</p>}
            <p className="text-xs text-slate-400">{el.data.method}; controls for day of week, month and days to expiry. Estimates only — observational data can be confounded.</p>
          </div>
        )}
        <h3 className="mt-5 text-sm font-semibold text-slate-700">Cross-product effects</h3>
        {cross.error ? <ErrorState message={cross.error} /> : !cross.data ? <SkeletonRows rows={2} cols={2} /> : cross.data.relationships.length === 0 ? (
          <p className="mt-1 text-sm text-slate-500">{cross.data.note}</p>
        ) : (
          <ul className="mt-1 space-y-1 text-sm">{cross.data.relationships.map((r, i) => (
            <li key={i}><Pill tone={r.relationship === "SUBSTITUTE" ? "amber" : "sky"}>{r.relationship}</Pill> {r.related_product} — cross-elasticity {r.cross_elasticity.toFixed(2)} (p = {r.p_value.toPrecision(2)}); {r.direction}</li>))}</ul>
        )}
      </Card>
      <Card title="Stock movements" className="xl:col-span-2">
        {mv.error ? <ErrorState message={mv.error} /> : !mv.data ? <SkeletonRows rows={4} cols={5} /> : mv.data.data.length === 0 ? <EmptyState title="No stock movements recorded" /> : (
          <div className="table-wrap"><table className="data-table">
            <thead><tr><th>When</th><th>Reason</th><th className="text-right">Change</th><th className="text-right">Stock after</th><th>By</th><th>Note</th></tr></thead>
            <tbody>{mv.data.data.map((m) => (
              <tr key={m.id}><td>{dateFmt(m.created_at, true)}</td><td><Pill>{m.reason}</Pill></td><td className={`num text-right ${m.change < 0 ? "text-red-700" : "text-emerald-700"}`}>{m.change > 0 ? "+" : ""}{m.change}</td>
                <td className="num text-right">{m.stock_after}</td><td className="text-xs">{m.created_by ?? "system"}</td><td className="text-xs text-slate-500">{m.note ?? ""}</td></tr>))}</tbody>
          </table></div>
        )}
      </Card>
    </div>
  );
}

function SaleModal({ open, onClose, productId, price, mrp, stock, recommendationId, onDone }: { open: boolean; onClose: () => void; productId: string; price: number; mrp: number; stock: number; recommendationId?: string; onDone: () => void }) {
  const { storeId, toast } = useApp();
  const [qty, setQty] = useState("1");
  const [unit, setUnit] = useState(String(price));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const q = Number(qty), u = Number(unit);
    if (!Number.isInteger(q) || q <= 0) return setError("Quantity must be a whole number above zero");
    if (q > stock) return setError(`Only ${stock} units in stock`);
    if (!(u >= 0) || u > mrp) return setError(`Unit price must be between ₹0 and the MRP (${inr(mrp)})`);
    setBusy(true);
    setError("");
    try {
      const s = await recordSale(storeId, { product_id: productId, quantity: q, unit_price: u, recommendation_id: recommendationId });
      toast(`Sale recorded: ${s.quantity} × ${inr(s.unit_price)} — the pricing model learns from it`);
      onDone();
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title="Record a sale">
      <form onSubmit={save} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Quantity" hint={`${stock} in stock`}><input className="input" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
          <Field label="Unit price (₹)" hint={`MRP ${inr(mrp)}`}><input className="input" inputMode="decimal" value={unit} onChange={(e) => setUnit(e.target.value)} /></Field>
        </div>
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>{busy && <Spinner />}Record sale</button></div>
      </form>
    </Modal>
  );
}

function StockModal({ open, onClose, productId, onDone }: { open: boolean; onClose: () => void; productId: string; onDone: () => void }) {
  const { storeId, toast } = useApp();
  const [reason, setReason] = useState("RESTOCK");
  const [change, setChange] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(e: React.FormEvent) {
    e.preventDefault();
    let c = Number(change);
    if (!Number.isInteger(c) || c === 0) return setError("Enter a non-zero whole number");
    if (reason === "WASTE") c = -Math.abs(c);
    if (reason === "RESTOCK" || reason === "RETURN") c = Math.abs(c);
    setBusy(true);
    setError("");
    try {
      const r = await adjustStock(storeId, productId, { change: c, reason, note });
      toast(`Stock updated — now ${r.stock} units`);
      onDone();
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title="Adjust stock">
      <form onSubmit={save} className="space-y-3">
        <Field label="Reason"><select className="select" value={reason} onChange={(e) => setReason(e.target.value)}>
          <option value="RESTOCK">Restock (+)</option><option value="RETURN">Customer return (+)</option><option value="WASTE">Waste / expired (−)</option><option value="ADJUSTMENT">Count correction (±)</option></select></Field>
        <Field label="Units" hint={reason === "ADJUSTMENT" ? "Use a negative number to reduce stock" : undefined}><input className="input" inputMode="numeric" value={change} onChange={(e) => setChange(e.target.value)} /></Field>
        <Field label="Note"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Stored in the stock movement log" /></Field>
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>{busy && <Spinner />}Save</button></div>
      </form>
    </Modal>
  );
}
