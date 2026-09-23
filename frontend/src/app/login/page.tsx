"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Cpu, Eye, EyeOff, ArrowRight, Lock, Mail, Sparkles,
  TrendingUp, BarChart3, ShieldCheck, X, User, Phone,
  Store, MapPin, Building2, CheckCircle2, ChevronDown, Loader2,
} from "lucide-react";

// ── Demo credentials ──────────────────────────────────────────────────────────
const DEMO_EMAIL = "demo@priceiq.ai";
const DEMO_PASSWORD = "priceiq2025";

// ── Floating stat cards ───────────────────────────────────────────────────────
const STAT_CARDS = [
  { label: "Revenue Uplift", value: "+18.4%", color: "#10b981", delay: "0s" },
  { label: "Optimized SKUs", value: "1,240", color: "#6366f1", delay: "0.7s" },
  { label: "Margin Saved", value: "₹4.2L", color: "#f59e0b", delay: "1.4s" },
];

const STORE_TYPES = [
  "Supermarket / Grocery",
  "Electronics & Appliances",
  "Fashion & Apparel",
  "Pharmacy / Medical",
  "Hardware & Tools",
  "Furniture & Home",
  "Books & Stationery",
  "Sports & Fitness",
  "Food & Beverage",
  "Other",
];

const BUSINESS_SIZES = [
  "1–10 employees (Micro)",
  "11–50 employees (Small)",
  "51–200 employees (Medium)",
  "200+ employees (Large)",
];

// ── Join-Us form state type ────────────────────────────────────────────────────
type JoinForm = {
  name: string;
  email: string;
  phone: string;
  storeName: string;
  pincode: string;
  city: string;
  state: string;
  storeType: string;
  businessSize: string;
  message: string;
};

const EMPTY_FORM: JoinForm = {
  name: "", email: "", phone: "", storeName: "",
  pincode: "", city: "", state: "",
  storeType: "", businessSize: "", message: "",
};

// ── Pincode lookup (India postal API) ─────────────────────────────────────────
async function lookupPincode(pin: string): Promise<{ city: string; state: string } | null> {
  if (pin.length !== 6) return null;
  try {
    const res = await fetch(`https://api.postalpincode.in/pincode/${pin}`);
    const data = await res.json();
    if (data?.[0]?.Status === "Success") {
      const po = data[0].PostOffice?.[0];
      return po ? { city: po.District, state: po.State } : null;
    }
  } catch { /* ignore */ }
  return null;
}

