"use client";

/** /reset-password — landing page of the Supabase password-reset e-mail. */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updatePassword } from "@/lib/auth";
import { Field, Notice, Spinner } from "@/components/ui/kit";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (pw !== pw2) return setError("Passwords do not match.");
    if (pw.length < 8 || !/[0-9]/.test(pw) || !/[a-z]/i.test(pw)) return setError("Use at least 8 characters with a letter and a digit.");
    setBusy(true);
    try {
      await updatePassword(pw);
      router.replace("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4">
        <h1 className="text-xl font-bold text-slate-800">Choose a new password</h1>
        <Field label="New password"><input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></Field>
        <Field label="Confirm password"><input className="input" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" /></Field>
        {error && <Notice tone="danger">{error}</Notice>}
        <button className="btn-primary w-full" disabled={busy}>{busy && <Spinner />}Update password</button>
      </form>
    </div>
  );
}
