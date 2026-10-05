"use client";

/** /settings — pricing mode & business rules, profile, members and stores. */

import { useState } from "react";
import { Settings, Trash2, UserPlus } from "lucide-react";
import {
  addMember, changeMemberRole, createStore, errorMessage, getMembers, getModels, getSettings, removeMember, Role, saveSettings, StoreSettings, updateMe,
} from "@/lib/api";
import { useApp } from "@/components/providers/AppProvider";
import { Card, ErrorState, Field, Notice, PageHeader, Pill, SkeletonRows, Spinner, Tabs, useAsync } from "@/components/ui/kit";

type Tab = "pricing" | "profile" | "team" | "system";
const ROLES: Role[] = ["VIEWER", "ANALYST", "STORE_MANAGER", "ADMIN"];

export default function SettingsPage() {
  const { can } = useApp();
  const [tab, setTab] = useState<Tab>("pricing");
  return (
    <>
      <PageHeader title="Settings" icon={Settings} />
      <div className="mb-6"><Tabs<Tab> tabs={[{ id: "pricing", label: "Pricing & rules" }, { id: "profile", label: "My profile" }, ...(can("ADMIN") ? [{ id: "team" as Tab, label: "Team & stores" }] : []), { id: "system", label: "Models & system" }]} value={tab} onChange={setTab} /></div>
      {tab === "pricing" && <PricingSettings />}
      {tab === "profile" && <Profile />}
      {tab === "team" && <Team />}
      {tab === "system" && <System />}
    </>
  );
}

function PricingSettings() {
  const { storeId } = useApp();
  const s = useAsync(() => getSettings(storeId), [storeId]);
  if (s.error) return <ErrorState message={s.error} onRetry={s.reload} />;
  if (!s.data) return <SkeletonRows rows={8} cols={3} />;
  return <PricingSettingsForm key={s.data.updated_at} initial={s.data} />;
}

function PricingSettingsForm({ initial }: { initial: StoreSettings }) {
  const { storeId, can, toast } = useApp();
  const [f, setF] = useState<StoreSettings>(initial);
  const [rules, setRules] = useState(() => JSON.stringify(initial.rules ?? {}, null, 2));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const admin = can("ADMIN");

  const pctField = (k: keyof StoreSettings, label: string, hint?: string) => (
    <Field label={label} hint={hint}><div className="flex items-center gap-2"><input className="input" disabled={!admin} inputMode="decimal"
      value={Math.round(Number(f[k]) * 1000) / 10} onChange={(e) => setF({ ...f, [k]: Number(e.target.value) / 100 })} /><span className="text-sm text-slate-500">%</span></div></Field>
  );
  const intField = (k: keyof StoreSettings, label: string, hint?: string) => (
    <Field label={label} hint={hint}><input className="input" disabled={!admin} inputMode="numeric" value={Number(f[k])} onChange={(e) => setF({ ...f, [k]: Number(e.target.value) || 0 })} /></Field>
  );

  async function save() {
    setError("");
    let parsed: Record<string, unknown>;
    try { parsed = rules.trim() ? JSON.parse(rules) : {}; } catch { return setError("Business rules must be valid JSON"); }
    setBusy(true);
    try {
      const out = await saveSettings(storeId, { ...f, rules: parsed, reason });
      setF(out);
      setReason("");
      toast("Settings saved — changes are recorded in the audit log");
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-6">
      {!admin && <Notice>Only admins can change these settings.</Notice>}
      <Card title="Pricing mode">
        <div className="grid gap-3 md:grid-cols-3">
          {([["MANUAL", "Manual", "AI recommends; a store manager applies."], ["SEMI_AUTOMATIC", "Semi-automatic", "AI recommends; manager approval is required before applying."],
            ["AUTOMATIC", "Automatic", "Low-risk changes (within the approval threshold) are applied by the system after constraint checks; larger ones need approval."]] as const).map(([v, t, d]) => (
            <label key={v} className={`cursor-pointer rounded-xl border p-4 ${f.pricing_mode === v ? "border-violet-400 bg-violet-50" : "border-slate-200"}`}>
              <input type="radio" name="mode" className="mr-2" disabled={!admin} checked={f.pricing_mode === v} onChange={() => setF({ ...f, pricing_mode: v })} />
              <span className="font-semibold text-slate-800">{t}</span><p className="mt-1 text-xs text-slate-500">{d}</p>
            </label>))}
        </div>
      </Card>
      <Card title="Constraints" subtitle="Every AI price is checked against these before it is stored and again when it is applied. Margin = (price − cost) ÷ price.">
        <div className="grid gap-4 md:grid-cols-3">
          {pctField("min_margin_pct", "Minimum margin")}
          {pctField("max_price_change_pct", "Maximum price change per update")}
          {pctField("approval_threshold_pct", "Approval threshold (automatic mode)", "Changes above this always need a manager")}
          {intField("expiry_markdown_days", "Expiry markdown window (days)")}
          {pctField("max_expiry_markdown_pct", "Maximum expiry markdown")}
          <Field label="Below-cost clearance of expiring stock">
            <select className="select" disabled={!admin} value={String(f.allow_below_cost_clearance)} onChange={(e) => setF({ ...f, allow_below_cost_clearance: e.target.value === "true" })}>
              <option value="false">Not allowed (floor = cost)</option><option value="true">Allowed</option></select></Field>
        </div>
      </Card>
      <Card title="Inventory & alert thresholds">
        <div className="grid gap-4 md:grid-cols-4">
          {intField("low_stock_cover_days", "Low stock below (days of cover)")}
          {intField("overstock_cover_days", "Overstock above (days of cover)")}
          {intField("dead_stock_days", "Dead stock after (days without sales)")}
          {pctField("competitor_undercut_pct", "Competitor undercut alert above")}
        </div>
      </Card>
      <Card title="Business rules (JSON)" subtitle='Optional: round_to, min_price, max_price, category_min_margin {"Dairy": 0.12}, freeze_categories ["Grocery"]'>
        <textarea className="input min-h-32 font-mono text-xs" disabled={!admin} value={rules} onChange={(e) => setRules(e.target.value)} aria-label="Business rules JSON" />
      </Card>
      {admin && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-64 flex-1"><Field label="Reason for change (audit log)"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field></div>
          <button className="btn-primary" onClick={save} disabled={busy}>{busy && <Spinner />}Save settings</button>
        </div>
      )}
      {error && <Notice tone="danger">{error}</Notice>}
    </div>
  );
}

