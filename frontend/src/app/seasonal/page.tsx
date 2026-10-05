"use client";

/**
 * /seasonal — seasonal intelligence in three layers:
 *   1. Seasonal considerations: planning assumptions entered by store staff
 *      (season / festival / event / weather, scope, dates, expected demand
 *      change, supply condition). The AI service applies the active ones as a
 *      labelled MANUAL adjustment when it evaluates prices, forecasts and
 *      expiry markdowns; the pricing constraint engine still bounds the result.
 *   2. Measured effects: festival / season / weekday effects found in the
 *      sales history (statistical evidence only).
 *   3. Context: festival calendar and weather outlook.
 */

import { useMemo, useState } from "react";
import { CalendarPlus, CloudRain, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import {
  Consideration, ConsiderationInput, ConsiderationKind, createConsideration, createSeasonalEvent, dateFmt, deleteConsideration, errorMessage,
  getCategories, getConsiderations, getProducts, getSeasonalEvents, getSeasonalInsights, getWeather, pct, SeasonalEvent, SensitivityLevel,
  SupplyCondition, updateConsideration,
} from "@/lib/api";
import { useApp } from "@/components/providers/AppProvider";
import { Card, DataStatusBadge, EmptyState, ErrorState, Field, Modal, Notice, PageHeader, Pill, RoleGate, SkeletonRows, Spinner, useAsync } from "@/components/ui/kit";

/** Quick-fill presets. `event` matches a festival in the calendar so its next dates can be filled in. */
const PRESETS: { label: string; kind: ConsiderationKind; event?: string; months?: [number, number] }[] = [
  { label: "Summer", kind: "SEASON", months: [3, 5] }, { label: "Monsoon", kind: "SEASON", months: [6, 9] }, { label: "Winter", kind: "SEASON", months: [12, 2] },
  { label: "Harvest season", kind: "SEASON" }, { label: "Off-season", kind: "SEASON" },
  { label: "Diwali", kind: "FESTIVAL", event: "Diwali" }, { label: "Holi", kind: "FESTIVAL", event: "Holi" }, { label: "Eid", kind: "FESTIVAL", event: "Eid al-Fitr" },
  { label: "Christmas", kind: "FESTIVAL", event: "Christmas" }, { label: "New Year", kind: "FESTIVAL", event: "New Year" }, { label: "Pongal", kind: "FESTIVAL", event: "Pongal" },
  { label: "Onam", kind: "FESTIVAL", event: "Onam" }, { label: "Navratri", kind: "FESTIVAL", event: "Navratri" }, { label: "Raksha Bandhan", kind: "FESTIVAL", event: "Raksha Bandhan" },
  { label: "Heatwave", kind: "WEATHER" }, { label: "Heavy rain", kind: "WEATHER" },
];
const KIND_LABEL: Record<ConsiderationKind, string> = { SEASON: "Season", FESTIVAL: "Festival", EVENT: "Local event", WEATHER: "Weather" };
const SUPPLY_LABEL: Record<SupplyCondition, string> = { NORMAL: "Normal", SURPLUS: "Surplus (plenty of stock available)", LIMITED: "Limited", SHORTAGE: "Shortage (do not discount)" };
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export default function SeasonalPage() {
  const { storeId, confirm, toast, toastError, can } = useApp();
  const ins = useAsync(() => getSeasonalInsights(storeId), [storeId]);
  const events = useAsync(() => getSeasonalEvents(storeId), [storeId]);
  const weather = useAsync(() => getWeather(storeId), [storeId]);
  const [showEnded, setShowEnded] = useState(false);
  const cons = useAsync(() => getConsiderations(storeId, showEnded), [storeId, showEnded]);
  const [addingEvent, setAddingEvent] = useState(false);
  const [editing, setEditing] = useState<Consideration | null | undefined>(undefined);   // undefined = closed, null = new
  const i = ins.data;

  async function remove(c: Consideration) {
    const r = await confirm({ title: `Delete "${c.name}"?`, message: "Pricing, forecasts and expiry markdowns will stop using this consideration.", danger: true, confirmLabel: "Delete" });
    if (!r.ok) return;
    try { await deleteConsideration(storeId, c.id); toast("Consideration deleted"); cons.reload(); } catch (e) { toastError(e); }
  }

  return (
    <>
      <PageHeader title="Seasonal intelligence" icon={Sparkles} subtitle="Your seasonal considerations, the effects measured in your sales history, the festival calendar and the weather outlook"
        actions={<RoleGate min="STORE_MANAGER">
          <button className="btn-secondary" onClick={() => setAddingEvent(true)}><CalendarPlus size={15} /> Calendar event</button>
          <button className="btn-primary" onClick={() => setEditing(null)}><Plus size={15} /> Add consideration</button>
        </RoleGate>} />

      <Card title="Seasonal considerations" subtitle="Planning assumptions entered by your team. Active ones adjust the demand forecast used for price recommendations, simulations and expiry markdowns — always shown as a MANUAL assumption, and every price still has to pass the pricing rules."
        actions={<label className="flex items-center gap-2 text-xs text-slate-500"><input type="checkbox" checked={showEnded} onChange={(e) => setShowEnded(e.target.checked)} /> Show all ended</label>}>
        {cons.error ? <ErrorState message={cons.error} onRetry={cons.reload} /> : !cons.data ? <SkeletonRows rows={3} cols={6} /> : cons.data.length === 0 ? (
          <EmptyState title="No seasonal considerations yet" icon={Sparkles}
            message={can("STORE_MANAGER") ? "Tell PriceIQ what you expect — for example “Diwali: Snacks +40%, supply limited” or “Summer: Beverages +20%”." : "A store manager can add expected demand changes for seasons, festivals, events and weather."}
            action={<RoleGate min="STORE_MANAGER"><button className="btn-primary" onClick={() => setEditing(null)}><Plus size={15} /> Add consideration</button></RoleGate>} />
        ) : (
          <div className="table-wrap"><table className="data-table">
            <thead><tr><th>Consideration</th><th>Applies to</th><th>Dates</th><th className="text-right">Expected demand</th><th>Supply</th><th>Status</th><th /></tr></thead>
            <tbody>{cons.data.map((c) => (
              <tr key={c.id} className={c.is_active && c.phase !== "ENDED" ? "" : "opacity-60"}>
                <td className="min-w-[180px]"><span className="font-medium text-slate-800">{c.name}</span>
                  <div className="mt-0.5 flex flex-wrap gap-1"><Pill tone="violet">{KIND_LABEL[c.kind]}</Pill>
                    {c.festival_sensitivity && <Pill title="Festival sensitivity used when a product has none recorded">festival {c.festival_sensitivity.toLowerCase()}</Pill>}
                    {c.weather_sensitivity && <Pill title="Weather sensitivity used when a product has none recorded">weather {c.weather_sensitivity.toLowerCase()}</Pill>}</div>
                  {c.notes && <p className="mt-1 max-w-xs text-xs text-slate-500">{c.notes}</p>}</td>
                <td className="text-sm">{c.scope === "PRODUCT" ? c.product_name : c.scope === "CATEGORY" ? <>Category: <b>{c.category_name}</b></> : "Whole store"}</td>
                <td className="whitespace-nowrap text-xs">{dateFmt(c.start_date)} – {dateFmt(c.end_date)}</td>
                <td className={`num text-right font-semibold ${c.expected_demand_change_pct > 0 ? "text-emerald-700" : c.expected_demand_change_pct < 0 ? "text-red-700" : ""}`}>{pct(c.expected_demand_change_pct, 0, true)}</td>
                <td><Pill tone={c.supply_condition === "SHORTAGE" ? "red" : c.supply_condition === "LIMITED" ? "amber" : c.supply_condition === "SURPLUS" ? "sky" : "slate"}>{c.supply_condition.toLowerCase()}</Pill></td>
                <td>{!c.is_active ? <Pill>paused</Pill> : c.phase === "ACTIVE" ? <Pill tone="green">active now</Pill> : c.phase === "UPCOMING" ? <Pill tone="sky">in {c.days_until} d</Pill> : <Pill>ended</Pill>}</td>
                <td className="whitespace-nowrap text-right"><RoleGate min="STORE_MANAGER">
                  <button className="btn-ghost" aria-label={`Edit ${c.name}`} onClick={() => setEditing(c)}><Pencil size={14} /></button>
                  <button className="btn-ghost !text-red-600" aria-label={`Delete ${c.name}`} onClick={() => remove(c)}><Trash2 size={14} /></button>
                </RoleGate></td>
              </tr>))}</tbody>
          </table></div>
        )}
        <p className="mt-2 text-xs text-slate-500">Category- and store-wide considerations are scaled by each product&apos;s own seasonal / festival / weather sensitivity (set on the product). A supply <b>shortage</b> stops discount recommendations for the affected products.</p>
      </Card>

      <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">Measured from your sales history</h2>
      {ins.error ? <ErrorState message={ins.error} onRetry={ins.reload} /> : !i ? <SkeletonRows rows={6} cols={3} /> : !i.available ? <EmptyState title="Not enough history" message={i.reason} /> : (
        <>
          <Notice>History analysed: {dateFmt(i.history.from)} → {dateFmt(i.history.to)} ({i.history.days} days{i.history.data_mode === "SYNTHETIC" ? ", Synthetic/Training Data" : ""}). {i.method}. Nothing here is assumed without evidence.</Notice>
          <div className="mt-5 grid gap-6 xl:grid-cols-3">
            <Card title="Upcoming events (next 120 days)" className="xl:col-span-2">
              {i.upcoming.length === 0 ? <EmptyState title="No festivals in the next 120 days" /> : (
                <ul className="divide-y divide-slate-100">{i.upcoming.map((u: any) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
                  <li key={u.name + u.start_date} className="flex flex-wrap items-start justify-between gap-3 py-3">
                    <div><p className="font-medium text-slate-800">{u.name} {u.is_date_approximate && <Pill tone="amber">date approximate</Pill>}</p>
                      <p className="text-xs text-slate-500">{dateFmt(u.start_date)} – {dateFmt(u.end_date)} · {u.days_until > 0 ? `in ${u.days_until} day(s)` : "under way"}</p>
                      <p className="mt-1 text-sm text-slate-600">{u.guidance}</p></div>
                    <Pill tone={u.evidence === "SIGNIFICANT" ? "green" : u.evidence === "NOT_SIGNIFICANT" ? "amber" : "slate"}>{u.evidence.replace(/_/g, " ").toLowerCase()}</Pill>
                  </li>))}</ul>
              )}
            </Card>
            <Card title="Weekend effect">
              <p className="text-3xl font-bold text-slate-800">{pct(i.weekend_effect.uplift_pct, 1, true)}</p>
              <p className="text-sm text-slate-600">weekend vs weekday daily units</p>
              <p className="mt-2"><Pill tone={i.weekend_effect.status === "SIGNIFICANT" ? "green" : "amber"}>{i.weekend_effect.status.replace(/_/g, " ").toLowerCase()}</Pill> <span className="text-xs text-slate-500">p {i.weekend_effect.p_value === 0 ? "< 0.0001" : `= ${i.weekend_effect.p_value}`}</span></p>
            </Card>
          </div>
          <div className="mt-6 grid gap-6 xl:grid-cols-2">
            <Card title="Festival effects observed in history" subtitle="Each event compared with the 28 days before it">
              {i.occurrences.length === 0 ? <EmptyState title="No festival falls inside the sales history" /> : (
                <div className="table-wrap"><table className="data-table">
                  <thead><tr><th>Event</th><th>Window</th><th className="text-right">Uplift</th><th className="text-right">p-value</th><th>Evidence</th></tr></thead>
                  <tbody>{i.occurrences.map((o: any) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
                    <tr key={o.name + o.start_date}><td>{o.name}</td><td className="text-xs">{dateFmt(o.start_date)} ({o.window_days} d)</td><td className="num text-right">{pct(o.uplift_pct, 1, true)}</td>
                      <td className="num text-right">{o.p_value === 0 ? "< 0.0001" : o.p_value ?? "—"}</td><td><Pill tone={o.significant ? "green" : "amber"}>{o.significant ? "significant" : "not significant"}</Pill></td></tr>))}</tbody>
                </table></div>
              )}
              <p className="mt-2 text-xs text-slate-500">A single occurrence is never treated as high-confidence evidence. To act on an expected effect, add it above as a seasonal consideration.</p>
            </Card>
            <Card title="Climatic seasons">
              <div className="table-wrap"><table className="data-table">
                <thead><tr><th>Season</th><th className="text-right">Days in history</th><th className="text-right">Avg units/day</th><th className="text-right">vs rest</th><th>Evidence</th></tr></thead>
                <tbody>{i.seasons.map((s: any) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
                  <tr key={s.season}><td>{s.season}</td><td className="num text-right">{s.days_in_history}</td><td className="num text-right">{s.avg_daily_units ?? "—"}</td>
                    <td className="num text-right">{pct(s.uplift_vs_rest_pct ?? null, 1, true)}</td><td><Pill tone={s.status === "SIGNIFICANT" ? "green" : s.status === "NO_HISTORY" ? "slate" : "amber"}>{s.status.replace(/_/g, " ").toLowerCase()}</Pill></td></tr>))}</tbody>
              </table></div>
            </Card>
          </div>
        </>
      )}

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card title="Weather outlook" subtitle={weather.data?.source ? `${weather.data.source}${weather.data.location?.city ? ` · ${weather.data.location.city}` : ""}` : undefined}
          actions={weather.data && <DataStatusBadge status={weather.data.status} />}>
          {weather.error ? <ErrorState message={weather.error} onRetry={weather.reload} /> : !weather.data ? <SkeletonRows rows={4} cols={4} /> : weather.data.days.length === 0 ? <EmptyState title="Weather unavailable" message={weather.data.error} icon={CloudRain} /> : (
            <>
              <div className="grid grid-cols-4 gap-2 md:grid-cols-7">{weather.data.days.map((d) => (
                <div key={d.date} className="rounded-xl border border-slate-100 p-2 text-center text-xs">
                  <p className="font-semibold text-slate-700">{new Date(d.date).toLocaleDateString("en-IN", { weekday: "short", day: "numeric" })}</p>
                  <p className="mt-1 break-words text-slate-600">{d.summary}</p><p className="mt-1 font-semibold">{Math.round(d.t_max)}° / {Math.round(d.t_min)}°</p>
                  <p className="text-slate-500">{d.precipitation_mm} mm{d.precipitation_probability !== null ? ` · ${d.precipitation_probability}%` : ""}</p>
                </div>))}</div>
              <p className="mt-2 text-xs text-slate-500">{weather.data.note} To act on this forecast, add a <b>Weather</b> consideration for the affected products.</p>
            </>
          )}
        </Card>
        <Card title="Festival calendar" subtitle="National calendar plus your own events">
          {events.error ? <ErrorState message={events.error} onRetry={events.reload} /> : !events.data ? <SkeletonRows rows={5} cols={3} /> : (
            <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto text-sm">{events.data.filter((e) => e.event_type !== "SEASON").map((e) => (
              <li key={e.id} className="flex justify-between gap-3 py-2"><span>{e.name} {e.custom && <Pill tone="violet">custom</Pill>} {e.is_date_approximate && <Pill tone="amber" title="Lunar-calendar date — confirm against the official holiday list">approx.</Pill>}</span>
                <span className="whitespace-nowrap text-xs text-slate-500">{dateFmt(e.start_date)} – {dateFmt(e.end_date)}</span></li>))}</ul>
          )}
        </Card>
      </div>

      <EventModal open={addingEvent} onClose={() => setAddingEvent(false)} onSaved={() => { setAddingEvent(false); events.reload(); ins.reload(); }} />
      {editing !== undefined && (
        <ConsiderationModal existing={editing} events={events.data ?? []} onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); cons.reload(); }} />
      )}
    </>
  );
}

