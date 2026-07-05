/**
 * app/product/[id]/page.tsx — Product Detail Page
 * =================================================
 * Deep-dive view for a single product.  Accessible by clicking any
 * product row on the Dashboard table (/product/{product_id}).
 *
 * Layout (3-column grid)
 * -----------------------
 * ┌──────────────────────────────────────────┬─────────────────────┐
 * │ 4 quick-stat cards (cost/mrp/stock/expiry)│                     │
 * │                                           │  PriceSimulator     │
 * │ AI Recommendation card                    │  (slider + what-if) │
 * │   current | recommended | expected profit │                     │
 * │   [Apply Recommendation] button           │  All Price Tiers    │
 * │                                           │  (bandit arms list) │
 * │ DemandPriceChart                          │                     │
 * │   demand & profit curves over 10 arms     │                     │
 * └──────────────────────────────────────────┴─────────────────────┘
 *
 * Apply Recommendation flow
 * --------------------------
 * 1. Calls POST /update-sales with recommended_price + expected_demand.
 * 2. Backend records the sale, updates product.current_price, and feeds
 *    the profit reward back to the Thompson Sampling bandit.
 * 3. Button shows a green "Applied Successfully!" for 3 seconds.
 *    (Data is NOT auto-refreshed here — user can click Back to see the
 *     updated row on the Dashboard.)
 *
 * Constraint badge
 * ----------------
 * If the recommendation was overridden by a pricing constraint, the
 * `constraint_applied` field is shown as an amber badge in the rec card:
 *   - "expiry discount" → product expiring soon, price forced down
 *   - "min margin"      → bandit tried to price below cost + 15%
 *   - "max increase"    → bandit tried to raise price by > 10%
 */
"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  getProduct,
  getRecommendation,
  Product,
  PriceRecommendation,
  updateSales,
} from "@/lib/api";
import DemandPriceChart from "@/components/charts/DemandPriceChart";
import PriceSimulator from "@/components/PriceSimulator";
import {
  ArrowLeft,
  Tag,
  Boxes,
  Calendar,
  TrendingUp,
  DollarSign,
  AlertTriangle,
  CheckCircle,
  Sparkles,
} from "lucide-react";

const fmt = (n: number) => `₹${n.toFixed(2)}`;

