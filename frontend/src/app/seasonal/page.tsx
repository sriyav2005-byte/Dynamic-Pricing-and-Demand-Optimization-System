"use client";

import { useEffect, useState } from "react";
import {
  Sparkles,
  Calendar,
  Sun,
  Snowflake,
  Leaf,
  Flower2,
  Bell,
  ArrowRight,
  TrendingUp,
  Tag,
  BarChart3,
  Zap,
} from "lucide-react";

// ── Animated counter hook ─────────────────────────────────────────────────────
function useCountdown(target: Date) {
  const [diff, setDiff] = useState({ days: 0, hours: 0, mins: 0, secs: 0 });
  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      const total = Math.max(0, target.getTime() - now);
      setDiff({
        days: Math.floor(total / 86_400_000),
        hours: Math.floor((total % 86_400_000) / 3_600_000),
        mins: Math.floor((total % 3_600_000) / 60_000),
        secs: Math.floor((total % 60_000) / 1_000),
      });
    };
    tick();
    const id = setInterval(tick, 1_000);
    return () => clearInterval(id);
  }, [target]);
  return diff;
}

// ── Planned features list ─────────────────────────────────────────────────────
const FEATURES = [
  {
    icon: Sun,
    color: "#f59e0b",
    bg: "rgba(245,158,11,0.1)",
    title: "Summer Demand Surge Detector",
    desc: "Automatically identify products whose demand spikes in summer and pre-optimise pricing before the season peaks.",
  },
  {
    icon: Snowflake,
    color: "#22d3ee",
    bg: "rgba(34,211,238,0.1)",
    title: "Winter Clearance Automation",
    desc: "Trigger progressive markdown rules for slow-moving winter stock with intelligent expiry-aware discounting.",
  },
  {
    icon: Flower2,
    color: "#ec4899",
    bg: "rgba(236,72,153,0.1)",
    title: "Festive Season Playbooks",
    desc: "Pre-built Diwali, Holi, and Eid pricing strategies with competitor benchmarks baked right in.",
  },
  {
    icon: Leaf,
    color: "#10b981",
    bg: "rgba(16,185,129,0.1)",
    title: "Monsoon Perishable Shield",
    desc: "Dynamic expiry-based repricing for perishables during high-humidity monsoon periods to cut waste.",
  },
  {
    icon: TrendingUp,
    color: "#6366f1",
    bg: "rgba(99,102,241,0.1)",
    title: "Seasonal Demand Forecasting",
    desc: "Extend the XGBoost model with season embeddings for 30-day ahead demand prediction at season boundary.",
  },
  {
    icon: Tag,
    color: "#7c3aed",
    bg: "rgba(124,58,237,0.1)",
    title: "Season-Aware Bandit Priors",
    desc: "Warm-start Thompson Sampling arms with last-year's seasonal performance data for faster convergence.",
  },
];

const SEASONS = [
  { icon: Flower2, label: "Spring", color: "#ec4899", active: false },
  { icon: Sun, label: "Summer", color: "#f59e0b", active: true },
  { icon: Leaf, label: "Autumn", color: "#10b981", active: false },
  { icon: Snowflake, label: "Winter", color: "#22d3ee", active: false },
];

// Launch target: 28 days from now
const LAUNCH_DATE = new Date(Date.now() + 28 * 24 * 60 * 60 * 1000);

// ── Floating particles ────────────────────────────────────────────────────────
type Particle = { x: number; y: number; size: number; speed: number; opacity: number; color: string };
const PARTICLE_COLORS = ["#7c3aed", "#22d3ee", "#f59e0b", "#ec4899", "#10b981", "#6366f1"];

