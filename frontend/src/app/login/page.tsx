"use client";

/**
 * /login — sign in, register a store, reset password.
 * Supabase Auth when configured (e-mail verification + password reset);
 * otherwise the Go API's local development auth.
 */

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Cpu, KeyRound, LogIn, MailCheck, Store, UserPlus } from "lucide-react";
import { authMode, requestPasswordReset, signIn, signUp } from "@/lib/auth";
import { errorMessage } from "@/lib/api";
import { useApp } from "@/components/providers/AppProvider";
import { Field, Notice, Spinner } from "@/components/ui/kit";

type Mode = "signin" | "register" | "forgot";

const DEMO = [
  ["demo@priceiq.ai", "Admin · both stores"],
  ["manager@priceiq.ai", "Store manager · Koramangala"],
  ["analyst@priceiq.ai", "Analyst · both stores"],
  ["viewer@priceiq.ai", "Viewer · Indiranagar"],
];

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { me, refreshMe } = useApp();
  const [mode, setMode] = useState<Mode>("signin");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState(params.get("verified") ? "E-mail verified — you can sign in now." : "");
  const [f, setF] = useState({ email: "", password: "", full_name: "", phone: "", store_name: "", city: "", state: "", pincode: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  useEffect(() => { if (me) router.replace("/dashboard"); }, [me, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setInfo("");
    setBusy(true);
    try {
      if (mode === "signin") {
        await signIn(f.email.trim(), f.password);
        await refreshMe();
        router.replace("/dashboard");
      } else if (mode === "register") {
        if (f.password.length < 8 || !/[0-9]/.test(f.password) || !/[a-z]/i.test(f.password)) throw new Error("Password must be at least 8 characters with a letter and a digit.");
        if (f.pincode && !/^[0-9]{6}$/.test(f.pincode)) throw new Error("Pincode must be 6 digits.");
        const r = await signUp({ ...f, email: f.email.trim() });
        if (r === "verify-email") {
          setInfo("Check your inbox to verify your e-mail, then sign in. Your store is created on verification.");
          setMode("signin");
        } else {
          await refreshMe();
          router.replace("/dashboard");
        }
      } else {
        await requestPasswordReset(f.email.trim());
        setInfo("If an account exists for this e-mail, a password-reset link has been sent.");
        setMode("signin");
      }
    } catch (err) {
      setError(err instanceof Error && !("isAxiosError" in err) ? err.message : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-violet-50 via-white to-cyan-50 p-4">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-3xl bg-white shadow-2xl md:grid-cols-2">
        <div className="hidden flex-col justify-between p-10 text-white md:flex" style={{ background: "linear-gradient(145deg,#4c1d95,#6d28d9 55%,#0e7490)" }}>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15"><Cpu size={20} /></div>
            <span className="text-xl font-bold">PriceIQ</span>
          </div>
          <div>
            <h1 className="text-3xl font-bold leading-tight">Pricing decisions you can explain.</h1>
            <p className="mt-4 text-violet-100">Demand forecasting, constraint-safe dynamic pricing, competitor intelligence, inventory &amp; expiry optimization and an AI copilot — in one workspace.</p>
          </div>
          <ul className="space-y-2 text-sm text-violet-100">
            <li>• Every price passes MRP, margin and change-limit rules</li>
            <li>• Manager approval workflow with a full audit trail</li>
            <li>• Data labelled LIVE / MANUAL VERIFIED / CACHED / UNAVAILABLE — never guessed</li>
          </ul>
        </div>

        <div className="p-8 md:p-10">
          <div className="mb-6 flex gap-1 rounded-xl bg-slate-100 p-1" role="tablist">
            {([["signin", "Sign in", LogIn], ["register", "Register store", UserPlus]] as const).map(([m, label, Icon]) => (
              <button key={m} role="tab" aria-selected={mode === m} onClick={() => { setMode(m); setError(""); }}
                className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-sm font-semibold transition ${mode === m ? "bg-white text-violet-700 shadow" : "text-slate-500"}`}>
                <Icon size={15} />{label}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-4" noValidate>
            {mode === "forgot" && <p className="text-sm text-slate-600">Enter your account e-mail and we&apos;ll send a reset link.</p>}
            {mode === "register" && (
              <>
                <Field label="Full name"><input className="input" required value={f.full_name} onChange={set("full_name")} autoComplete="name" /></Field>
                <Field label="Store name" hint="Creates your organization and first store; you become its admin.">
                  <div className="relative"><Store size={15} className="absolute left-3 top-2.5 text-slate-400" /><input className="input !pl-9" required value={f.store_name} onChange={set("store_name")} /></div>
                </Field>
                <div className="grid grid-cols-3 gap-3">
                  <Field label="City"><input className="input" value={f.city} onChange={set("city")} /></Field>
                  <Field label="State"><input className="input" value={f.state} onChange={set("state")} /></Field>
                  <Field label="Pincode"><input className="input" inputMode="numeric" maxLength={6} value={f.pincode} onChange={set("pincode")} /></Field>
                </div>
              </>
            )}
            <Field label="E-mail"><input className="input" type="email" required value={f.email} onChange={set("email")} autoComplete="email" /></Field>
            {mode !== "forgot" && (
              <Field label="Password" hint={mode === "register" ? "At least 8 characters, including a letter and a digit." : undefined}>
                <input className="input" type="password" required value={f.password} onChange={set("password")} autoComplete={mode === "register" ? "new-password" : "current-password"} />
              </Field>
            )}
            {error && <Notice tone="danger">{error}</Notice>}
            {info && <Notice><span className="inline-flex items-center gap-1"><MailCheck size={14} /> {info}</span></Notice>}
            <button type="submit" disabled={busy} className="btn-primary w-full !py-2.5">
              {busy && <Spinner />}{mode === "signin" ? "Sign in" : mode === "register" ? "Create account" : "Send reset link"}
            </button>
            <div className="flex justify-between text-sm">
              {mode !== "forgot" ? (
                <button type="button" className="text-violet-700 hover:underline" onClick={() => setMode("forgot")}><KeyRound size={13} className="mr-1 inline" />Forgot password?</button>
              ) : (
                <button type="button" className="text-violet-700 hover:underline" onClick={() => setMode("signin")}>Back to sign in</button>
              )}
            </div>
          </form>

          {authMode === "local" && mode === "signin" && (
            <div className="mt-6 rounded-xl border border-dashed border-slate-200 p-4">
              <p className="text-xs font-semibold text-slate-600">Local development accounts (password: <code>PriceIQ@2026!</code>)</p>
              <div className="mt-2 grid gap-1">
                {DEMO.map(([email, label]) => (
                  <button key={email} type="button" onClick={() => setF({ ...f, email, password: "PriceIQ@2026!" })}
                    className="flex justify-between rounded-lg px-2 py-1 text-left text-xs hover:bg-violet-50">
                    <span className="font-medium text-slate-700">{email}</span><span className="text-slate-400">{label}</span>
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-slate-400">Shown only when Supabase Auth is not configured. E-mail verification and password reset require Supabase.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return <Suspense><LoginInner /></Suspense>;
}
