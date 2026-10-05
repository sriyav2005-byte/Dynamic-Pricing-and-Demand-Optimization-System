"use client";

/** /live-search — search real listings across platforms and link them to products. */

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ExternalLink, Link2, Search } from "lucide-react";
import { errorMessage, getProducts, inr, linkCompetitor, pct, searchCompetitors, SearchResponse } from "@/lib/api";
import { useApp } from "@/components/providers/AppProvider";
import { Card, DataStatusBadge, EmptyState, Field, Modal, Notice, PageHeader, RoleGate, Spinner, Tile, useAsync } from "@/components/ui/kit";

function SearchInner() {
  const params = useSearchParams();
  const { storeId, toast, toastError } = useApp();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [res, setRes] = useState<SearchResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [linking, setLinking] = useState<{ platform: string; name: string; url: string | null; external_id: string | null; pack_size: string | null } | null>(null);

  async function run(term = q) {
    if (term.trim().length < 2) return;
    setBusy(true);
    setError("");
    try { setRes(await searchCompetitors(storeId, term.trim())); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  useEffect(() => { const initial = params.get("q"); if (initial) void Promise.resolve().then(() => run(initial)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <PageHeader title="Competitor search" icon={Search} subtitle="Live search across Blinkit, Zepto, Swiggy Instamart and BigBasket" />
      <Card>
        <form onSubmit={(e) => { e.preventDefault(); run(); }} className="flex gap-2">
          <div className="relative flex-1"><Search size={15} className="absolute left-3 top-2.5 text-slate-400" />
            <input className="input !pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. amul butter 500g" aria-label="Search term" /></div>
          <button className="btn-primary" disabled={busy || q.trim().length < 2}>{busy ? <Spinner /> : <Search size={15} />} Search</button>
        </form>
        <p className="mt-2 text-xs text-slate-500">Searches run live (5–30 s, one headless browser session) for this store&apos;s delivery location and are cached for 30 minutes; cached results are labelled CACHED. Platforms that block automated access are shown as UNAVAILABLE with the reason.</p>
      </Card>
      {error && <div className="mt-4"><Notice tone="danger">{error}</Notice></div>}
      {busy && <div className="mt-6 flex items-center gap-2 text-sm text-slate-500"><Spinner /> Reading platforms…</div>}
      {res && !busy && (
        <div className="mt-6 space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label="Readable platforms" value={`${res.summary.live_platforms.length} / ${res.platforms.length}`}
              sub={`${res.cache.hit ? "served from cache" : "read just now"}${res.location?.source === "default" ? " · default location (store has no coordinates)" : ""}`} />
            <Tile label="Listings found" value={res.summary.listings} tone="slate" />
            <Tile label="Lowest price" value={inr(res.summary.lowest)} tone="green" sub="across all listings — check pack sizes" />
            <Tile label="Average" value={inr(res.summary.average)} tone="cyan" sub="unweighted, all listings" />
          </div>
          {res.platforms.map((p) => (
            <Card key={p.key} title={p.name} subtitle={`${p.method}${p.status !== "LIVE" && p.reason ? ` — ${p.reason}` : ""}`}
              actions={<div className="flex items-center gap-2"><DataStatusBadge status={res.cache.hit && p.status === "LIVE" ? "CACHED" : p.status} />
                <a href={p.search_url} target="_blank" rel="noreferrer" className="btn-ghost text-xs">Open on {p.name} <ExternalLink size={12} /></a></div>}>
              {p.listings.length === 0 ? <EmptyState title={p.blocked_by ? `Automated reading blocked (${p.blocked_by})` : "No prices from this platform"}
                message={`${p.reason ?? "No listings found."} Check the price on the platform and record it on the product's Competitors tab — it is then shown as MANUAL VERIFIED.`} /> : (
                <div className="table-wrap"><table className="data-table">
                  <thead><tr><th>Listing</th><th>Pack</th><th className="text-right">Price</th><th className="text-right">MRP</th><th className="text-right">Discount</th><th>Stock</th><th /></tr></thead>
                  <tbody>{p.listings.map((l, i) => (
                    <tr key={i}>
                      <td className="flex items-center gap-2">{l.image_url && <img src={l.image_url} alt="" className="h-8 w-8 rounded object-contain" />}<span className="font-medium">{l.name}</span></td>
                      <td>{l.pack_size ?? "—"}</td><td className="num text-right font-semibold">{inr(l.price)}</td><td className="num text-right">{inr(l.mrp)}</td>
                      <td className="num text-right">{pct(l.discount_pct)}</td><td>{l.in_stock === null ? "—" : l.in_stock ? "In stock" : "Out"}</td>
                      <td className="text-right whitespace-nowrap">
                        {l.url && <a href={l.url} target="_blank" rel="noreferrer" className="btn-ghost text-xs" aria-label="Open listing"><ExternalLink size={12} /></a>}
                        <RoleGate min="STORE_MANAGER"><button className="btn-ghost text-xs" onClick={() => setLinking({ platform: p.key, name: l.name, url: l.url, external_id: l.external_id, pack_size: l.pack_size })}><Link2 size={12} /> Link</button></RoleGate>
                      </td>
                    </tr>))}</tbody>
                </table></div>
              )}
            </Card>
          ))}
        </div>
      )}
      {!res && !busy && !error && <div className="mt-6"><EmptyState title="Search for a product" message="Results show real listings from platforms that can be read; others are marked UNAVAILABLE with the reason. Nothing is estimated." icon={Search} /></div>}
      <LinkModal target={linking} onClose={() => setLinking(null)} defaultProduct={params.get("product")}
        onLink={async (productId) => {
          if (!linking?.url) return;
          try {
            await linkCompetitor(storeId, productId, { competitor_key: linking.platform, url: linking.url, external_name: linking.name, external_id: linking.external_id, pack_size: linking.pack_size });
            toast("Listing linked and its price recorded");
            setLinking(null);
          } catch (e) { toastError(e); }
        }} />
    </>
  );
}

function LinkModal({ target, onClose, onLink, defaultProduct }: { target: { platform: string; name: string; pack_size: string | null } | null; onClose: () => void; onLink: (id: string) => Promise<void>; defaultProduct: string | null }) {
  const { storeId } = useApp();
  const products = useAsync(() => getProducts(storeId, { page_size: 200, sort: "name" }), [storeId], !!target);
  const [pid, setPid] = useState(defaultProduct ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <Modal open={!!target} onClose={onClose} title="Link listing to a product">
      {target && (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">Track <b>{target.name}</b>{target.pack_size ? ` (${target.pack_size})` : ""} as this product&apos;s {target.platform} listing. Its price will be refreshed periodically.</p>
          <Notice tone="warning">Only link the same product and pack size — a mismatched listing distorts market averages and pricing decisions.</Notice>
          <Field label="Product"><select className="select" value={pid} onChange={(e) => setPid(e.target.value)}>
            <option value="">Choose…</option>{products.data?.data.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}</select></Field>
          <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn-primary" disabled={!pid || busy} onClick={async () => { setBusy(true); await onLink(pid); setBusy(false); }}>{busy && <Spinner />}Link listing</button></div>
        </div>
      )}
    </Modal>
  );
}

export default function LiveSearchPage() {
  return <Suspense><SearchInner /></Suspense>;
}
