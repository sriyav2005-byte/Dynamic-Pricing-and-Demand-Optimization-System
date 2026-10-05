"use client";

/**
 * AppProvider — session, current store, role checks, toasts and confirmations.
 *
 * Protected pages read `useApp()`:
 *   me, store (current store access), role, can(minRole), setStoreId,
 *   toast(...), confirm(...), refreshMe(), logout()
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { configureApi, errorMessage, getMe, Me, Role, ROLE_RANK, StoreAccess } from "@/lib/api";
import { getAccessToken, onAuthChange, signOut } from "@/lib/auth";

type ToastKind = "success" | "error" | "info" | "warning";
interface Toast { id: number; kind: ToastKind; text: string }
interface ConfirmOpts { title: string; message: string; confirmLabel?: string; danger?: boolean; reasonLabel?: string }

interface AppCtx {
  me: Me | null;
  store: StoreAccess | null;
  storeId: string;
  role: Role | null;
  can: (min: Role) => boolean;
  setStoreId: (id: string) => void;
  refreshMe: () => Promise<void>;
  logout: () => Promise<void>;
  toast: (text: string, kind?: ToastKind) => void;
  toastError: (err: unknown) => void;
  confirm: (opts: ConfirmOpts) => Promise<{ ok: boolean; reason: string }>;
}

const Ctx = createContext<AppCtx | null>(null);
const STORE_KEY = "priceiq_store";
const PUBLIC = ["/", "/login", "/reset-password"];

export function useApp(): AppCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useApp must be used inside AppProvider");
  return c;
}

export default function AppProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [storeId, setStoreIdState] = useState("");
  const [ready, setReady] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmState, setConfirmState] = useState<(ConfirmOpts & { resolve: (v: { ok: boolean; reason: string }) => void }) | null>(null);
  const [reason, setReason] = useState("");
  const tid = useRef(0);

  const toast = useCallback((text: string, kind: ToastKind = "success") => {
    const id = ++tid.current;
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 7000 : 4000);
  }, []);
  const toastError = useCallback((err: unknown) => toast(errorMessage(err), "error"), [toast]);

  const logout = useCallback(async () => {
    await signOut();
    setMe(null);
    router.replace("/login");
  }, [router]);

  useEffect(() => {
    configureApi({ getToken: getAccessToken, onUnauthorized: () => { signOut().then(() => router.replace("/login")); } });
  }, [router]);

  const refreshMe = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) {
      setMe(null);
      setReady(true);
      return;
    }
    try {
      const m = await getMe();
      setMe(m);
      const saved = localStorage.getItem(STORE_KEY);
      const pick = m.stores.find((s) => s.store_id === saved) ?? m.stores[0];
      setStoreIdState(pick?.store_id ?? "");
    } catch {
      setMe(null);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(refreshMe);
    return onAuthChange(() => { void refreshMe(); });
  }, [refreshMe]);

  useEffect(() => {
    if (ready && !me && !PUBLIC.includes(pathname)) router.replace("/login");
  }, [ready, me, pathname, router]);

  const setStoreId = useCallback((id: string) => {
    localStorage.setItem(STORE_KEY, id);
    setStoreIdState(id);
  }, []);

  const store = useMemo(() => me?.stores.find((s) => s.store_id === storeId) ?? null, [me, storeId]);
  const role = store?.role ?? null;
  const can = useCallback((min: Role) => !!role && ROLE_RANK[role] >= ROLE_RANK[min], [role]);

  const confirm = useCallback((opts: ConfirmOpts) => new Promise<{ ok: boolean; reason: string }>((resolve) => {
    setReason("");
    setConfirmState({ ...opts, resolve });
  }), []);

  const value: AppCtx = { me, store, storeId, role, can, setStoreId, refreshMe, logout, toast, toastError, confirm };
  const isPublic = PUBLIC.includes(pathname);

  return (
    <Ctx.Provider value={value}>
      {!ready && !isPublic ? <Splash /> : children}

      {/* Toasts */}
      <div className="fixed bottom-5 right-5 z-[100] flex flex-col gap-2 w-[min(380px,calc(100vw-2rem))]" aria-live="polite">
        {toasts.map((t) => {
          const Icon = t.kind === "success" ? CheckCircle2 : t.kind === "error" ? XCircle : t.kind === "warning" ? AlertTriangle : Info;
          const color = t.kind === "success" ? "#059669" : t.kind === "error" ? "#dc2626" : t.kind === "warning" ? "#d97706" : "#7c3aed";
          return (
            <div key={t.id} role="status" className="flex items-start gap-3 rounded-xl bg-white px-4 py-3 shadow-lg border" style={{ borderColor: `${color}40` }}>
              <Icon size={18} style={{ color }} className="mt-0.5 shrink-0" />
              <p className="text-sm text-slate-700 flex-1">{t.text}</p>
              <button aria-label="Dismiss" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))} className="text-slate-400 hover:text-slate-600"><X size={14} /></button>
            </div>
          );
        })}
      </div>

      {/* Confirmation dialog */}
      {confirmState && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h2 id="confirm-title" className="text-lg font-semibold text-slate-800">{confirmState.title}</h2>
            <p className="mt-2 text-sm text-slate-600 whitespace-pre-line">{confirmState.message}</p>
            {confirmState.reasonLabel && (
              <label className="mt-4 block text-sm">
                <span className="text-slate-600">{confirmState.reasonLabel}</span>
                <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} className="input mt-1" placeholder="Optional — stored in the audit log" />
              </label>
            )}
            <div className="mt-6 flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => { confirmState.resolve({ ok: false, reason: "" }); setConfirmState(null); }}>Cancel</button>
              <button className={confirmState.danger ? "btn-danger" : "btn-primary"}
                onClick={() => { confirmState.resolve({ ok: true, reason }); setConfirmState(null); }}>
                {confirmState.confirmLabel ?? "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

function Splash() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-[#f8f9fd]">
      <div className="w-12 h-12 rounded-2xl animate-pulse" style={{ background: "linear-gradient(135deg,#7c3aed,#22d3ee)" }} />
      <p className="text-sm text-slate-400">Loading your workspace…</p>
    </div>
  );
}