export default function SeasonalPage() {
  const cd = useCountdown(LAUNCH_DATE);
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [particles, setParticles] = useState<Particle[]>([]);
  const [hoveredFeature, setHoveredFeature] = useState<number | null>(null);
  const [activeOrbit, setActiveOrbit] = useState(0);

  useEffect(() => {
    setParticles(
      Array.from({ length: 22 }, (_, i) => ({
        x: Math.random() * 100,
        y: Math.random() * 100,
        size: Math.random() * 8 + 3,
        speed: Math.random() * 10 + 8,
        opacity: Math.random() * 0.35 + 0.08,
        color: PARTICLE_COLORS[i % PARTICLE_COLORS.length],
      }))
    );
  }, []);

  // Orbit dot cycle
  useEffect(() => {
    const id = setInterval(() => setActiveOrbit((v) => (v + 1) % 4), 1800);
    return () => clearInterval(id);
  }, []);

  const handleNotify = (e: React.FormEvent) => {
    e.preventDefault();
    if (email.trim()) {
      setSubmitted(true);
    }
  };

  return (
    <div
      className="min-h-screen relative overflow-hidden"
      style={{ background: "linear-gradient(135deg, #0f0c29 0%, #1e1b4b 40%, #0e172b 100%)" }}
    >
      {/* ── Animated particles ──────────────────────────────────── */}
      <div className="absolute inset-0 pointer-events-none z-0">
        {particles.map((p, i) => (
          <div
            key={i}
            className="absolute rounded-full"
            style={{
              left: `${p.x}%`,
              top: `${p.y}%`,
              width: p.size,
              height: p.size,
              background: p.color,
              opacity: p.opacity,
              animation: `float-p ${p.speed}s ease-in-out infinite alternate`,
              animationDelay: `${(i * 0.4) % 4}s`,
            }}
          />
        ))}
        {/* Background glow blobs */}
        <div className="absolute" style={{ width: 700, height: 700, top: "10%", left: "30%", transform: "translateX(-50%)", background: "radial-gradient(circle, rgba(124,58,237,0.18) 0%, transparent 65%)", animation: "blob-pulse 12s ease-in-out infinite" }} />
        <div className="absolute" style={{ width: 500, height: 500, bottom: "5%", right: "10%", background: "radial-gradient(circle, rgba(34,211,238,0.12) 0%, transparent 65%)", animation: "blob-pulse 16s ease-in-out infinite 3s" }} />
        <div className="absolute" style={{ width: 400, height: 400, top: "60%", left: "5%", background: "radial-gradient(circle, rgba(245,158,11,0.1) 0%, transparent 65%)", animation: "blob-pulse 14s ease-in-out infinite 6s" }} />
      </div>

      <div className="relative z-10 max-w-6xl mx-auto px-6 py-16 flex flex-col items-center gap-20">

        {/* ── Hero Section ──────────────────────────────────────── */}
        <section className="flex flex-col items-center text-center gap-8 pt-4">
          {/* Badge */}
          <div
            className="flex items-center gap-2 px-5 py-2 rounded-full text-sm font-bold"
            style={{
              background: "rgba(124,58,237,0.2)",
              border: "1px solid rgba(124,58,237,0.4)",
              color: "#c4b5fd",
              animation: "badge-glow 3s ease-in-out infinite",
            }}
          >
            <Sparkles size={14} className="animate-pulse" />
            Seasonal Pricing Engine — Coming Soon
          </div>

          {/* Animated season orbit ring */}
          <div className="relative w-52 h-52 flex items-center justify-center" style={{ isolation: "isolate", contain: "layout style" }}>
            {/* Orbit rings — clipped so they don't bleed outside the container */}
            <div className="absolute inset-0 rounded-full overflow-hidden pointer-events-none">
              <div className="absolute inset-0 rounded-full" style={{ border: "1px solid rgba(255,255,255,0.07)", animation: "spin-slow 20s linear infinite" }} />
              <div className="absolute inset-4 rounded-full" style={{ border: "1px dashed rgba(124,58,237,0.25)", animation: "spin-slow 14s linear infinite reverse" }} />
            </div>

            {/* Central icon */}
            <div
              className="w-20 h-20 rounded-2xl flex items-center justify-center z-10"
              style={{
                background: "linear-gradient(135deg, rgba(124,58,237,0.8), rgba(34,211,238,0.8))",
                boxShadow: "0 0 50px rgba(124,58,237,0.5), 0 0 100px rgba(124,58,237,0.2)",
                animation: "icon-breathe 4s ease-in-out infinite",
              }}
            >
              <Calendar size={36} className="text-white" />
            </div>

            {/* Orbiting season dots */}
            {SEASONS.map((s, i) => {
              const angle = (i * 90 - 90) * (Math.PI / 180);
              const r = 90;
              const cx = 50 + r * Math.cos(angle);
              const cy = 50 + r * Math.sin(angle);
              const Icon = s.icon;
              return (
                <div
                  key={s.label}
                  className="absolute flex flex-col items-center gap-1 transition-all duration-700"
                  style={{
                    left: `${cx}%`,
                    top: `${cy}%`,
                    transform: "translate(-50%, -50%)",
                    opacity: activeOrbit === i ? 1 : 0.4,
                    filter: activeOrbit === i ? `drop-shadow(0 0 8px ${s.color})` : "none",
                    transition: "opacity 0.6s ease, filter 0.6s ease",
                  }}
                >
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center"
                    style={{
                      background: activeOrbit === i ? s.color : "rgba(255,255,255,0.05)",
                      border: `2px solid ${activeOrbit === i ? s.color : "rgba(255,255,255,0.1)"}`,
                      transition: "background 0.6s, border 0.6s",
                    }}
                  >
                    <Icon size={16} className="text-white" />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Main headline */}
          <div>
            <h1 className="text-5xl md:text-6xl font-extrabold text-white leading-tight mb-4">
              Seasonal
              <br />
              <span
                style={{
                  background: "linear-gradient(90deg, #a78bfa 0%, #22d3ee 50%, #f59e0b 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}
              >
                Pricing Intelligence
              </span>
            </h1>
            <p className="text-slate-400 text-lg max-w-2xl leading-relaxed">
              Harness the power of seasons — summer surges, festive demand, monsoon perishables and more. Our upcoming seasonal engine will transform how you price for the calendar.
            </p>
          </div>

          {/* ── Countdown Timer ───────────────────────────────────── */}
          <div className="flex items-center gap-4 flex-wrap justify-center">
            {[
              { value: cd.days, label: "Days" },
              { value: cd.hours, label: "Hours" },
              { value: cd.mins, label: "Minutes" },
              { value: cd.secs, label: "Seconds" },
            ].map(({ value, label }, i) => (
              <div key={label} className="flex items-center gap-4">
                <div
                  className="flex flex-col items-center justify-center w-24 h-24 rounded-2xl"
                  style={{
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    backdropFilter: "blur(10px)",
                    boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
                  }}
                >
                  <span
                    className="text-3xl font-extrabold tabular-nums"
                    style={{
                      background: "linear-gradient(135deg, #a78bfa, #22d3ee)",
                      WebkitBackgroundClip: "text",
                      WebkitTextFillColor: "transparent",
                    }}
                  >
                    {String(value).padStart(2, "0")}
                  </span>
                  <span className="text-[11px] font-semibold uppercase tracking-widest mt-1" style={{ color: "rgba(255,255,255,0.35)" }}>
                    {label}
                  </span>
                </div>
                {i < 3 && (
                  <span className="text-2xl font-bold" style={{ color: "rgba(124,58,237,0.6)", animation: "blink 1s step-end infinite" }}>
                    :
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Email notify form */}
          <div className="w-full max-w-md">
            {submitted ? (
              <div
                className="flex items-center gap-3 rounded-2xl px-6 py-4 font-semibold text-sm"
                style={{ background: "rgba(16,185,129,0.15)", border: "1px solid rgba(16,185,129,0.3)", color: "#6ee7b7" }}
              >
                <Zap size={18} className="text-emerald-400 flex-shrink-0" />
                You&apos;re on the list! We&apos;ll notify you when Seasonal Pricing launches.
              </div>
            ) : (
              <form onSubmit={handleNotify} className="flex gap-2">
                <input
                  type="email"
                  placeholder="your@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="flex-1 rounded-xl px-4 py-3 text-sm text-white placeholder-white/25 outline-none"
                  style={{
                    background: "rgba(255,255,255,0.07)",
                    border: "1px solid rgba(255,255,255,0.12)",
                  }}
                />
                <button
                  type="submit"
                  className="flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-bold text-white transition-all duration-200"
                  style={{
                    background: "linear-gradient(135deg, #7c3aed, #6d28d9)",
                    boxShadow: "0 4px 18px rgba(124,58,237,0.4)",
                  }}
                >
                  <Bell size={15} />
                  Notify me
                </button>
              </form>
            )}
          </div>
        </section>

        {/* ── Season selector strip ──────────────────────────────── */}
        <section className="w-full flex flex-col items-center gap-6">
          <h2 className="text-2xl font-bold text-white">Seasons we&apos;re planning for</h2>
          <div className="flex gap-4 flex-wrap justify-center">
            {SEASONS.map((s, i) => {
              const Icon = s.icon;
              return (
                <div
                  key={s.label}
                  className="flex items-center gap-3 rounded-2xl px-6 py-4 cursor-default transition-all duration-300"
                  style={{
                    background: activeOrbit === i ? `${s.color}18` : "rgba(255,255,255,0.04)",
                    border: `1px solid ${activeOrbit === i ? s.color : "rgba(255,255,255,0.08)"}`,
                    boxShadow: activeOrbit === i ? `0 0 20px ${s.color}30` : "none",
                    transform: activeOrbit === i ? "scale(1.04)" : "scale(1)",
                    transition: "all 0.5s ease",
                  }}
                >
                  <Icon size={20} style={{ color: s.color }} />
                  <span className="font-bold text-sm text-white">{s.label}</span>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Planned Features Grid ─────────────────────────────── */}
        <section className="w-full flex flex-col gap-8">
          <div className="text-center">
            <h2 className="text-3xl font-extrabold text-white mb-3">What&apos;s Coming</h2>
            <p className="text-slate-400 text-base max-w-xl mx-auto">
              Six core capabilities that will make PriceIQ season-aware from end to end.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map((feat, i) => {
              const Icon = feat.icon;
              return (
                <div
                  key={feat.title}
                  onMouseEnter={() => setHoveredFeature(i)}
                  onMouseLeave={() => setHoveredFeature(null)}
                  className="rounded-2xl p-6 flex flex-col gap-4 cursor-default transition-all duration-300"
                  style={{
                    background: hoveredFeature === i ? `${feat.color}12` : "rgba(255,255,255,0.04)",
                    border: `1px solid ${hoveredFeature === i ? feat.color + "50" : "rgba(255,255,255,0.07)"}`,
                    boxShadow: hoveredFeature === i ? `0 8px 32px ${feat.color}25` : "none",
                    transform: hoveredFeature === i ? "translateY(-4px)" : "translateY(0)",
                  }}
                >
                  <div
                    className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: feat.bg, border: `1px solid ${feat.color}30` }}
                  >
                    <Icon size={22} style={{ color: feat.color }} />
                  </div>
                  <div>
                    <h3 className="font-bold text-white text-base mb-1.5">{feat.title}</h3>
                    <p className="text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.45)" }}>
                      {feat.desc}
                    </p>
                  </div>
                  <div
                    className="flex items-center gap-1.5 text-xs font-bold mt-auto"
                    style={{ color: feat.color }}
                  >
                    <ArrowRight size={13} />
                    In Development
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Progress indicator ──────────────────────────────────── */}
        <section
          className="w-full rounded-3xl p-8 flex flex-col items-center gap-6"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}
        >
          <div className="flex items-center gap-2">
            <BarChart3 size={20} style={{ color: "#a78bfa" }} />
            <h2 className="text-xl font-bold text-white">Development Progress</h2>
          </div>

          <div className="w-full max-w-xl flex flex-col gap-4">
            {[
              { label: "Backend Seasonal Models", pct: 72, color: "#7c3aed" },
              { label: "Festive Playbook Engine", pct: 45, color: "#f59e0b" },
              { label: "Bandit Warm-Start", pct: 30, color: "#22d3ee" },
              { label: "Frontend Season Dashboard", pct: 15, color: "#ec4899" },
            ].map(({ label, pct, color }) => (
              <div key={label} className="flex flex-col gap-1.5">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-semibold text-white">{label}</span>
                  <span className="text-xs font-bold" style={{ color }}>{pct}%</span>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.07)" }}>
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${pct}%`,
                      background: `linear-gradient(90deg, ${color}, ${color}99)`,
                      boxShadow: `0 0 10px ${color}60`,
                      animation: "progress-glow 3s ease-in-out infinite",
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* ── Keyframes ──────────────────────────────────────────────── */}
      <style>{`
        @keyframes float-p {
          from { transform: translateY(0) rotate(0deg); }
          to   { transform: translateY(-35px) rotate(180deg); }
        }
        @keyframes blob-pulse {
          0%, 100% { transform: translateX(-50%) scale(1); opacity: 0.8; }
          50%       { transform: translateX(-50%) scale(1.08); opacity: 1; }
        }
        @keyframes spin-slow {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes icon-breathe {
          0%, 100% { transform: scale(1); box-shadow: 0 0 50px rgba(124,58,237,0.5), 0 0 100px rgba(124,58,237,0.2); }
          50%       { transform: scale(1.06); box-shadow: 0 0 70px rgba(124,58,237,0.7), 0 0 130px rgba(124,58,237,0.35); }
        }
        @keyframes badge-glow {
          0%, 100% { box-shadow: 0 0 0px rgba(124,58,237,0.3); }
          50%       { box-shadow: 0 0 20px rgba(124,58,237,0.5); }
        }
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0; }
        }
        @keyframes progress-glow {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.75; }
        }
      `}</style>
    </div>
  );
}