type Scope = "STORE" | "CATEGORY" | "PRODUCT";

function ConsiderationModal({ existing, events, onClose, onSaved }: { existing: Consideration | null; events: SeasonalEvent[]; onClose: () => void; onSaved: () => void }) {
  const { storeId, toast } = useApp();
  const cats = useAsync(() => getCategories(storeId), [storeId]);
  const products = useAsync(() => getProducts(storeId, { page_size: 200, sort: "name" }), [storeId]);
  const [f, setF] = useState(() => ({
    name: existing?.name ?? "", kind: (existing?.kind ?? "FESTIVAL") as ConsiderationKind, scope: (existing?.scope ?? "CATEGORY") as Scope,
    category_id: existing?.category_id ?? "", product_id: existing?.product_id ?? "", start_date: existing?.start_date ?? "", end_date: existing?.end_date ?? "",
    change: existing ? String(existing.expected_demand_change_pct) : "", supply: (existing?.supply_condition ?? "NORMAL") as SupplyCondition,
    weather: (existing?.weather_sensitivity ?? "") as SensitivityLevel | "", festival: (existing?.festival_sensitivity ?? "") as SensitivityLevel | "",
    notes: existing?.notes ?? "", is_active: existing?.is_active ?? true,
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const upcoming = useMemo(() => events.filter((e) => e.days_until >= -7), [events]);

  function applyPreset(label: string) {
    const p = PRESETS.find((x) => x.label === label);
    if (!p) return;
    const patch: Partial<typeof f> = { name: p.label, kind: p.kind };
    const ev = p.event ? upcoming.find((e) => e.name === p.event) : undefined;
    if (ev) { patch.start_date = ev.start_date; patch.end_date = ev.end_date; patch.name = `${p.label} ${ev.end_date.slice(0, 4)}`; }
    if (p.months) {                                    // next occurrence of the season
      const now = new Date(); const [m1, m2] = p.months;
      let y = now.getFullYear();
      const endYear = (yy: number) => (m2 < m1 ? yy + 1 : yy);
      if (new Date(endYear(y), m2, 0) < now) y += 1;
      patch.start_date = iso(new Date(y, m1 - 1, 1)); patch.end_date = iso(new Date(endYear(y), m2, 0));
      patch.name = `${p.label} ${y}`;
    }
    setF({ ...f, ...patch });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const change = f.change === "" ? 0 : Number(f.change);
    if (!f.name.trim()) return setError("Give the consideration a name");
    if (!f.start_date || !f.end_date) return setError("Start and end dates are required");
    if (f.end_date < f.start_date) return setError("End date must be on or after the start date");
    if (Number.isNaN(change) || change < -90 || change > 300) return setError("Expected demand change must be between −90% and +300%");
    if (change === 0 && f.supply === "NORMAL") return setError("Enter an expected demand change or a supply condition — otherwise the consideration has no effect");
    if (f.scope === "CATEGORY" && !f.category_id) return setError("Choose a category");
    if (f.scope === "PRODUCT" && !f.product_id) return setError("Choose a product");
    const body: ConsiderationInput = {
      name: f.name.trim(), kind: f.kind, start_date: f.start_date, end_date: f.end_date, expected_demand_change_pct: change, supply_condition: f.supply,
      category_id: f.scope === "CATEGORY" ? f.category_id : null, product_id: f.scope === "PRODUCT" ? f.product_id : null,
      weather_sensitivity: f.weather || null, festival_sensitivity: f.festival || null, notes: f.notes.trim(), is_active: f.is_active,
    };
    setBusy(true);
    setError("");
    try {
      if (existing) await updateConsideration(storeId, existing.id, body); else await createConsideration(storeId, body);
      toast(existing ? "Consideration updated" : "Consideration added");
      onSaved();
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }

  const level = (value: string, onChange: (v: SensitivityLevel | "") => void) => (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value as SensitivityLevel | "")}>
      <option value="">Not specified</option><option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option>
    </select>
  );

  return (
    <Modal open onClose={onClose} title={existing ? "Edit seasonal consideration" : "Add a seasonal consideration"} wide>
      <form onSubmit={save} className="space-y-4">
        {!existing && (
          <div>
            <p className="mb-1.5 text-xs font-medium text-slate-500">Start from a common season or festival (fills the name and, where known, the dates)</p>
            <div className="flex flex-wrap gap-1.5">{PRESETS.map((p) => (
              <button type="button" key={p.label} onClick={() => applyPreset(p.label)} className="rounded-full border border-slate-200 px-2.5 py-1 text-xs text-slate-700 hover:border-violet-300 hover:bg-violet-50">{p.label}</button>))}</div>
          </div>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Season, festival or event *"><input className="input" value={f.name} maxLength={120} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Diwali 2026, Mango season, Local temple fair" /></Field>
          <Field label="Type"><select className="select" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as ConsiderationKind })}>
            {(Object.keys(KIND_LABEL) as ConsiderationKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></Field>
          <Field label="Applies to"><select className="select" value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value as Scope })}>
            <option value="CATEGORY">A category</option><option value="PRODUCT">One product</option><option value="STORE">Whole store</option></select></Field>
          {f.scope === "CATEGORY" && <Field label="Category *"><select className="select" value={f.category_id} onChange={(e) => setF({ ...f, category_id: e.target.value })}>
            <option value="">Choose…</option>{cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.products})</option>)}</select></Field>}
          {f.scope === "PRODUCT" && <Field label="Product *"><select className="select" value={f.product_id} onChange={(e) => setF({ ...f, product_id: e.target.value })}>
            <option value="">{products.data ? "Choose…" : "Loading…"}</option>{products.data?.data.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}</select></Field>}
          {f.scope === "STORE" && <Field label="Scope"><p className="pt-2 text-sm text-slate-600">Every product, scaled by its own sensitivity.</p></Field>}
          <Field label="Start date *"><input type="date" className="input" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} /></Field>
          <Field label="End date *"><input type="date" className="input" value={f.end_date} min={f.start_date || undefined} onChange={(e) => setF({ ...f, end_date: e.target.value })} /></Field>
          <Field label="Expected demand change (%)" hint="e.g. 25 for +25%, −15 for a drop. Leave empty for supply-only considerations."><input className="input" inputMode="decimal" value={f.change} onChange={(e) => setF({ ...f, change: e.target.value })} placeholder="0" /></Field>
          <Field label="Supply condition"><select className="select" value={f.supply} onChange={(e) => setF({ ...f, supply: e.target.value as SupplyCondition })}>
            {(Object.keys(SUPPLY_LABEL) as SupplyCondition[]).map((k) => <option key={k} value={k}>{SUPPLY_LABEL[k]}</option>)}</select></Field>
          <Field label="Festival sensitivity" hint="Used for products that have no festival sensitivity of their own">{level(f.festival, (v) => setF({ ...f, festival: v }))}</Field>
          <Field label="Weather sensitivity" hint="Used for products that have no weather sensitivity of their own">{level(f.weather, (v) => setF({ ...f, weather: v }))}</Field>
        </div>
        <Field label="Notes"><textarea className="input" rows={2} maxLength={1000} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Why you expect this — e.g. last year's sales, supplier warning, local event" /></Field>
        {existing && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.checked })} /> Active (uncheck to pause without deleting)</label>}
        <Notice>This is your assumption, not a measurement. PriceIQ multiplies its demand forecast by it for the selected products and dates and labels the result as a manual consideration. Recommended prices still stay within MRP, margin and price-change limits.</Notice>
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>{busy && <Spinner />}{existing ? "Save changes" : "Add consideration"}</button></div>
      </form>
    </Modal>
  );
}

function EventModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { storeId, toast } = useApp();
  const [f, setF] = useState({ name: "", start_date: "", end_date: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!f.name || !f.start_date || !f.end_date) return setError("Name and dates are required");
    if (f.end_date < f.start_date) return setError("End date must be on or after the start date");
    setBusy(true);
    setError("");
    try { await createSeasonalEvent(storeId, f); toast("Event added to the calendar"); setF({ name: "", start_date: "", end_date: "", notes: "" }); onSaved(); } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title="Add a calendar event">
      <form onSubmit={save} className="space-y-3">
        <Notice>Calendar events mark dates (e.g. a local festival) so the demand model and the history analysis can recognise them. To state an expected demand change, add a seasonal consideration instead.</Notice>
        <Field label="Name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Local temple festival" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start"><input type="date" className="input" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} /></Field>
          <Field label="End"><input type="date" className="input" value={f.end_date} min={f.start_date || undefined} onChange={(e) => setF({ ...f, end_date: e.target.value })} /></Field>
        </div>
        <Field label="Notes"><input className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>{busy && <Spinner />}Save</button></div>
      </form>
    </Modal>
  );
}
