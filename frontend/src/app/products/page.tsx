"use client";

/** /products — catalogue with search, filters, sorting, pagination, CRUD and bulk import. */

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Download, FileUp, Package, Pencil, Plus, Search, Trash2 } from "lucide-react";
import {
  deleteProduct, errorMessage, getCategories, getProducts, importProducts, importTemplateUrl, inr, pct, Product, ProductQuery,
} from "@/lib/api";
import { useApp } from "@/components/providers/AppProvider";
import ProductForm from "@/components/products/ProductForm";
import { Card, EmptyState, ErrorState, Modal, Notice, PageHeader, Pill, RoleGate, SkeletonRows, Spinner, SyntheticBadge, useAsync } from "@/components/ui/kit";

export default function ProductsPage() {
  const { storeId, confirm, toast, toastError } = useApp();
  const [q, setQ] = useState<ProductQuery>({ page: 1, page_size: 25, sort: "name", order: "asc" });
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Product | null | undefined>(undefined);
  const [importOpen, setImportOpen] = useState(false);
  const cats = useAsync(() => getCategories(storeId), [storeId]);
  const list = useAsync(() => getProducts(storeId, q), [storeId, JSON.stringify(q)]);

  useEffect(() => {
    const t = setTimeout(() => setQ((x) => ({ ...x, q: search || undefined, page: 1 })), 300);
    return () => clearTimeout(t);
  }, [search]);

  const setFilter = (patch: Partial<ProductQuery>) => setQ((x) => ({ ...x, ...patch, page: 1 }));
  const sortBy = (col: string) => setQ((x) => ({ ...x, sort: col, order: x.sort === col && x.order === "asc" ? "desc" : "asc" }));
  const totalPages = list.data ? Math.max(1, Math.ceil(list.data.total / (q.page_size ?? 25))) : 1;

  async function remove(p: Product) {
    const r = await confirm({ title: `Delete ${p.name}?`, message: "This removes the product with its sales, price history and recommendations. This cannot be undone.", confirmLabel: "Delete", danger: true, reasonLabel: "Reason" });
    if (!r.ok) return;
    try {
      await deleteProduct(storeId, p.id, r.reason);
      toast("Product deleted");
      list.reload();
    } catch (e) { toastError(e); }
  }

  return (
    <>
      <PageHeader title="Products" icon={Package} subtitle="Catalogue, pricing inputs and stock"
        actions={<RoleGate min="STORE_MANAGER">
          <button className="btn-secondary" onClick={() => setImportOpen(true)}><FileUp size={15} /> Import CSV / Excel</button>
          <button className="btn-primary" onClick={() => setEditing(null)}><Plus size={15} /> Add product</button>
        </RoleGate>} />

      <Card>
        <div className="mb-4 grid gap-3 md:grid-cols-5">
          <div className="relative md:col-span-2">
            <Search size={15} className="absolute left-3 top-2.5 text-slate-400" />
            <input className="input !pl-9" placeholder="Search name, SKU, barcode or brand" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search products" />
          </div>
          <select className="select" aria-label="Category" value={q.category ?? ""} onChange={(e) => setFilter({ category: e.target.value || undefined })}>
            <option value="">All categories</option>{cats.data?.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
          </select>
          <select className="select" aria-label="Stock status" value={q.stock_status ?? ""} onChange={(e) => setFilter({ stock_status: e.target.value || undefined })}>
            <option value="">Any stock level</option><option value="out">Out of stock</option><option value="low">Low stock</option><option value="over">Overstocked</option><option value="in">In stock</option>
          </select>
          <select className="select" aria-label="Expiry" value={q.expired ? "expired" : q.expiring_within ?? ""} onChange={(e) => {
            const v = e.target.value;
            setFilter(v === "expired" ? { expired: true, expiring_within: undefined } : { expired: undefined, expiring_within: v ? Number(v) : undefined });
          }}>
            <option value="">Any expiry</option><option value="3">Expiring ≤ 3 days</option><option value="7">Expiring ≤ 7 days</option><option value="30">Expiring ≤ 30 days</option><option value="expired">Already expired</option>
          </select>
        </div>

        {list.error ? <ErrorState message={list.error} onRetry={list.reload} /> : !list.data ? <SkeletonRows rows={8} cols={7} /> : list.data.data.length === 0 ? (
          <EmptyState title="No products match" message="Adjust the filters, add a product or import a file." />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr>
                <Th sort={q.sort} order={q.order} onSort={sortBy} col="name">Product</Th><Th sort={q.sort} order={q.order} onSort={sortBy} col="category">Category</Th><Th sort={q.sort} order={q.order} onSort={sortBy} col="cost_price" right>Cost</Th><Th sort={q.sort} order={q.order} onSort={sortBy} col="selling_price" right>Price</Th>
                <th className="text-right">MRP</th><Th sort={q.sort} order={q.order} onSort={sortBy} col="margin" right>Margin</Th><Th sort={q.sort} order={q.order} onSort={sortBy} col="stock" right>Stock</Th><Th sort={q.sort} order={q.order} onSort={sortBy} col="expiry_date">Expiry</Th><th />
              </tr></thead>
              <tbody>
                {list.data.data.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/product/${p.id}`} className="font-medium text-violet-700 hover:underline">{p.name}</Link>
                      <div className="flex items-center gap-1.5 text-xs text-slate-400"><span>{p.sku}</span>{p.brand && <span>· {p.brand}</span>}{p.is_perishable && <Pill tone="sky" title={p.shelf_life_days ? `Shelf life ${p.shelf_life_days} days` : "Perishable"}>perishable</Pill>}{p.is_synthetic && <SyntheticBadge />}</div>
                    </td>
                    <td>{p.category ?? "—"}</td>
                    <td className="num text-right">{inr(p.cost_price)}</td>
                    <td className="num text-right font-semibold">{inr(p.selling_price)}</td>
                    <td className="num text-right text-slate-500">{inr(p.mrp)}</td>
                    <td className="num text-right">{pct(p.margin_pct)}</td>
                    <td className="num text-right">{p.stock === 0 ? <Pill tone="red">Out</Pill> : p.stock}</td>
                    <td>{p.days_to_expiry === null ? "—" : p.days_to_expiry < 0 ? <Pill tone="red">Expired</Pill> :
                      <Pill tone={p.days_to_expiry <= 3 ? "red" : p.days_to_expiry <= 7 ? "amber" : "slate"}>{p.days_to_expiry} d</Pill>}</td>
                    <td className="text-right whitespace-nowrap">
                      <RoleGate min="STORE_MANAGER">
                        <button className="btn-ghost" aria-label={`Edit ${p.name}`} onClick={() => setEditing(p)}><Pencil size={14} /></button>
                        <button className="btn-ghost !text-red-600" aria-label={`Delete ${p.name}`} onClick={() => remove(p)}><Trash2 size={14} /></button>
                      </RoleGate>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {list.data && list.data.total > 0 && (
          <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
            <span>{list.data.total} product(s) · page {q.page} of {totalPages}</span>
            <div className="flex gap-2">
              <button className="btn-secondary !py-1" disabled={(q.page ?? 1) <= 1} onClick={() => setQ({ ...q, page: (q.page ?? 1) - 1 })}><ChevronLeft size={14} /> Prev</button>
              <button className="btn-secondary !py-1" disabled={(q.page ?? 1) >= totalPages} onClick={() => setQ({ ...q, page: (q.page ?? 1) + 1 })}>Next <ChevronRight size={14} /></button>
            </div>
          </div>
        )}
      </Card>

      <Modal open={editing !== undefined} title={editing ? `Edit ${editing.name}` : "Add product"} onClose={() => setEditing(undefined)} wide>
        {editing !== undefined && <ProductForm product={editing} categories={cats.data?.map((c) => c.name) ?? []}
          onCancel={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); list.reload(); cats.reload(); }} />}
      </Modal>
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} onDone={() => { list.reload(); cats.reload(); }} />
    </>
  );
}

function ImportModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { storeId, toast } = useApp();
  const [file, setFile] = useState<File | null>(null);
  const [opts, setOpts] = useState({ update_existing: false, skip_invalid: false });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Awaited<ReturnType<typeof importProducts>> | null>(null);
  const [error, setError] = useState("");

  async function run(dry: boolean) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const r = await importProducts(storeId, file, { ...opts, dry_run: dry });
      setResult(r);
      if (r.committed) { toast(`Imported: ${r.created} created, ${r.updated} updated`); onDone(); }
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  async function template() {
    const { getAccessToken } = await import("@/lib/auth");
    const res = await fetch(importTemplateUrl(storeId), { headers: { Authorization: `Bearer ${await getAccessToken()}` } });
    const url = URL.createObjectURL(await res.blob());
    Object.assign(document.createElement("a"), { href: url, download: "priceiq-product-import-template.csv" }).click();
  }

  return (
    <Modal open={open} title="Bulk import products" onClose={() => { onClose(); setResult(null); setFile(null); }} wide>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">Upload a <b>.csv</b> or <b>.xlsx</b> file (first sheet). Required columns: sku, name, cost_price, selling_price, mrp. Up to 5,000 rows.</p>
        <button className="btn-secondary" onClick={template}><Download size={14} /> Download template</button>
        <input type="file" accept=".csv,.xlsx" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null); }} className="block text-sm" aria-label="Import file" />
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={opts.update_existing} onChange={(e) => setOpts({ ...opts, update_existing: e.target.checked })} /> Update products whose SKU already exists</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={opts.skip_invalid} onChange={(e) => setOpts({ ...opts, skip_invalid: e.target.checked })} /> Import valid rows even if some rows fail</label>
        </div>
        {error && <Notice tone="danger">{error}</Notice>}
        {result && (
          <div className="space-y-2">
            <Notice tone={result.errors.length ? "warning" : "info"}>
              {result.dry_run ? "Dry run — nothing saved. " : result.committed ? "Import committed. " : "Nothing was saved because some rows are invalid. "}
              {result.total_rows} rows · {result.created} to create · {result.updated} to update · {result.skipped} with errors
            </Notice>
            {result.errors.length > 0 && (
              <div className="table-wrap max-h-64 overflow-y-auto"><table className="data-table">
                <thead><tr><th>Row</th><th>SKU</th><th>Problems</th></tr></thead>
                <tbody>{result.errors.map((e) => <tr key={e.row}><td>{e.row}</td><td>{e.sku}</td><td className="text-red-700">{Object.entries(e.errors).map(([k, v]) => `${k}: ${v}`).join("; ")}</td></tr>)}</tbody>
              </table></div>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" disabled={!file || busy} onClick={() => run(true)}>{busy && <Spinner />}Validate (dry run)</button>
          <button className="btn-primary" disabled={!file || busy} onClick={() => run(false)}>{busy && <Spinner />}Import</button>
        </div>
      </div>
    </Modal>
  );
}

function Th({ col, children, right, sort, order, onSort }: { col: string; children: React.ReactNode; right?: boolean; sort?: string; order?: string; onSort: (c: string) => void }) {
  return (
    <th className={right ? "text-right" : ""}><button onClick={() => onSort(col)} className="inline-flex items-center gap-1 uppercase" aria-label={`Sort by ${col}`}>
      {children}{sort === col && <span aria-hidden>{order === "asc" ? "▲" : "▼"}</span>}</button></th>
  );
}