export default function ProductDetailPage() {
  // `id` comes from the dynamic route segment /product/[id]
  // useParams is the App Router hook for reading URL segments
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const productId = parseInt(id);

  const [product, setProduct] = useState<Product | null>(null);
  const [rec, setRec] = useState<PriceRecommendation | null>(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);

  // Load product data and recommendation in parallel on mount.
  // Re-runs if productId changes (e.g. browser back/forward navigation).
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        // Both requests are independent so fire them together for speed
        const [p, r] = await Promise.all([
          getProduct(productId),
          getRecommendation(productId),
        ]);
        setProduct(p);
        setRec(r);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [productId]);

  /**
   * Apply the AI recommendation by recording a sale at the recommended price.
   * This is the key action that closes the ML feedback loop:
   *   recommend → apply → record sale → update bandit → better future recs
   *
   * `applied` flag shows a success state for 3 seconds then resets,
   * matching the mental model that the action is a one-time confirmation.
   */
  const handleApply = async () => {
    if (!rec || !product) return;
    setApplying(true);
    try {
      await updateSales({
        product_id: product.product_id,
        price: rec.recommended_price,
        units_sold: Math.round(rec.expected_demand),
      });
      setApplied(true);
      setTimeout(() => setApplied(false), 3000);
    } finally {
      setApplying(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="w-12 h-12 border-2 border-violet-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm text-slate-400 font-medium">Loading product details...</p>
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="p-8 text-center">
        <p className="text-red-500 font-bold">Product not found</p>
        <button onClick={() => router.back()} className="mt-4 text-violet-600 font-bold hover:underline cursor-pointer">Go back</button>
      </div>
    );
  }

  // Derived display values used in multiple places below
  const margin = ((product.current_price - product.cost_price) / product.cost_price) * 100;
  const isExpiring = product.days_to_expiry < 7;  // triggers red alert banner + red expiry badge

  return (
    <div className="p-8">
      {/* Back */}
      <button
        onClick={() => router.back()}
        className="flex items-center gap-2 text-sm mb-6 transition-colors text-slate-400 hover:text-violet-600 font-semibold cursor-pointer"
      >
        <ArrowLeft size={16} />
        Back to Dashboard
      </button>

      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center text-sm font-bold"
              style={{ background: "rgba(124,58,237,0.08)", border: "1px solid rgba(124,58,237,0.15)", color: "#7c3aed" }}
            >
              #{product.product_id}
            </div>
            <div>
              <h1 className="text-2xl font-extrabold text-slate-900">Product {product.product_id}</h1>
              <span className="badge badge-blue capitalize">{product.category}</span>
            </div>
          </div>
        </div>
        {isExpiring && (
          <div className="flex items-center gap-2 px-4 py-2 rounded-xl"
            style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.15)", color: "#ef4444" }}>
            <AlertTriangle size={16} />
            <span className="text-sm font-semibold">Expiring in {product.days_to_expiry} days</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Left — info + recommendation */}
        <div className="col-span-2 space-y-6">
          {/* Stats row */}
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: "Cost Price", value: fmt(product.cost_price), icon: DollarSign, color: "#7c3aed" },
              { label: "MRP", value: fmt(product.mrp), icon: Tag, color: "#22d3ee" },
              { label: "Stock Level", value: product.stock_level, icon: Boxes, color: product.stock_level < 30 ? "#ef4444" : "#10b981" },
              { label: "Days to Expiry", value: `${product.days_to_expiry}d`, icon: Calendar, color: isExpiring ? "#ef4444" : "#10b981" },
            ].map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="bg-white border border-slate-200/60 rounded-2xl p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-3">
                  <Icon size={15} style={{ color }} />
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">{label}</span>
                </div>
                <div className="text-lg font-extrabold text-slate-800">{value}</div>
              </div>
            ))}
          </div>

          {/* Recommendation Card */}
          {rec && (
            <div className="bg-white border border-slate-200/60 rounded-2xl p-6 shadow-sm" style={{ borderColor: "rgba(124,58,237,0.25)" }}>
              <div className="flex items-center gap-2 mb-5">
                <Sparkles size={18} className="text-cyan-600" />
                <h2 className="font-extrabold text-slate-800 text-base">AI Price Recommendation</h2>
                {rec.constraint_applied && (
                  <span className="badge badge-amber ml-auto">{rec.constraint_applied.replace("_", " ")}</span>
                )}
              </div>

              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="bg-slate-50 border border-slate-100 rounded-xl p-4">
                  <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Current Price</div>
                  <div className="text-2xl font-extrabold text-slate-800">{fmt(rec.current_price)}</div>
                  <div className="text-xs font-semibold text-slate-500 mt-1">Margin: {margin.toFixed(1)}%</div>
                </div>
                <div className="rounded-xl p-4" style={{ background: "rgba(124,58,237,0.08)", border: "1px solid rgba(124,58,237,0.18)" }}>
                  <div className="text-xs font-bold text-violet-650 uppercase tracking-wider mb-1">Recommended Price</div>
                  <div className="text-2xl font-bold gradient-text">{fmt(rec.recommended_price)}</div>
                </div>
                <div className="bg-slate-50 border border-slate-100 rounded-xl p-4">
                  <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Expected Profit</div>
                  <div className="text-2xl font-bold text-emerald-600">₹{rec.expected_profit.toFixed(0)}</div>
                  <div className="text-xs font-semibold text-slate-500 mt-1">Demand: {rec.expected_demand.toFixed(1)} units</div>
                </div>
              </div>

              <button
                onClick={handleApply}
                disabled={applying || applied}
                className="glow-btn px-6 py-3 rounded-xl font-semibold text-white text-sm flex items-center gap-2 cursor-pointer"
              >
                {applied ? (
                  <><CheckCircle size={16} />Applied Successfully!</>
                ) : applying ? (
                  <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Applying...</>
                ) : (
                  <><TrendingUp size={16} />Apply Recommendation</>
                )}
              </button>
            </div>
          )}

          {/* Demand vs Price Chart */}
          {rec && (
            <div className="bg-white border border-slate-200/60 rounded-2xl p-6 shadow-sm">
              <h2 className="font-extrabold text-slate-800 mb-4 text-base">Demand & Profit vs Price</h2>
              <DemandPriceChart
                options={rec.price_options}
                currentPrice={rec.current_price}
                recommendedPrice={rec.recommended_price}
                costPrice={product.cost_price}
              />
              <div className="flex gap-4 mt-3 text-xs font-semibold text-slate-400">
                <div className="flex items-center gap-1.5"><div className="w-3 h-0.5 rounded" style={{ background: "#f59e0b" }} /> Current price</div>
                <div className="flex items-center gap-1.5"><div className="w-3 h-0.5 rounded" style={{ background: "#10b981" }} /> Recommended</div>
                <div className="flex items-center gap-1.5"><div className="w-3 h-0.5 rounded" style={{ background: "#7c3aed" }} /> Demand</div>
                <div className="flex items-center gap-1.5"><div className="w-3 h-0.5 rounded" style={{ background: "#22d3ee" }} /> Profit</div>
              </div>
            </div>
          )}
        </div>

        {/* Right — simulator */}
        <div>
          <PriceSimulator
            productId={product.product_id}
            costPrice={product.cost_price}
            mrp={product.mrp}
            currentPrice={product.current_price}
          />

          {/*
           * Price Tiers table — lists all 10 bandit arms.
           * The selected recommendation arm is highlighted with an indigo
           * border and a ★ marker.  Shows price, profit, and demand per arm
           * so managers can see the full pricing landscape at a glance.
           */}
          {rec && (
            <div className="bg-white border border-slate-200/60 rounded-2xl p-4 mt-4 shadow-sm">
              <h3 className="text-sm font-bold text-slate-800 mb-3">All Price Tiers (Bandit)</h3>
              <div className="space-y-2">
                {rec.price_options.map((opt) => {
                  const isRec = Math.abs(opt.price - rec.recommended_price) < 0.01;
                  return (
                    <div key={opt.arm}
                      className="flex items-center justify-between px-3 py-2 rounded-xl text-xs"
                      style={{
                        background: isRec ? "rgba(124, 58, 237, 0.08)" : "rgba(0,0,0,0.015)",
                        border: `1px solid ${isRec ? "rgba(124, 58, 237, 0.18)" : "rgba(0,0,0,0.04)"}`,
                      }}
                    >
                      <span className="font-semibold" style={{ color: isRec ? "#7c3aed" : "#475569" }}>
                        {fmt(opt.price)}
                        {isRec && " ★"}
                      </span>
                      <span className="font-bold text-emerald-600">₹{opt.predicted_profit.toFixed(0)}</span>
                      <span className="text-slate-500 font-medium">~{opt.predicted_demand.toFixed(0)} units</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
