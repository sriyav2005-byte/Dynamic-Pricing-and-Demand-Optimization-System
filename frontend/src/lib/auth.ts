/**
 * lib/auth.ts — authentication adapter.
 *
 * Supabase mode (NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY set):
 *   sign-up with e-mail verification, sign-in, sign-out and password reset are
 *   handled by Supabase Auth; the Go API verifies the Supabase access token.
 * Local mode (no Supabase configured; Go API runs with AUTH_PROVIDER=local):
 *   the Go API issues a Supabase-shaped JWT for development. E-mail
 *   verification and password reset are not available in this mode.
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { localLogin, localRegister } from "./api";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const LOCAL_KEY = "priceiq_session";

export const authMode: "supabase" | "local" = SUPABASE_URL && SUPABASE_ANON_KEY ? "supabase" : "local";

let supabase: SupabaseClient | null = null;
export function sb(): SupabaseClient {
  if (!supabase) supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
  return supabase;
}

interface LocalSession { access_token: string; expires_at: string }

function readLocal(): LocalSession | null {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as LocalSession;
    if (new Date(s.expires_at).getTime() < Date.now()) {
      localStorage.removeItem(LOCAL_KEY);
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

export async function getAccessToken(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  if (authMode === "supabase") {
    const { data } = await sb().auth.getSession();
    return data.session?.access_token ?? null;
  }
  return readLocal()?.access_token ?? null;
}

export async function signIn(email: string, password: string): Promise<void> {
  if (authMode === "supabase") {
    const { error } = await sb().auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    return;
  }
  const s = await localLogin(email, password);
  localStorage.setItem(LOCAL_KEY, JSON.stringify({ access_token: s.access_token, expires_at: s.expires_at }));
}

export interface SignUpInput { email: string; password: string; full_name: string; phone?: string; store_name?: string; city?: string; state?: string; pincode?: string }

/** Returns "verify-email" when Supabase requires e-mail confirmation first. */
export async function signUp(input: SignUpInput): Promise<"signed-in" | "verify-email"> {
  if (authMode === "supabase") {
    const { email, password, ...meta } = input;
    const { data, error } = await sb().auth.signUp({
      email, password,
      options: { data: meta, emailRedirectTo: `${window.location.origin}/login?verified=1` },
    });
    if (error) throw new Error(error.message);
    return data.session ? "signed-in" : "verify-email";
  }
  const s = await localRegister(input);
  localStorage.setItem(LOCAL_KEY, JSON.stringify({ access_token: s.access_token, expires_at: s.expires_at }));
  return "signed-in";
}

export async function signOut(): Promise<void> {
  if (authMode === "supabase") await sb().auth.signOut();
  localStorage.removeItem(LOCAL_KEY);
}

export async function requestPasswordReset(email: string): Promise<void> {
  if (authMode !== "supabase") throw new Error("Password reset needs Supabase Auth (not available in local development mode).");
  const { error } = await sb().auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` });
  if (error) throw new Error(error.message);
}

export async function updatePassword(password: string): Promise<void> {
  if (authMode !== "supabase") throw new Error("Password changes need Supabase Auth.");
  const { error } = await sb().auth.updateUser({ password });
  if (error) throw new Error(error.message);
}

export function onAuthChange(cb: () => void): () => void {
  if (authMode !== "supabase") return () => {};
  const { data } = sb().auth.onAuthStateChange(() => cb());
  return () => data.subscription.unsubscribe();
}
