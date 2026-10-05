"use client";

/** CompetitorPanel — one product's competitor observations, market position and price history. */

import Link from "next/link";
import { useState } from "react";
import { ExternalLink, PencilLine, RefreshCw } from "lucide-react";
import {
  CompetitorHistory, errorMessage, getCompetitorHistory, getPlatforms, getProductCompetitors, inr, pct, ProductCompetitors, recordCompetitorPrice, refreshCompetitors, unlinkCompetitor,
} from "@/lib/api";
import { useApp } from "@/components/providers/AppProvider";
import { DataStatusBadge, EmptyState, ErrorState, Field, Modal, Notice, RoleGate, SkeletonRows, Spinner, Tabs, useAsync } from "@/components/ui/kit";
import { PriceHistoryChart } from "@/components/charts/viz";

const age = (m: number | null) => (m === null ? "" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`);

export default function CompetitorPanel({ data, onChange }: { data: ProductCompetitors; onChange: (d: ProductCompetitors) => void }) {
  const { storeId, toast, toastError, confirm, can } = useApp();
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState(false);
  const [range, setRange] = useState<"24h" | "7d" | "30d" | "90d">("30d");
  const hist = useAsync<CompetitorHistory>(() => getCompetitorHistory(storeId, data.product_id, range), [storeId, data.product_id, range]);
  const m = data.market;
  const names = Object.fromEntries(data.observations.map((o) => [o.competitor_key, o.competitor_name]));

  async function refresh() {
    setBusy(true);
    try {
      onChange(await refreshCompetitors(storeId, data.product_id));
      hist.reload();
      toast("Competitor prices refreshed");
    } catch (e) { toastError(e); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-5">
        {[
          ["Our price", inr(m.our_price)],
          ["Market average", m.average === null ? "No data" : inr(m.average)],
          ["Lowest", m.lowest === null ? "—" : `${inr(m.lowest)}`, m.lowest_platform ?? ""],
          ["Highest", m.highest === null ? "—" : inr(m.highest)],
          ["Difference vs avg", m.diff_vs_avg_pct === null ? "—" : pct(m.diff_vs_avg_pct, 1, true), m.diff_vs_avg !== null ? inr(m.diff_vs_avg) : ""],
        ].map(([k, v, s]) => (
          <div key={k} className="rounded-xl border border-slate-100 bg-white p-3"><p className="text-[11px] uppercase text-slate-500">{k}</p><p className="text-lg font-bold text-slate-800">{v}</p>{s && <p className="text-[11px] text-slate-500">{s}</p>}</div>
        ))}
      </div>
      <p className="text-xs text-slate-500">{m.note}{m.position !== "unknown" && <> · position: <b>{m.position.replace("_", " ")}</b></>}</p>

      <div className="flex flex-wrap gap-2">
        <RoleGate min="STORE_MANAGER">
          <button className="btn-secondary" onClick={refresh} disabled={busy}>{busy ? <Spinner /> : <RefreshCw size={14} />} Refresh linked listings</button>
          <button className="btn-secondary" onClick={() => setManual(true)}><PencilLine size={14} /> Record observed price</button>
        </RoleGate>
        <Link href={`/live-search?q=${encodeURIComponent(data.product_name)}&product=${data.product_id}`} className="btn-ghost">Find & link listings →</Link>
      </div>

      <div className="table-wrap"><table className="data-table">
        <thead><tr><th>Platform</th><th>Status</th><th className="text-right">Price</th><th className="text-right">MRP</th><th className="text-right">Discount</th><th>Stock</th><th>Listing</th><th className="text-right">vs ours</th><th>Observed</th></tr></thead>
        <tbody>{data.observations.map((o) => (
          <tr key={o.competitor_key}>
            <td className="font-medium">{o.competitor_name}</td>
            <td><DataStatusBadge status={o.status} />{o.source === "MANUAL" && o.status === "CACHED" && <span className="ml-1 text-[10px] text-slate-400">manual</span>}</td>
            <td className="num text-right font-semibold">{o.price === null ? "—" : inr(o.price)}</td>
            <td className="num text-right">{o.mrp === null ? "—" : inr(o.mrp)}</td>
            <td className="num text-right">{o.discount_pct === null ? "—" : pct(o.discount_pct)}</td>
            <td>{o.in_stock === null ? "—" : o.in_stock ? "In stock" : "Out of stock"}</td>
            <td className="max-w-[240px] text-xs">{!o.linked ? <span className="text-slate-400">Not linked</span> : <>
              {o.external_name ?? "—"}{o.pack_size && <span className="text-slate-400"> · {o.pack_size}</span>}
              {o.url && <a href={o.url} target="_blank" rel="noreferrer" className="ml-1 inline-flex text-violet-700" aria-label="Open listing"><ExternalLink size={11} /></a>}
              {o.error && <p className="text-[11px] text-amber-700">{o.error}</p>}
              {can("STORE_MANAGER") && <button className="ml-1 text-[11px] text-red-700 hover:underline" onClick={async () => {
                const r = await confirm({ title: `Unlink ${o.competitor_name} listing?`, message: "Removes the link and its recorded prices for this product.", danger: true, confirmLabel: "Unlink" });
                if (!r.ok) return;
                try { await unlinkCompetitor(storeId, data.product_id, o.competitor_key); onChange(await getProductCompetitors(storeId, data.product_id)); hist.reload(); toast("Listing unlinked"); } catch (e) { toastError(e); }
              }}>unlink</button>}</>}</td>
            <td className={`num text-right ${o.diff_pct !== null && o.diff_pct < 0 ? "text-red-700" : ""}`}>{o.diff_pct === null ? "—" : pct(o.diff_pct, 1, true)}</td>
            <td className="text-xs text-slate-500">{age(o.age_minutes)}</td>
          </tr>))}</tbody>
      </table></div>

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-slate-700">Price history — ours vs competitors</p>
          <Tabs tabs={[{ id: "24h", label: "24h" }, { id: "7d", label: "7 days" }, { id: "30d", label: "30 days" }, { id: "90d", label: "90 days" }]} value={range} onChange={setRange} />
        </div>
        {hist.error ? <ErrorState message={hist.error} /> : !hist.data ? <SkeletonRows rows={4} cols={1} /> : !hist.data.sufficient_data ? (
          <EmptyState title="Not enough observations for this range" message={hist.data.message} />
        ) : (
          <>
            <PriceHistoryChart points={hist.data.points} competitors={hist.data.competitors} names={names} />
            {Object.keys(hist.data.volatility_pct).length > 0 && (
              <p className="mt-1 text-xs text-slate-500">Price volatility (coefficient of variation): {Object.entries(hist.data.volatility_pct).map(([k, v]) => `${names[k] ?? k} ${v}%`).join(" · ")}</p>
            )}
          </>
        )}
      </div>
      <ManualModal open={manual} onClose={() => setManual(false)} productId={data.product_id} onSaved={(d) => { onChange(d); hist.reload(); setManual(false); }} />
    </div>
  );
}

function ManualModal({ open, onClose, productId, onSaved }: { open: boolean; onClose: () => void; productId: string; onSaved: (d: ProductCompetitors) => void }) {
  const { storeId, toast } = useApp();
  const platforms = useAsync(() => getPlatforms(), [], open);
  const [f, setF] = useState({ competitor_key: "", price: "", mrp: "", in_stock: "true", external_name: "", url: "", pack_size: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const price = Number(f.price), mrp = f.mrp ? Number(f.mrp) : undefined;
    if (!f.competitor_key) return setError("Choose a platform");
    if (!(price > 0)) return setError("Enter a price greater than zero");
    if (mrp !== undefined && price > mrp) return setError("Price cannot exceed the platform's MRP");
    setBusy(true);
    setError("");
    try {
      onSaved(await recordCompetitorPrice(storeId, productId, { competitor_key: f.competitor_key, price, mrp, in_stock: f.in_stock === "true",
        external_name: f.external_name || undefined, url: f.url || undefined, pack_size: f.pack_size || undefined }));
      toast("Observation recorded");
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title="Record an observed competitor price">
      <form onSubmit={save} className="space-y-3">
        <Notice>Use this for prices you verified yourself on the platform (e.g. where automated reading is blocked). It is stored as a manual observation, shown as MANUAL VERIFIED for 24 hours and CACHED afterwards. Enter only prices you have actually seen.</Notice>
        <Field label="Platform"><select className="select" value={f.competitor_key} onChange={(e) => setF({ ...f, competitor_key: e.target.value })}>
          <option value="">Choose…</option>{platforms.data?.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}</select></Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Price (₹)"><input className="input" inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></Field>
          <Field label="MRP (₹)"><input className="input" inputMode="decimal" value={f.mrp} onChange={(e) => setF({ ...f, mrp: e.target.value })} /></Field>
          <Field label="Availability"><select className="select" value={f.in_stock} onChange={(e) => setF({ ...f, in_stock: e.target.value })}><option value="true">In stock</option><option value="false">Out of stock</option></select></Field>
        </div>
        <Field label="Listing name"><input className="input" value={f.external_name} onChange={(e) => setF({ ...f, external_name: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Pack size"><input className="input" placeholder="e.g. 500 g" value={f.pack_size} onChange={(e) => setF({ ...f, pack_size: e.target.value })} /></Field>
          <Field label="Listing URL"><input className="input" type="url" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} /></Field>
        </div>
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>{busy && <Spinner />}Save</button></div>
      </form>
    </Modal>
  );
}