function Profile() {
  const { me, refreshMe, toast } = useApp();
  const [name, setName] = useState(me?.profile.full_name ?? "");
  const [phone, setPhone] = useState(me?.profile.phone ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <Card title="My profile">
      <div className="grid max-w-xl gap-4">
        <Field label="E-mail"><input className="input" disabled value={me?.profile.email ?? ""} /></Field>
        <Field label="Full name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Phone"><input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        <div><button className="btn-primary" disabled={busy} onClick={async () => { setBusy(true); try { await updateMe({ full_name: name, phone }); await refreshMe(); toast("Profile saved"); } finally { setBusy(false); } }}>{busy && <Spinner />}Save</button></div>
        <div>
          <p className="text-sm font-semibold text-slate-700">Store access</p>
          <ul className="mt-1 text-sm text-slate-600">{me?.stores.map((s) => <li key={s.store_id}>{s.organization_name} · {s.store_name} — <Pill tone="violet">{s.role}</Pill></li>)}</ul>
        </div>
      </div>
    </Card>
  );
}

function Team() {
  const { store, me, toast, toastError, confirm, refreshMe } = useApp();
  const org = store!.organization_id;
  const members = useAsync(() => getMembers(org), [org]);
  const orgStores = me?.stores.filter((s) => s.organization_id === org) ?? [];
  const [m, setM] = useState({ email: "", role: "VIEWER" as Role, store_id: "" });
  const [st, setSt] = useState({ name: "", city: "", state: "", pincode: "" });

  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <Card title={`Members of ${store?.organization_name}`} className="xl:col-span-2">
        {members.error ? <ErrorState message={members.error} /> : !members.data ? <SkeletonRows rows={5} cols={4} /> : (
          <div className="table-wrap"><table className="data-table">
            <thead><tr><th>User</th><th>Scope</th><th>Role</th><th /></tr></thead>
            <tbody>{members.data.map((x) => (
              <tr key={x.membership_id}>
                <td><p className="font-medium">{x.full_name ?? x.email}</p><p className="text-xs text-slate-400">{x.email}</p></td>
                <td>{x.store_name ?? "All stores"}</td>
                <td><select className="select !w-auto !py-1" value={x.role} onChange={async (e) => {
                  try { await changeMemberRole(org, x.membership_id, e.target.value as Role); toast("Role updated"); members.reload(); } catch (err) { toastError(err); }
                }}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select></td>
                <td className="text-right"><button className="btn-ghost !text-red-600" aria-label="Remove member" onClick={async () => {
                  const r = await confirm({ title: `Remove ${x.email}?`, message: "They lose access to this scope immediately.", danger: true, confirmLabel: "Remove" });
                  if (r.ok) { try { await removeMember(org, x.membership_id); members.reload(); } catch (err) { toastError(err); } }
                }}><Trash2 size={14} /></button></td>
              </tr>))}</tbody>
          </table></div>
        )}
      </Card>
      <div className="space-y-6">
        <Card title="Add member" subtitle="The user must have signed up already">
          <div className="space-y-3">
            <Field label="E-mail"><input className="input" value={m.email} onChange={(e) => setM({ ...m, email: e.target.value })} /></Field>
            <Field label="Role"><select className="select" value={m.role} onChange={(e) => setM({ ...m, role: e.target.value as Role })}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select></Field>
            <Field label="Scope"><select className="select" value={m.store_id} onChange={(e) => setM({ ...m, store_id: e.target.value })}>
              <option value="">All stores in the organization</option>{orgStores.map((s) => <option key={s.store_id} value={s.store_id}>{s.store_name}</option>)}</select></Field>
            <button className="btn-primary" onClick={async () => {
              try { await addMember(org, { email: m.email.trim(), role: m.role, store_id: m.store_id || null }); toast("Member added"); setM({ ...m, email: "" }); members.reload(); } catch (err) { toastError(err); }
            }}><UserPlus size={15} /> Add</button>
          </div>
        </Card>
        <Card title="Add store">
          <div className="space-y-3">
            <Field label="Store name"><input className="input" value={st.name} onChange={(e) => setSt({ ...st, name: e.target.value })} /></Field>
            <div className="grid grid-cols-3 gap-2">
              <Field label="City"><input className="input" value={st.city} onChange={(e) => setSt({ ...st, city: e.target.value })} /></Field>
              <Field label="State"><input className="input" value={st.state} onChange={(e) => setSt({ ...st, state: e.target.value })} /></Field>
              <Field label="Pincode"><input className="input" value={st.pincode} onChange={(e) => setSt({ ...st, pincode: e.target.value })} /></Field>
            </div>
            <button className="btn-primary" disabled={!st.name.trim()} onClick={async () => {
              try { await createStore(org, { name: st.name.trim(), city: st.city || undefined, state: st.state || undefined, pincode: st.pincode || undefined }); toast("Store created"); setSt({ name: "", city: "", state: "", pincode: "" }); await refreshMe(); } catch (err) { toastError(err); }
            }}>Create store</button>
          </div>
        </Card>
      </div>
    </div>
  );
}

