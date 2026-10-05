"use client";

/**
 * components/ui/kit.tsx — shared building blocks for every page:
 * page header, cards, skeleton loaders, empty/error states, data-status and
 * severity badges (always icon + label, never colour alone), modal, tabs,
 * KPI tile and the useAsync data hook.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertOctagon, AlertTriangle, CheckCircle2, CircleDashed, Clock, Database, FlaskConical, Info, Inbox, Loader2,
  LucideIcon, RefreshCw, ShieldAlert, UserCheck, WifiOff, X,
} from "lucide-react";
import { errorMessage, DataStatus, Severity } from "@/lib/api";
import { useApp } from "@/components/providers/AppProvider";

// ── Data hook ────────────────────────────────────────────────────────────────

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[], enabled = true) {
  const key = JSON.stringify(deps);
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<{ key: string | null; data: T | null; error: string | null }>({ key: null, data: null, error: null });
  const fnRef = useRef(fn);
  useEffect(() => { fnRef.current = fn; });
  const current = `${key}#${nonce}`;
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    fnRef.current().then(
      (d) => { if (alive) setState({ key: current, data: d, error: null }); },
      (e) => { if (alive) setState({ key: current, data: null, error: errorMessage(e) }); },
    );
    return () => { alive = false; };
  }, [current, enabled]);
  const fresh = state.key === current;
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const setData = useCallback((d: T) => setState({ key: current, data: d, error: null }), [current]);
  return { data: fresh ? state.data : null, error: fresh ? state.error : null, loading: enabled && !fresh, reload, setData };
}

// ── Layout ───────────────────────────────────────────────────────────────────

export function PageHeader({ title, subtitle, icon: Icon, actions }: { title: string; subtitle?: string; icon?: LucideIcon; actions?: React.ReactNode }) {
  const { store } = useApp();
  return (
    <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="flex items-start gap-3">
        {Icon && (
          <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: "linear-gradient(135deg,#7c3aed1f,#22d3ee1f)", border: "1px solid #7c3aed26" }}>
            <Icon size={20} className="text-violet-600" />
          </div>
        )}
        <div>
          <h1 className="text-2xl font-bold text-slate-800">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
          {store?.data_mode === "SYNTHETIC" && (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 border border-amber-200">
              <FlaskConical size={12} /> Synthetic/Training Data — {store.store_name} holds a simulated demo dataset, not real sales
            </p>
          )}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, subtitle, actions, children, className = "" }: { title?: string; subtitle?: string; actions?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
          <div>
            {title && <h2 className="text-base font-semibold text-slate-800">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Tile({ label, value, sub, icon: Icon, tone = "violet", delta }: { label: string; value: React.ReactNode; sub?: React.ReactNode; icon?: LucideIcon; tone?: "violet" | "cyan" | "green" | "amber" | "red" | "slate"; delta?: number | null }) {
  const tones: Record<string, string> = { violet: "#7c3aed", cyan: "#0891b2", green: "#059669", amber: "#d97706", red: "#dc2626", slate: "#475569" };
  const c = tones[tone];
  return (
    <div className="stat-card">
      <div className="flex items-start justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
        {Icon && <Icon size={18} style={{ color: c }} aria-hidden />}
      </div>
      <p className="mt-2 text-2xl font-bold text-slate-800">{value}</p>
      <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
        {delta !== undefined && delta !== null && (
          <span className={delta >= 0 ? "font-semibold text-emerald-700" : "font-semibold text-red-700"}>
            {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}%
          </span>
        )}
        {sub}
      </div>
    </div>
  );
}

// ── States ───────────────────────────────────────────────────────────────────

export function Skeleton({ className = "h-4 w-full" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}

export function SkeletonRows({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {Array.from({ length: cols }).map((__, j) => <Skeleton key={j} className="h-5" />)}
        </div>
      ))}
    </div>
  );
}

export function SkeletonCards({ n = 4 }: { n?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: n }).map((_, i) => <div key={i} className="stat-card"><Skeleton className="h-3 w-24" /><Skeleton className="mt-3 h-7 w-28" /><Skeleton className="mt-2 h-3 w-20" /></div>)}
    </div>
  );
}

export function EmptyState({ title, message, icon: Icon = Inbox, action }: { title: string; message?: string; icon?: LucideIcon; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 px-6 py-10 text-center">
      <Icon size={28} className="text-slate-300" aria-hidden />
      <p className="mt-3 font-medium text-slate-700">{title}</p>
      {message && <p className="mt-1 max-w-md text-sm text-slate-500">{message}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4">
      <WifiOff size={18} className="mt-0.5 shrink-0 text-red-600" />
      <div className="flex-1">
        <p className="text-sm font-medium text-red-800">Couldn&apos;t load this data</p>
        <p className="mt-0.5 text-sm text-red-700">{message}</p>
      </div>
      {onRetry && <button onClick={onRetry} className="btn-secondary !py-1.5 text-xs"><RefreshCw size={12} /> Retry</button>}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warning" | "danger"; children: React.ReactNode }) {
  const map = { info: ["bg-violet-50 border-violet-200 text-violet-900", Info], warning: ["bg-amber-50 border-amber-200 text-amber-900", AlertTriangle], danger: ["bg-red-50 border-red-200 text-red-900", AlertOctagon] } as const;
  const [cls, Icon] = map[tone];
  return <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${cls}`}><Icon size={16} className="mt-0.5 shrink-0" /><div>{children}</div></div>;
}

export function Spinner({ size = 16 }: { size?: number }) {
  return <Loader2 size={size} className="animate-spin" aria-label="Loading" />;
}

// ── Badges ───────────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<DataStatus, { cls: string; icon: LucideIcon; tip: string }> = {
  LIVE: { cls: "bg-emerald-50 text-emerald-800 border-emerald-200", icon: CheckCircle2, tip: "Read from the platform within the last 6 hours" },
  MANUAL_VERIFIED: { cls: "bg-violet-50 text-violet-800 border-violet-200", icon: UserCheck, tip: "Looked up and recorded by a staff member within the last 24 hours" },
  CACHED: { cls: "bg-sky-50 text-sky-800 border-sky-200", icon: Clock, tip: "Older observation or served from cache — may be out of date" },
  ESTIMATED: { cls: "bg-amber-50 text-amber-800 border-amber-200", icon: CircleDashed, tip: "Modelled value, not observed" },
  UNAVAILABLE: { cls: "bg-slate-100 text-slate-600 border-slate-200", icon: WifiOff, tip: "Could not be read — no price shown" },
};

export function DataStatusBadge({ status, title }: { status: DataStatus; title?: string }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.UNAVAILABLE;
  const Icon = s.icon;
  return <span title={title ?? s.tip} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${s.cls}`}><Icon size={11} />{status.replace("_", " ")}</span>;
}

const SEV: Record<Severity, { cls: string; icon: LucideIcon }> = {
  CRITICAL: { cls: "bg-red-50 text-red-800 border-red-200", icon: AlertOctagon },
  HIGH: { cls: "bg-orange-50 text-orange-800 border-orange-200", icon: ShieldAlert },
  MEDIUM: { cls: "bg-amber-50 text-amber-800 border-amber-200", icon: AlertTriangle },
  LOW: { cls: "bg-slate-100 text-slate-700 border-slate-200", icon: Info },
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  const s = SEV[severity] ?? SEV.LOW;
  const Icon = s.icon;
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${s.cls}`}><Icon size={11} />{severity}</span>;
}

export function Pill({ children, tone = "slate", title }: { children: React.ReactNode; tone?: "slate" | "violet" | "green" | "amber" | "red" | "sky"; title?: string }) {
  const map = { slate: "bg-slate-100 text-slate-700 border-slate-200", violet: "bg-violet-50 text-violet-800 border-violet-200", green: "bg-emerald-50 text-emerald-800 border-emerald-200",
    amber: "bg-amber-50 text-amber-800 border-amber-200", red: "bg-red-50 text-red-800 border-red-200", sky: "bg-sky-50 text-sky-800 border-sky-200" };
  return <span title={title} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${map[tone]}`}>{children}</span>;
}

export function SyntheticBadge() {
  return <Pill tone="amber" title="Derived from the synthetic training dataset"><Database size={10} /> Synthetic</Pill>;
}

// ── Modal & tabs ─────────────────────────────────────────────────────────────

export function Modal({ open, title, onClose, children, wide = false }: { open: boolean; title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 md:p-10" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`w-full ${wide ? "max-w-4xl" : "max-w-xl"} rounded-2xl bg-white shadow-xl`}>
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-800">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"><X size={18} /></button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="tablist" className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${value === t.id ? "bg-violet-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, children, hint, error }: { label: string; children: React.ReactNode; hint?: string; error?: string }) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && !error && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
  );
}

/** Role-gated wrapper: renders children only when the user has the role. */
export function RoleGate({ min, children, fallback = null }: { min: Parameters<ReturnType<typeof useApp>["can"]>[0]; children: React.ReactNode; fallback?: React.ReactNode }) {
  const { can } = useApp();
  return <>{can(min) ? children : fallback}</>;
}
