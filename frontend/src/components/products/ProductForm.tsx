"use client";

/** Create / edit product form with client-side validation mirroring the API rules. */

import { useState } from "react";
import { createProduct, errorMessage, Product, ProductInput, updateProduct } from "@/lib/api";
import { useApp } from "@/components/providers/AppProvider";
import { Field, Notice, Spinner } from "@/components/ui/kit";

type F = Record<string, string>;

const SENSITIVITIES = ["seasonal_sensitivity", "festival_sensitivity", "weather_sensitivity"] as const;
const optionalNumber = (v: string) => (v === "" ? -1 : Number(v));

function gtinValid(code: string) {
  if (!/^\d+$/.test(code) || ![8, 12, 13, 14].includes(code.length)) return true; // non-GTIN internal codes allowed
  let sum = 0;
  for (let i = 0; i < code.length - 1; i++) {
    const d = Number(code[code.length - 2 - i]);
    sum += i % 2 === 0 ? d * 3 : d;
  }
  return (10 - (sum % 10)) % 10 === Number(code[code.length - 1]);
}

export default function ProductForm({ product, categories, onSaved, onCancel }: {
  product?: Product | null; categories: string[]; onSaved: (p: Product) => void; onCancel: () => void;
}) {
  const { storeId, toast } = useApp();
  const [f, setF] = useState<F>(() => ({
    sku: product?.sku ?? "", name: product?.name ?? "", brand: product?.brand ?? "", barcode: product?.barcode ?? "",
    category: product?.category ?? "", subcategory: product?.subcategory ?? "", supplier: product?.supplier ?? "",
    image_url: product?.image_url ?? "", cost_price: product ? String(product.cost_price) : "", selling_price: product ? String(product.selling_price) : "",
    mrp: product ? String(product.mrp) : "", stock: product ? String(product.stock) : "0", reorder_level: product ? String(product.reorder_level) : "0",
    safety_stock: product ? String(product.safety_stock) : "0", expiry_date: product?.expiry_date ?? "", batch_number: product?.batch_number ?? "",
    is_perishable: product?.is_perishable ? "true" : "false", reason: "",
    pack_size: product?.pack_size ?? "", shelf_life_days: product?.shelf_life_days != null ? String(product.shelf_life_days) : "",
    seasonal_sensitivity: product?.seasonal_sensitivity != null ? String(product.seasonal_sensitivity) : "",
    festival_sensitivity: product?.festival_sensitivity != null ? String(product.festival_sensitivity) : "",
    weather_sensitivity: product?.weather_sensitivity != null ? String(product.weather_sensitivity) : "",
  }));
  const [errors, setErrors] = useState<F>({});
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState("");
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  function validate(): F {
    const e: F = {};
    const n = (k: string) => Number(f[k]);
    if (!f.sku.trim()) e.sku = "Required";
    else if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/.test(f.sku.trim())) e.sku = "Letters, digits, . _ / - (max 64)";
    if (!f.name.trim()) e.name = "Required";
    for (const k of ["cost_price", "selling_price", "mrp"]) if (f[k] === "" || Number.isNaN(n(k))) e[k] = "Enter a number";
    if (!e.cost_price && n("cost_price") < 0) e.cost_price = "Cannot be negative";
    if (!e.selling_price && n("selling_price") <= 0) e.selling_price = "Must be greater than zero";
    if (!e.mrp && n("mrp") <= 0) e.mrp = "Must be greater than zero";
    if (!e.selling_price && !e.mrp && n("selling_price") > n("mrp")) e.selling_price = "Cannot exceed MRP";
    if (!e.cost_price && !e.mrp && n("cost_price") > n("mrp")) e.cost_price = "Cannot exceed MRP";
    for (const k of ["stock", "reorder_level", "safety_stock"]) if (!/^\d+$/.test(f[k])) e[k] = "Whole number ≥ 0";
    if (f.barcode && !gtinValid(f.barcode)) e.barcode = "Invalid GTIN/EAN check digit";
    if (f.shelf_life_days && (!/^\d+$/.test(f.shelf_life_days) || n("shelf_life_days") < 1 || n("shelf_life_days") > 3650)) e.shelf_life_days = "Whole days, 1–3650";
    for (const k of SENSITIVITIES) if (f[k] !== "" && (Number.isNaN(n(k)) || n(k) < 0 || n(k) > 1)) e[k] = "Between 0 and 1";
    if (f.is_perishable === "true" && !f.expiry_date && !product?.expiry_date) e.expiry_date = "Perishable products need an expiry date for wastage-risk pricing";
    if (f.expiry_date && f.expiry_date !== product?.expiry_date && new Date(f.expiry_date) < new Date(new Date().toDateString())) e.expiry_date = "Cannot be in the past";
    return e;
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) return;
    const body: ProductInput = {
      sku: f.sku.trim(), name: f.name.trim(), brand: f.brand, barcode: f.barcode, category: f.category, subcategory: f.subcategory,
      supplier: f.supplier, image_url: f.image_url, cost_price: Number(f.cost_price), selling_price: Number(f.selling_price), mrp: Number(f.mrp),
      stock: Number(f.stock), reorder_level: Number(f.reorder_level), safety_stock: Number(f.safety_stock),
      expiry_date: f.expiry_date || "", batch_number: f.batch_number, is_perishable: f.is_perishable === "true", reason: f.reason || undefined,
      pack_size: f.pack_size,
      // The API treats a negative value as "clear this attribute".
      shelf_life_days: optionalNumber(f.shelf_life_days), seasonal_sensitivity: optionalNumber(f.seasonal_sensitivity),
      festival_sensitivity: optionalNumber(f.festival_sensitivity), weather_sensitivity: optionalNumber(f.weather_sensitivity),
    } as ProductInput;
    setBusy(true);
    setServerError("");
    try {
      const saved = product ? await updateProduct(storeId, product.id, body) : await createProduct(storeId, body);
      toast(product ? "Product updated" : "Product created");
      onSaved(saved);
    } catch (err) {
      setServerError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const input = (k: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input className="input" value={f[k]} onChange={set(k)} aria-invalid={!!errors[k]} {...props} />
  );

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="SKU *" error={errors.sku}>{input("sku")}</Field>
        <Field label="Barcode" error={errors.barcode} hint="EAN/UPC check digit is verified">{input("barcode", { inputMode: "numeric" })}</Field>
        <Field label="Name *" error={errors.name}>{input("name")}</Field>
        <Field label="Brand">{input("brand")}</Field>
        <Field label="Category" hint="Pick or type a new one">{input("category", { list: "cat-list" })}<datalist id="cat-list">{categories.map((c) => <option key={c} value={c} />)}</datalist></Field>
        <Field label="Subcategory">{input("subcategory")}</Field>
        <Field label="Supplier">{input("supplier")}</Field>
        <Field label="Image URL">{input("image_url", { type: "url" })}</Field>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Cost price (₹) *" error={errors.cost_price}>{input("cost_price", { inputMode: "decimal" })}</Field>
        <Field label="Selling price (₹) *" error={errors.selling_price}>{input("selling_price", { inputMode: "decimal" })}</Field>
        <Field label="MRP (₹) *" error={errors.mrp}>{input("mrp", { inputMode: "decimal" })}</Field>
        <Field label="Stock" error={errors.stock}>{input("stock", { inputMode: "numeric" })}</Field>
        <Field label="Reorder level" error={errors.reorder_level} hint="0 = use the computed reorder point">{input("reorder_level", { inputMode: "numeric" })}</Field>
        <Field label="Safety stock" error={errors.safety_stock} hint="0 = use the computed value">{input("safety_stock", { inputMode: "numeric" })}</Field>
        <Field label="Expiry date" error={errors.expiry_date}>{input("expiry_date", { type: "date" })}</Field>
        <Field label="Batch number">{input("batch_number")}</Field>
        <Field label="Perishable" hint="Fresh produce, dairy and other short-life items">
          <select className="select" value={f.is_perishable} onChange={set("is_perishable")}><option value="false">No</option><option value="true">Yes</option></select>
        </Field>
        <Field label="Pack size">{input("pack_size", { placeholder: "e.g. 500 g" })}</Field>
        <Field label="Shelf life (days)" error={errors.shelf_life_days} hint="Life of a fresh batch">{input("shelf_life_days", { inputMode: "numeric" })}</Field>
      </div>
      <fieldset className="rounded-xl border border-slate-200 p-3">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Demand sensitivity (0 = none, 1 = strong, blank = not assessed)</legend>
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Seasonal" error={errors.seasonal_sensitivity}>{input("seasonal_sensitivity", { inputMode: "decimal", placeholder: "0–1" })}</Field>
          <Field label="Festival" error={errors.festival_sensitivity}>{input("festival_sensitivity", { inputMode: "decimal", placeholder: "0–1" })}</Field>
          <Field label="Weather" error={errors.weather_sensitivity}>{input("weather_sensitivity", { inputMode: "decimal", placeholder: "0–1" })}</Field>
        </div>
        <p className="mt-2 text-xs text-slate-500">These scale category- and store-wide seasonal considerations for this product (Seasonal page).</p>
      </fieldset>
      {product && <Field label="Reason for change" hint="Recorded in the audit log and price history">{input("reason")}</Field>}
      {serverError && <Notice tone="danger">{serverError}</Notice>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={busy}>{busy && <Spinner />}{product ? "Save changes" : "Create product"}</button>
      </div>
    </form>
  );
}