function System() {
  const info = useAsync(() => getModels(), []);
  if (info.error) return <ErrorState message={info.error} onRetry={info.reload} />;
  if (!info.data) return <SkeletonRows rows={6} cols={3} />;
  const d = info.data as { active_policy: string; validated: boolean; training: { data: string; range: string[] | null; trained_at: string | null } | null; copilot: { mode: string; provider: string | null; model: string | null; reason: string | null }; registry: { name: string; version: string; algorithm: string; training_data: string; is_active: boolean; notes: string | null; metrics: Record<string, any> }[] }; // eslint-disable-line @typescript-eslint/no-explicit-any
  return (
    <div className="space-y-6">
      <Card title="AI configuration">
        <ul className="space-y-1 text-sm text-slate-700">
          <li>Pricing policy: <b>{d.active_policy}</b></li>
          <li>Demand model beats the naive 28-day baseline on a time-based holdout: <b>{d.validated ? "yes" : "no"}</b></li>
          <li>Training data: <b>{d.training ? `${d.training.data}${d.training.range ? ` · ${d.training.range[0]} → ${d.training.range[1]}` : ""}` : "no model trained — run python -m app.ml.training.train_demand"}</b></li>
          <li>Retail Copilot: <b>{d.copilot.mode === "llm" ? `LLM (${d.copilot.provider} · ${d.copilot.model})` : `rule-based — ${d.copilot.reason ?? "no LLM configured"}`}</b></li>
        </ul>
      </Card>
      <Card title="Model registry">
        <div className="table-wrap"><table className="data-table">
          <thead><tr><th>Model</th><th>Algorithm</th><th>Training data</th><th>Holdout MAE</th><th>Holdout R²</th><th>Status</th></tr></thead>
          <tbody>{d.registry.map((m) => {
            const met = m.metrics?.v2 ?? {};
            return (<tr key={m.name + m.version}><td>{m.name}:{m.version}</td><td className="text-xs">{m.algorithm}</td><td><Pill tone={m.training_data === "SYNTHETIC" ? "amber" : "green"}>{m.training_data}</Pill></td>
              <td className="num">{met.mae ?? "—"}</td><td className="num">{met.r2 ?? "—"}</td><td>{m.is_active ? <Pill tone="green">active</Pill> : <Pill>inactive</Pill>}</td></tr>);
          })}</tbody>
        </table></div>
        <p className="mt-2 text-xs text-slate-500">Metrics are from a time-based holdout (the last 30 days of the training data, never seen during fitting). A model trained on SYNTHETIC data has only learned the simulation — retrain on a store&apos;s real history before relying on it.</p>
      </Card>
    </div>
  );
}