export default function LoginPage() {
  const router = useRouter();

  // ── Login state ──────────────────────────────────────────────────────────────
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [autofilled, setAutofilled] = useState(false);
  const [particles, setParticles] = useState<{ x: number; y: number; size: number; speed: number; opacity: number }[]>([]);

  // ── Join Us modal state ──────────────────────────────────────────────────────
  const [showJoin, setShowJoin] = useState(false);
  const [joinForm, setJoinForm] = useState<JoinForm>(EMPTY_FORM);
  const [joinErrors, setJoinErrors] = useState<Partial<JoinForm>>({});
  const [joinLoading, setJoinLoading] = useState(false);
  const [joinSuccess, setJoinSuccess] = useState(false);
  const [pincodeLoading, setPincodeLoading] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setParticles(
      Array.from({ length: 18 }, () => ({
        x: Math.random() * 100,
        y: Math.random() * 100,
        size: Math.random() * 6 + 2,
        speed: Math.random() * 8 + 6,
        opacity: Math.random() * 0.4 + 0.1,
      }))
    );
  }, []);

  // Lock body scroll when modal is open
  useEffect(() => {
    document.body.style.overflow = showJoin ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [showJoin]);

  // Pincode auto-lookup
  useEffect(() => {
    if (joinForm.pincode.length !== 6) {
      setJoinForm((f) => ({ ...f, city: "", state: "" }));
      return;
    }
    let cancelled = false;
    setPincodeLoading(true);
    lookupPincode(joinForm.pincode).then((res) => {
      if (!cancelled) {
        setPincodeLoading(false);
        if (res) setJoinForm((f) => ({ ...f, city: res.city, state: res.state }));
      }
    });
    return () => { cancelled = true; };
  }, [joinForm.pincode]);

  const fillDemo = () => {
    setEmail(DEMO_EMAIL);
    setPassword(DEMO_PASSWORD);
    setAutofilled(true);
    setError("");
    setTimeout(() => setAutofilled(false), 2000);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!email || !password) { setError("Please enter both email and password."); return; }
    setLoading(true);
    await new Promise((r) => setTimeout(r, 900));
    if (email.trim() === DEMO_EMAIL && password === DEMO_PASSWORD) {
      localStorage.setItem("priceiq_auth", "demo");
      router.push("/dashboard");
    } else {
      setLoading(false);
      setError("Invalid credentials. Try the demo account below.");
    }
  };

  // ── Join form handlers ──────────────────────────────────────────────────────
  const setField = (k: keyof JoinForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setJoinForm((f) => ({ ...f, [k]: e.target.value }));
    setJoinErrors((err) => ({ ...err, [k]: "" }));
  };

  const validateJoin = (): boolean => {
    const errs: Partial<JoinForm> = {};
    if (!joinForm.name.trim()) errs.name = "Full name is required";
    if (!joinForm.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(joinForm.email)) errs.email = "Valid email required";
    if (!joinForm.phone.trim() || !/^[6-9]\d{9}$/.test(joinForm.phone.replace(/\s/g, ""))) errs.phone = "Valid 10-digit Indian mobile number required";
    if (!joinForm.storeName.trim()) errs.storeName = "Store name is required";
    if (!joinForm.pincode.trim() || joinForm.pincode.length !== 6) errs.pincode = "Valid 6-digit pincode required";
    if (!joinForm.storeType) errs.storeType = "Please select a store type";
    if (!joinForm.businessSize) errs.businessSize = "Please select business size";
    setJoinErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleJoinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateJoin()) return;
    setJoinLoading(true);
    await new Promise((r) => setTimeout(r, 1400));
    setJoinLoading(false);
    setJoinSuccess(true);
  };

  const closeModal = () => {
    setShowJoin(false);
    setTimeout(() => { setJoinForm(EMPTY_FORM); setJoinErrors({}); setJoinSuccess(false); }, 400);
  };

  // ── Shared input style helper ────────────────────────────────────────────────
  const inputCls = "w-full rounded-xl py-3 pl-10 pr-4 text-sm text-slate-800 placeholder-slate-400 outline-none transition-all duration-200 focus:ring-2 font-medium";
  const inputStyle = {
    background: "rgba(255,255,255,0.93)",
    border: "1px solid rgba(255,255,255,0.6)",
    boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
  };
  const inputStyleErr = {
    background: "rgba(255,255,255,0.93)",
    border: "1px solid rgba(239,68,68,0.6)",
    boxShadow: "0 2px 8px rgba(239,68,68,0.1)",
  };

  return (
    <div
      className="min-h-screen flex overflow-hidden"
      style={{ background: "linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)" }}
    >
      {/* ── Animated particle background ─────────────────────────── */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
        {particles.map((p, i) => (
          <div
            key={i}
            className="absolute rounded-full"
            style={{
              left: `${p.x}%`,
              top: `${p.y}%`,
              width: p.size,
              height: p.size,
              background: i % 3 === 0 ? "#7c3aed" : i % 3 === 1 ? "#22d3ee" : "#f59e0b",
              opacity: p.opacity,
              animation: `float-particle ${p.speed}s ease-in-out infinite alternate`,
              animationDelay: `${(i * 0.3) % 3}s`,
            }}
          />
        ))}
        <div className="absolute rounded-full" style={{ width: 600, height: 600, top: "-10%", left: "-15%", background: "radial-gradient(circle, rgba(124,58,237,0.2) 0%, transparent 70%)", animation: "pulse 8s ease-in-out infinite" }} />
        <div className="absolute rounded-full" style={{ width: 500, height: 500, bottom: "-10%", right: "-10%", background: "radial-gradient(circle, rgba(34,211,238,0.15) 0%, transparent 70%)", animation: "pulse 10s ease-in-out infinite 2s" }} />
      </div>

      {/* ── Left branding panel ───────────────────────────────────── */}
      <div className="hidden lg:flex flex-col justify-between w-1/2 p-14 relative z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, #7c3aed, #22d3ee)", boxShadow: "0 0 30px rgba(124,58,237,0.5)" }}>
            <Cpu size={20} className="text-white" />
          </div>
          <span className="font-extrabold text-white text-xl tracking-tight">PriceIQ</span>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full ml-1" style={{ background: "rgba(124,58,237,0.3)", color: "#c4b5fd", border: "1px solid rgba(124,58,237,0.4)" }}>v4.0</span>
        </div>

        <div className="flex flex-col gap-8">
          <div>
            <h1 className="text-5xl font-extrabold text-white leading-tight mb-4">
              Smarter Pricing
              <br />
              <span style={{ background: "linear-gradient(90deg, #a78bfa, #22d3ee)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                Bigger Margins.
              </span>
            </h1>
            <p className="text-slate-400 text-base leading-relaxed max-w-md">
              AI-powered dynamic pricing with real-time competitor intelligence, demand forecasting, and Thompson Sampling optimization — built for modern retail.
            </p>
          </div>
          <div className="flex flex-col gap-3">
            {[
              { icon: TrendingUp, text: "XGBoost demand prediction" },
              { icon: BarChart3, text: "Thompson Sampling bandit engine" },
              { icon: ShieldCheck, text: "Live competitor price scraping" },
            ].map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "rgba(124,58,237,0.2)", border: "1px solid rgba(124,58,237,0.3)" }}>
                  <Icon size={15} className="text-violet-300" />
                </div>
                <span className="text-slate-300 text-sm font-medium">{text}</span>
              </div>
            ))}
          </div>
          <div className="flex gap-4 flex-wrap">
            {STAT_CARDS.map((card) => (
              <div key={card.label} className="rounded-2xl px-4 py-3 flex flex-col gap-0.5" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", backdropFilter: "blur(12px)", animation: `float-card 4s ease-in-out infinite alternate`, animationDelay: card.delay }}>
                <span className="text-xs font-semibold" style={{ color: "rgba(255,255,255,0.45)" }}>{card.label}</span>
                <span className="text-xl font-extrabold" style={{ color: card.color }}>{card.value}</span>
              </div>
            ))}
          </div>
        </div>

        <p className="text-slate-600 text-xs">© 2026 PriceIQ · AI Pricing Intelligence</p>
      </div>

      {/* ── Right login form panel ────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center p-6 z-10 relative">
        <div
          className="w-full max-w-md rounded-3xl p-8 flex flex-col gap-6"
          style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", backdropFilter: "blur(40px)", boxShadow: "0 32px 80px rgba(0,0,0,0.5)" }}
        >
          {/* Mobile logo */}
          <div className="flex lg:hidden items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "linear-gradient(135deg, #7c3aed, #22d3ee)" }}>
              <Cpu size={16} className="text-white" />
            </div>
            <span className="font-extrabold text-white text-lg">PriceIQ</span>
          </div>

          {/* Heading */}
          <div>
            <h2 className="text-2xl font-extrabold text-white mb-1">Welcome back</h2>
            <p className="text-sm" style={{ color: "rgba(255,255,255,0.45)" }}>Sign in to your pricing dashboard</p>
          </div>

          {/* Demo autofill */}
          <button
            type="button"
            onClick={fillDemo}
            className="flex items-center gap-2 rounded-xl px-4 py-3 text-left transition-all duration-200"
            style={{ background: autofilled ? "rgba(16,185,129,0.15)" : "rgba(124,58,237,0.12)", border: autofilled ? "1px solid rgba(16,185,129,0.4)" : "1px solid rgba(124,58,237,0.3)" }}
          >
            <Sparkles size={16} className="flex-shrink-0" style={{ color: autofilled ? "#10b981" : "#a78bfa" }} />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold" style={{ color: autofilled ? "#10b981" : "#c4b5fd" }}>
                {autofilled ? "✓ Demo credentials filled!" : "Click to autofill demo account"}
              </p>
              <p className="text-[11px] truncate" style={{ color: "rgba(255,255,255,0.3)" }}>
                {DEMO_EMAIL} · {DEMO_PASSWORD}
              </p>
            </div>
          </button>

          {/* Login form */}
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {/* Email */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold" style={{ color: "rgba(255,255,255,0.9)" }}>Email Address</label>
              <div className="relative">
                <Mail size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: "#64748b" }} />
                <input
                  type="email" id="login-email" autoComplete="email" placeholder="you@example.com"
                  value={email} onChange={(e) => { setEmail(e.target.value); setError(""); }}
                  className={inputCls}
                  style={{
                    ...inputStyle, // @ts-expect-error custom ring
                    "--tw-ring-color": "rgba(99,102,241,0.5)"
                  }}
                />
              </div>
            </div>

            {/* Password */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold" style={{ color: "rgba(255,255,255,0.9)" }}>Password</label>
              <div className="relative">
                <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: "#64748b" }} />
                <input
                  type={showPw ? "text" : "password"} id="login-password" autoComplete="current-password" placeholder="••••••••"
                  value={password} onChange={(e) => { setPassword(e.target.value); setError(""); }}
                  className={`${inputCls} pr-11`} style={inputStyle}
                />
                <button type="button" onClick={() => setShowPw((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-lg transition-colors" style={{ color: "#94a3b8" }} tabIndex={-1}>
                  {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {error && (
              <div className="rounded-xl px-4 py-2.5 text-xs font-semibold" style={{ background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)", color: "#fca5a5" }}>
                {error}
              </div>
            )}

            <button
              type="submit" disabled={loading}
              className="w-full rounded-xl py-3.5 font-bold text-sm text-white flex items-center justify-center gap-2 transition-all duration-200 mt-1 disabled:opacity-60"
              style={{ background: loading ? "rgba(124,58,237,0.5)" : "linear-gradient(135deg, #7c3aed, #6d28d9)", boxShadow: loading ? "none" : "0 8px 24px rgba(124,58,237,0.4)" }}
            >
              {loading ? (
                <><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full" style={{ animation: "spin 0.8s linear infinite" }} />Signing in…</>
              ) : (<>Sign In<ArrowRight size={16} /></>)}
            </button>
          </form>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.08)" }} />
            <span className="text-xs font-semibold" style={{ color: "rgba(255,255,255,0.25)" }}>or</span>
            <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.08)" }} />
          </div>

          {/* Join Us button */}
          <button
            type="button"
            onClick={() => setShowJoin(true)}
            className="w-full rounded-xl py-3.5 font-bold text-sm flex items-center justify-center gap-2 transition-all duration-200 group"
            style={{
              background: "rgba(34,211,238,0.08)",
              border: "1px solid rgba(34,211,238,0.3)",
              color: "#22d3ee",
            }}
          >
            <Building2 size={16} className="transition-transform duration-200 group-hover:scale-110" />
            Join Us — Request Access
            <ArrowRight size={14} className="transition-transform duration-200 group-hover:translate-x-1" />
          </button>

          {/* Back to landing */}
          <p className="text-center text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>
            Not sure yet?{" "}
            <button onClick={() => router.push("/")} className="font-semibold underline underline-offset-2 transition-colors hover:text-white" style={{ color: "rgba(167,139,250,0.8)" }}>
              Back to home
            </button>
          </p>
        </div>
      </div>

      {/* ── Join Us Modal ─────────────────────────────────────────── */}
      {showJoin && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(6px)", animation: "fade-in 0.25s ease" }}
          onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}
        >
          <div
            ref={modalRef}
            className="relative w-full max-w-lg rounded-3xl flex flex-col"
            style={{
              background: "linear-gradient(160deg, rgba(22,14,60,0.98) 0%, rgba(15,20,50,0.98) 100%)",
              border: "1px solid rgba(124,58,237,0.3)",
              boxShadow: "0 40px 100px rgba(0,0,0,0.7), 0 0 0 1px rgba(124,58,237,0.1)",
              backdropFilter: "blur(60px)",
              maxHeight: "92vh",
              animation: "modal-slide-in 0.3s cubic-bezier(0.34,1.56,0.64,1)",
            }}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between px-7 pt-7 pb-5" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, rgba(34,211,238,0.2), rgba(124,58,237,0.2))", border: "1px solid rgba(34,211,238,0.3)" }}>
                  <Building2 size={18} style={{ color: "#22d3ee" }} />
                </div>
                <div>
                  <h3 className="font-extrabold text-white text-lg leading-none">Join PriceIQ</h3>
                  <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.4)" }}>Request early access for your store</p>
                </div>
              </div>
              <button onClick={closeModal} className="w-8 h-8 rounded-xl flex items-center justify-center transition-all duration-150 hover:scale-110" style={{ background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.5)" }}>
                <X size={16} />
              </button>
            </div>

            {/* Modal body */}
            <div className="overflow-y-auto px-7 py-6" style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(124,58,237,0.3) transparent" }}>
              {joinSuccess ? (
                /* ── Success state ── */
                <div className="flex flex-col items-center text-center gap-5 py-8">
                  <div className="w-20 h-20 rounded-full flex items-center justify-center" style={{ background: "rgba(16,185,129,0.15)", border: "2px solid rgba(16,185,129,0.4)", animation: "scale-in 0.4s cubic-bezier(0.34,1.56,0.64,1)" }}>
                    <CheckCircle2 size={38} style={{ color: "#10b981" }} />
                  </div>
                  <div>
                    <h4 className="text-2xl font-extrabold text-white mb-2">Request Submitted!</h4>
                    <p className="text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.5)" }}>
                      Thanks, <span className="text-white font-semibold">{joinForm.name.split(" ")[0]}</span>! We&apos;ve received your access request for <span className="text-white font-semibold">{joinForm.storeName}</span>. Our team will review and reach out within <span className="text-emerald-400 font-semibold">2–3 business days</span>.
                    </p>
                  </div>
                  <div className="w-full rounded-2xl px-5 py-4 text-sm text-left" style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)" }}>
                    <p className="font-bold text-emerald-400 mb-2 text-xs uppercase tracking-widest">What happens next?</p>
                    {["Our team reviews your store details", "You receive a personalized demo invite", "Onboarding & setup within 48 hours"].map((s, i) => (
                      <div key={i} className="flex items-start gap-2.5 mt-2">
                        <span className="w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] font-bold text-white mt-0.5" style={{ background: "rgba(16,185,129,0.35)" }}>{i + 1}</span>
                        <span style={{ color: "rgba(255,255,255,0.6)" }}>{s}</span>
                      </div>
                    ))}
                  </div>
                  <button onClick={closeModal} className="rounded-xl px-8 py-3 font-bold text-sm text-white transition-all duration-200" style={{ background: "linear-gradient(135deg, #7c3aed, #6d28d9)", boxShadow: "0 6px 20px rgba(124,58,237,0.4)" }}>
                    Back to Sign In
                  </button>
                </div>
              ) : (
                /* ── Join form ── */
                <form onSubmit={handleJoinSubmit} className="flex flex-col gap-5" noValidate>

                  {/* Step indicator */}
                  <div className="flex items-center gap-2 mb-1">
                    {["Personal", "Store", "Details"].map((s, i) => (
                      <div key={s} className="flex items-center gap-2">
                        <div className="flex items-center gap-1.5">
                          <span className="w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center" style={{ background: "rgba(124,58,237,0.35)", color: "#c4b5fd" }}>{i + 1}</span>
                          <span className="text-xs font-semibold" style={{ color: "rgba(255,255,255,0.45)" }}>{s}</span>
                        </div>
                        {i < 2 && <div className="w-6 h-px" style={{ background: "rgba(255,255,255,0.12)" }} />}
                      </div>
                    ))}
                  </div>

                  {/* ─ Personal details ─ */}
                  <div className="rounded-2xl p-4 flex flex-col gap-4" style={{ background: "rgba(124,58,237,0.06)", border: "1px solid rgba(124,58,237,0.15)" }}>
                    <p className="text-xs font-bold uppercase tracking-widest" style={{ color: "rgba(167,139,250,0.7)" }}>Personal Info</p>

                    {/* Full Name */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-bold" style={{ color: "rgba(255,255,255,0.9)" }}>Full Name <span className="text-red-400">*</span></label>
                      <div className="relative">
                        <User size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: "#64748b" }} />
                        <input
                          type="text" id="join-name" placeholder="Rahul Sharma" value={joinForm.name} onChange={setField("name")}
                          className={inputCls} style={joinErrors.name ? inputStyleErr : inputStyle}
                        />
                      </div>
                      {joinErrors.name && <p className="text-[11px] text-red-400">{joinErrors.name}</p>}
                    </div>

                    {/* Email & Phone side by side */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-bold" style={{ color: "rgba(255,255,255,0.9)" }}>Email <span className="text-red-400">*</span></label>
                        <div className="relative">
                          <Mail size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: "#64748b" }} />
                          <input
                            type="email" id="join-email" placeholder="you@example.com" value={joinForm.email} onChange={setField("email")}
                            className={inputCls} style={joinErrors.email ? inputStyleErr : inputStyle}
                          />
                        </div>
                        {joinErrors.email && <p className="text-[11px] text-red-400">{joinErrors.email}</p>}
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-bold" style={{ color: "rgba(255,255,255,0.9)" }}>Phone <span className="text-red-400">*</span></label>
                        <div className="relative">
                          <Phone size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: "#64748b" }} />
                          <input
                            type="tel" id="join-phone" placeholder="9876543210" maxLength={10} value={joinForm.phone} onChange={setField("phone")}
                            className={inputCls} style={joinErrors.phone ? inputStyleErr : inputStyle}
                          />
                        </div>
                        {joinErrors.phone && <p className="text-[11px] text-red-400">{joinErrors.phone}</p>}
                      </div>
                    </div>
                  </div>

                  {/* ─ Store details ─ */}
                  <div className="rounded-2xl p-4 flex flex-col gap-4" style={{ background: "rgba(34,211,238,0.05)", border: "1px solid rgba(34,211,238,0.12)" }}>
                    <p className="text-xs font-bold uppercase tracking-widest" style={{ color: "rgba(34,211,238,0.7)" }}>Store Details</p>

                    {/* Store name */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-bold" style={{ color: "rgba(255,255,255,0.9)" }}>Store Name <span className="text-red-400">*</span></label>
                      <div className="relative">
                        <Store size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: "#64748b" }} />
                        <input
                          type="text" id="join-storename" placeholder="My Retail Store" value={joinForm.storeName} onChange={setField("storeName")}
                          className={inputCls} style={joinErrors.storeName ? inputStyleErr : inputStyle}
                        />
                      </div>
                      {joinErrors.storeName && <p className="text-[11px] text-red-400">{joinErrors.storeName}</p>}
                    </div>

                    {/* Pincode + City + State */}
                    <div className="grid grid-cols-3 gap-3">
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-bold" style={{ color: "rgba(255,255,255,0.9)" }}>Pincode <span className="text-red-400">*</span></label>
                        <div className="relative">
                          <MapPin size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: "#64748b" }} />
                          <input
                            type="text" id="join-pincode" placeholder="400001" maxLength={6}
                            value={joinForm.pincode}
                            onChange={(e) => { const v = e.target.value.replace(/\D/g, ""); setJoinForm((f) => ({ ...f, pincode: v })); setJoinErrors((err) => ({ ...err, pincode: "" })); }}
                            className={inputCls} style={joinErrors.pincode ? inputStyleErr : inputStyle}
                          />
                          {pincodeLoading && <Loader2 size={13} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin" style={{ color: "#6366f1" }} />}
                        </div>
                        {joinErrors.pincode && <p className="text-[11px] text-red-400">{joinErrors.pincode}</p>}
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-bold" style={{ color: "rgba(255,255,255,0.9)" }}>City</label>
                        <div className="relative">
                          <input
                            type="text" id="join-city" placeholder="Auto-filled" readOnly value={joinForm.city}
                            className="w-full rounded-xl py-3 px-3 text-sm text-slate-600 outline-none font-medium"
                            style={{ background: "rgba(255,255,255,0.75)", border: "1px solid rgba(255,255,255,0.4)", cursor: "default" }}
                          />
                        </div>
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-bold" style={{ color: "rgba(255,255,255,0.9)" }}>State</label>
                        <input
                          type="text" id="join-state" placeholder="Auto-filled" readOnly value={joinForm.state}
                          className="w-full rounded-xl py-3 px-3 text-sm text-slate-600 outline-none font-medium"
                          style={{ background: "rgba(255,255,255,0.75)", border: "1px solid rgba(255,255,255,0.4)", cursor: "default" }}
                        />
                      </div>
                    </div>
                    {joinForm.city && (
                      <p className="text-[11px] flex items-center gap-1.5" style={{ color: "#22d3ee" }}>
                        <MapPin size={10} />
                        {joinForm.city}, {joinForm.state} — Location confirmed
                      </p>
                    )}
                  </div>

                  {/* ─ Business details ─ */}
                  <div className="rounded-2xl p-4 flex flex-col gap-4" style={{ background: "rgba(245,158,11,0.05)", border: "1px solid rgba(245,158,11,0.12)" }}>
                    <p className="text-xs font-bold uppercase tracking-widest" style={{ color: "rgba(245,158,11,0.7)" }}>Business Details</p>

                    <div className="grid grid-cols-2 gap-3">
                      {/* Store type */}
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-bold" style={{ color: "rgba(255,255,255,0.9)" }}>Store Type <span className="text-red-400">*</span></label>
                        <div className="relative">
                          <Store size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none z-10" style={{ color: "#64748b" }} />
                          <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "#94a3b8" }} />
                          <select
                            id="join-storetype" value={joinForm.storeType} onChange={setField("storeType")}
                            className="w-full rounded-xl py-3 pl-10 pr-8 text-sm text-slate-800 font-medium outline-none appearance-none cursor-pointer"
                            style={joinErrors.storeType ? inputStyleErr : inputStyle}
                          >
                            <option value="">Select type…</option>
                            {STORE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </div>
                        {joinErrors.storeType && <p className="text-[11px] text-red-400">{joinErrors.storeType}</p>}
                      </div>

                      {/* Business size */}
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-bold" style={{ color: "rgba(255,255,255,0.9)" }}>Business Size <span className="text-red-400">*</span></label>
                        <div className="relative">
                          <User size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none z-10" style={{ color: "#64748b" }} />
                          <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "#94a3b8" }} />
                          <select
                            id="join-bizsize" value={joinForm.businessSize} onChange={setField("businessSize")}
                            className="w-full rounded-xl py-3 pl-10 pr-8 text-sm text-slate-800 font-medium outline-none appearance-none cursor-pointer"
                            style={joinErrors.businessSize ? inputStyleErr : inputStyle}
                          >
                            <option value="">Select size…</option>
                            {BUSINESS_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </div>
                        {joinErrors.businessSize && <p className="text-[11px] text-red-400">{joinErrors.businessSize}</p>}
                      </div>
                    </div>

                    {/* Optional message */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-bold" style={{ color: "rgba(255,255,255,0.9)" }}>Additional Notes <span className="text-white/40">(optional)</span></label>
                      <textarea
                        id="join-message" rows={3} placeholder="Tell us about your pricing challenges or any specific requirements…"
                        value={joinForm.message} onChange={setField("message")}
                        className="w-full rounded-xl py-3 px-4 text-sm text-slate-800 placeholder-slate-400 font-medium outline-none resize-none transition-all duration-200"
                        style={inputStyle}
                      />
                    </div>
                  </div>

                  {/* Submit */}
                  <button
                    type="submit" disabled={joinLoading}
                    className="w-full rounded-xl py-4 font-bold text-sm text-white flex items-center justify-center gap-2 transition-all duration-200 disabled:opacity-60"
                    style={{
                      background: joinLoading ? "rgba(34,211,238,0.3)" : "linear-gradient(135deg, #0891b2, #22d3ee, #7c3aed)",
                      boxShadow: joinLoading ? "none" : "0 8px 28px rgba(34,211,238,0.3)",
                    }}
                  >
                    {joinLoading ? (
                      <><Loader2 size={16} className="animate-spin" />Submitting Request…</>
                    ) : (
                      <><CheckCircle2 size={16} />Submit Access Request<ArrowRight size={14} /></>
                    )}
                  </button>

                  <p className="text-center text-[11px]" style={{ color: "rgba(255,255,255,0.25)" }}>
                    By submitting, you agree to our Terms of Service and Privacy Policy. No spam, ever.
                  </p>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Keyframe styles ───────────────────────────────────────── */}
      <style>{`
        @keyframes float-particle {
          from { transform: translateY(0px) rotate(0deg); }
          to   { transform: translateY(-30px) rotate(180deg); }
        }
        @keyframes float-card {
          from { transform: translateY(0px); }
          to   { transform: translateY(-10px); }
        }
        @keyframes pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.05); opacity: 0.8; }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes fade-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes modal-slide-in {
          from { opacity: 0; transform: translateY(24px) scale(0.96); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes scale-in {
          from { transform: scale(0.5); opacity: 0; }
          to   { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
