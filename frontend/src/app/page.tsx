"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  ArrowRight,
  Search,
  Bell,
  Settings,
  ChevronDown,
  Check,
  Plus,
  Bookmark,
  TrendingUp,
  FileText,
  Calendar,
  Layers,
  Sparkles,
  Play
} from "lucide-react";

export default function Home() {
  const router = useRouter();
  const [hoveredCard, setHoveredCard] = useState<number | null>(null);

  // Feature cards for "How It Works"
  const howItWorks = [
    {
      title: "Connect Store Inventory",
      description: "Sign up and connect your inventory in seconds. Import product data, baseline costs, and stock levels to initialize your pricing workspace.",
      step: 1
    },
    {
      title: "Scrape Competitor Feeds",
      description: "Sync live market pricing from Zepto, Blinkit, and BigBasket. Let our intelligence engine analyze competitors and establish boundaries.",
      step: 2
    },
    {
      title: "Optimize & Reprice",
      description: "Apply Thompson Sampling bandit recommendations with a single click. Maximize profit margins while staying highly competitive.",
      step: 3
    }
  ];

  // Product cards for "Top Optimized Products" (Featured Jobs equivalent)
  const products = [
    {
      brand: "Fresh & Co",
      logoBg: "bg-indigo-100 text-indigo-600",
      logoText: "FC",
      title: "Organic Whole Milk 1L",
      location: "Dairy Section",
      tags: ["Expiry Risk", "Zepto Match", "Volume Driver"],
      recommendedPrice: "$2.49",
      currentPrice: "$2.75",
      isHighlighted: true
    },
    {
      brand: "Morning Farm",
      logoBg: "bg-pink-100 text-pink-600",
      logoText: "MF",
      title: "Free-Range Eggs 12pk",
      location: "Breakfast Essentials",
      tags: ["High Margin", "Match Competitor"],
      recommendedPrice: "$3.89",
      currentPrice: "$3.99",
      isHighlighted: false
    },
    {
      brand: "BrewMaster",
      logoBg: "bg-emerald-100 text-emerald-600",
      logoText: "BM",
      title: "Premium Arabica Coffee 500g",
      location: "Beverages",
      tags: ["Price Inelastic", "Premium Tier"],
      recommendedPrice: "$12.99",
      currentPrice: "$11.99",
      isHighlighted: false
    },
    {
      brand: "Bakehouse",
      logoBg: "bg-blue-100 text-blue-600",
      logoText: "BH",
      title: "Sourdough Bread 600g",
      location: "Bakery",
      tags: ["Expiry Risk", "Instamart Match"],
      recommendedPrice: "$3.15",
      currentPrice: "$3.50",
      isHighlighted: false
    },
    {
      brand: "FizzCorp",
      logoBg: "bg-amber-100 text-amber-600",
      logoText: "FC",
      title: "Carbonated Soda 2L",
      location: "Beverages",
      tags: ["Elastic Demand", "Undercut Blinkit"],
      recommendedPrice: "$1.89",
      currentPrice: "$2.10",
      isHighlighted: false
    },
    {
      brand: "Gourmet",
      logoBg: "bg-red-100 text-red-600",
      logoText: "GM",
      title: "Greek Yogurt Honey 500g",
      location: "Dairy Section",
      tags: ["Bandit Explore", "High Demand"],
      recommendedPrice: "$4.25",
      currentPrice: "$4.50",
      isHighlighted: false
    }
  ];

  return (
    <div className="min-h-screen bg-[#f8f9fd] text-slate-900 font-sans selection:bg-violet-200 selection:text-violet-900 pb-20">
      
      {/* ─── NAVIGATION NAVBAR ────────────────────────────────────────── */}
      <div className="max-w-7xl mx-auto px-6 pt-6">
        <header className="flex items-center justify-between bg-white/80 backdrop-blur-md border border-slate-100 shadow-sm rounded-full py-3.5 px-8">
          {/* Logo */}
          <div className="flex items-center gap-2.5 cursor-pointer" onClick={() => router.push("/")}>
            <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-violet-600 to-indigo-500 flex items-center justify-center shadow-md shadow-violet-200">
              <span className="text-white font-bold text-base">P</span>
            </div>
            <span className="font-extrabold text-xl tracking-tight bg-gradient-to-r from-slate-900 via-indigo-950 to-violet-800 bg-clip-text text-transparent">PriceIQ</span>
          </div>

          {/* Nav Links */}
          <nav className="hidden md:flex items-center gap-8">
            <span className="text-sm font-semibold text-violet-600 cursor-pointer">Home</span>
            <span className="text-sm font-semibold text-slate-500 hover:text-slate-800 transition-colors cursor-pointer" onClick={() => router.push("/dashboard")}>Dashboard</span>
            <span className="text-sm font-semibold text-slate-500 hover:text-slate-800 transition-colors cursor-pointer" onClick={() => router.push("/products")}>Products</span>
            <span className="text-sm font-semibold text-slate-500 hover:text-slate-800 transition-colors cursor-pointer" onClick={() => router.push("/competitors")}>Competitors</span>
            <span className="text-sm font-semibold text-slate-500 hover:text-slate-800 transition-colors cursor-pointer" onClick={() => router.push("/forecasting")}>Forecasting</span>
            <span className="text-sm font-semibold text-slate-500 hover:text-slate-800 transition-colors cursor-pointer" onClick={() => router.push("/agent")}>AI Agent</span>
          </nav>

          {/* Action Button */}
          <button 
            onClick={() => router.push("/dashboard")}
            className="bg-gradient-to-r from-violet-600 to-[#9061f9] text-white font-semibold text-sm px-6 py-2.5 rounded-full shadow-[0_4px_14px_rgba(124,58,237,0.3)] hover:opacity-95 active:scale-[0.98] transition-all cursor-pointer"
          >
            Join With Us
          </button>
        </header>
      </div>

      {/* ─── HERO SECTION ────────────────────────────────────────────── */}
      <section className="max-w-7xl mx-auto px-6 pt-16 pb-12 flex flex-col items-center text-center relative">
        {/* Soft background glow circles */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[350px] bg-violet-200/35 rounded-full blur-[100px] pointer-events-none" />

        {/* Small capsule badge */}
        <div className="inline-flex items-center gap-1.5 px-4.5 py-1.5 rounded-full border border-violet-100 bg-violet-50 text-violet-600 text-xs font-semibold mb-6 shadow-sm">
          Intelligent pricing for growth
        </div>

        {/* Hero Title */}
        <h1 className="text-[2.75rem] md:text-[4rem] font-extrabold tracking-tight max-w-4xl text-slate-900 leading-[1.15] mb-6">
          Find Your <span className="text-violet-600">Optimal Prices</span> And <br />
          plan your profit future with us
        </h1>

        {/* Hero Subtitle */}
        <p className="text-slate-500 text-sm md:text-base max-w-2xl leading-relaxed mb-8">
          Connect with competitor feeds and explore thousands of optimization runs tailored to your stock and margin goals. Start your journey toward higher profitability today.
        </p>

        {/* CTA Buttons */}
        <div className="flex flex-col sm:flex-row items-center gap-4 mb-20 z-10">
          <button 
            onClick={() => router.push("/dashboard")}
            className="w-full sm:w-auto bg-gradient-to-r from-violet-600 to-[#9061f9] text-white font-bold text-sm px-8 py-3.5 rounded-full shadow-[0_6px_20px_rgba(124,58,237,0.35)] hover:shadow-[0_8px_24px_rgba(124,58,237,0.45)] hover:translate-y-[-1px] transition-all cursor-pointer"
          >
            Get Started
          </button>
          <button 
            onClick={() => router.push("/agent")}
            className="w-full sm:w-auto bg-white text-slate-700 font-bold text-sm px-8 py-3.5 rounded-full border border-slate-200/80 shadow-sm hover:bg-slate-50 transition-colors flex items-center justify-center gap-2 cursor-pointer"
          >
            <Play size={13} className="fill-slate-600 text-slate-600" />
            Learn More
          </button>
        </div>

        {/* Floating elements & Mockup wrapper */}
        <div className="w-full max-w-5xl relative">
          
          {/* Floating Card Left: Total Sales */}
          <div className="absolute left-[-2%] top-[10%] hidden lg:flex flex-col items-start bg-white rounded-2xl p-4.5 border border-slate-100 shadow-[0_12px_36px_rgba(0,0,0,0.06)] z-20 w-52 text-left animate-bounce" style={{ animationDuration: '4s' }}>
            <span className="text-slate-400 text-xs font-semibold mb-1">Total profit impact</span>
            <span className="text-slate-900 font-extrabold text-2xl mb-1">+140%</span>
            <div className="flex items-center gap-1 text-[11px] font-bold text-emerald-500 mb-3.5">
              <span className="inline-block translate-y-[-0.5px]">▲</span>
              <span>40% vs last month</span>
            </div>
            {/* Visual chart placeholder */}
            <div className="flex items-end gap-1.5 h-10 w-full pt-1">
              <div className="w-full bg-slate-100 rounded-sm h-[40%]" />
              <div className="w-full bg-slate-100 rounded-sm h-[60%]" />
              <div className="w-full bg-slate-100 rounded-sm h-[50%]" />
              <div className="w-full bg-emerald-400 rounded-sm h-[85%]" />
            </div>
          </div>

          {/* Floating Card Right: Competitiveness */}
          <div className="absolute right-[-4%] top-[30%] hidden lg:flex flex-col items-start bg-white rounded-2xl p-4.5 border border-slate-100 shadow-[0_12px_36px_rgba(0,0,0,0.06)] z-20 w-52 text-left animate-bounce animate-delay-1000" style={{ animationDuration: '4.5s', animationDelay: '0.8s' }}>
            <span className="text-slate-400 text-xs font-semibold mb-1">Competitiveness Score</span>
            <span className="text-slate-900 font-extrabold text-2xl mb-1">85%</span>
            <div className="flex items-center gap-1 text-[11px] font-bold text-violet-500 mb-3.5">
              <span className="inline-block translate-y-[-0.5px]">▲</span>
              <span>5% vs last month</span>
            </div>
            {/* Visual chart placeholder */}
            <div className="flex items-end gap-1.5 h-10 w-full pt-1">
              <div className="w-full bg-slate-100 rounded-sm h-[30%]" />
              <div className="w-full bg-slate-100 rounded-sm h-[45%]" />
              <div className="w-full bg-slate-100 rounded-sm h-[70%]" />
              <div className="w-full bg-violet-500 rounded-sm h-[90%]" />
            </div>
          </div>

          {/* Floating Avatar Tag: AI Agent */}
          <div className="absolute right-[2%] bottom-[2%] hidden lg:flex items-center gap-2 bg-[#7c3aed] text-white px-4 py-2 rounded-full shadow-lg shadow-violet-200 z-20 text-xs font-bold animate-pulse">
            <div className="w-2 h-2 rounded-full bg-white animate-ping" />
            <span>AI Agent Active</span>
          </div>

          {/* Device Mockup Wrapper */}
          <div className="bg-white rounded-3xl p-3 border border-slate-200/60 shadow-[0_24px_70px_rgba(0,0,0,0.08)] overflow-hidden">
            {/* Inner Dashboard Mockup Screen */}
            <div className="bg-slate-50 border border-slate-100 rounded-2xl overflow-hidden text-left flex h-[500px]">
              {/* Dashboard Side Navigation bar */}
              <div className="w-16 bg-white border-r border-slate-100 flex flex-col items-center py-6 gap-6">
                <div className="w-8 h-8 rounded-full bg-violet-600/10 flex items-center justify-center text-violet-600 font-extrabold text-sm mb-2">
                  P
                </div>
                {/* Simulated Icons */}
                <div className="w-8 h-8 rounded-lg bg-violet-50 text-violet-600 flex items-center justify-center">
                  <TrendingUp size={16} />
                </div>
                <div className="w-8 h-8 rounded-lg text-slate-400 flex items-center justify-center hover:bg-slate-50 hover:text-slate-600 transition-colors">
                  <Layers size={16} />
                </div>
                <div className="w-8 h-8 rounded-lg text-slate-400 flex items-center justify-center hover:bg-slate-50 hover:text-slate-600 transition-colors">
                  <Sparkles size={16} />
                </div>
              </div>

              {/* Dashboard Main Workspace */}
              <div className="flex-1 p-6 flex flex-col gap-6 overflow-hidden">
                {/* Top Toolbar */}
                <div className="flex justify-between items-center">
                  <div>
                    <h3 className="text-slate-900 font-bold text-lg">Good Morning, Alexandar</h3>
                    <p className="text-slate-400 text-[11px] font-medium">Here is the pricing status for today</p>
                  </div>
                  {/* Tools */}
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input 
                        type="text" 
                        placeholder="Search products..." 
                        className="bg-white border border-slate-100 rounded-full pl-9 pr-4 py-1.5 text-xs text-slate-700 w-52 shadow-sm focus:outline-none"
                        disabled
                      />
                    </div>
                    <div className="w-7 h-7 rounded-full bg-white border border-slate-100 flex items-center justify-center text-slate-400 shadow-sm">
                      <Settings size={13} />
                    </div>
                    <div className="w-7 h-7 rounded-full bg-white border border-slate-100 flex items-center justify-center text-slate-400 shadow-sm">
                      <Bell size={13} />
                    </div>
                    <div className="flex items-center gap-1.5 ml-1">
                      <div className="w-6.5 h-6.5 rounded-full bg-violet-600 flex items-center justify-center text-white font-bold text-[10px]">
                        AP
                      </div>
                      <span className="text-[11px] font-bold text-slate-700 hidden sm:inline">Alexandar Paul</span>
                    </div>
                  </div>
                </div>

                {/* Dashboard Grid layout */}
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-5 flex-1 overflow-hidden">
                  
                  {/* Left stats + Chart */}
                  <div className="lg:col-span-3 flex flex-col gap-5 overflow-hidden">
                    {/* Stats strip */}
                    <div className="grid grid-cols-3 gap-4">
                      {/* Metric 1 */}
                      <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
                        <span className="text-slate-400 text-[10px] font-bold uppercase tracking-wider block mb-1">Optimized Items</span>
                        <div className="flex items-baseline gap-2">
                          <span className="text-slate-900 font-extrabold text-lg">+140</span>
                          <span className="text-emerald-500 font-bold text-[10px] flex items-center">▲ 40%</span>
                        </div>
                        <span className="text-slate-400 text-[9px] mt-1 block">vs last month</span>
                      </div>
                      {/* Metric 2 */}
                      <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
                        <span className="text-slate-400 text-[10px] font-bold uppercase tracking-wider block mb-1">Scraped Competitors</span>
                        <div className="flex items-baseline gap-2">
                          <span className="text-slate-900 font-extrabold text-lg">+100</span>
                          <span className="text-violet-500 font-bold text-[10px] flex items-center">▲ 20%</span>
                        </div>
                        <span className="text-slate-400 text-[9px] mt-1 block">vs last month</span>
                      </div>
                      {/* Metric 3 */}
                      <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
                        <span className="text-slate-400 text-[10px] font-bold uppercase tracking-wider block mb-1">Profit Optimization</span>
                        <div className="flex items-baseline gap-2">
                          <span className="text-slate-900 font-extrabold text-lg">+20</span>
                          <span className="text-emerald-500 font-bold text-[10px] flex items-center">▲ 50%</span>
                        </div>
                        <span className="text-slate-400 text-[9px] mt-1 block">vs last month</span>
                      </div>
                    </div>

                    {/* Dashboard Chart Box */}
                    <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm flex-1 flex flex-col gap-4 overflow-hidden">
                      <div className="flex justify-between items-center">
                        <span className="text-slate-900 font-bold text-xs">Pricing Run & Demand Statistics</span>
                        <div className="flex items-center gap-3">
                          <span className="text-[10px] font-bold text-violet-500 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-violet-500" /> Revenue Sync</span>
                          <span className="text-[10px] font-bold text-amber-500 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> Bandit Decisions</span>
                          <span className="text-[9px] border border-slate-200 rounded-md px-1.5 py-0.5 text-slate-500 bg-slate-50 flex items-center gap-1 font-semibold cursor-pointer">Monthly <ChevronDown size={8} /></span>
                        </div>
                      </div>
                      {/* Chart visual representation matching Image 2 */}
                      <div className="flex-1 flex items-end justify-between px-2 pt-2 relative">
                        {/* Horizontal grid lines */}
                        <div className="absolute inset-x-0 bottom-0 border-b border-slate-100" />
                        <div className="absolute inset-x-0 bottom-1/4 border-b border-slate-100" />
                        <div className="absolute inset-x-0 bottom-2/4 border-b border-slate-100" />
                        <div className="absolute inset-x-0 bottom-3/4 border-b border-slate-100" />
                        
                        {/* Bars with rounded tops */}
                        <div className="flex flex-col items-center gap-1 flex-1">
                          <div className="w-5 bg-gradient-to-t from-violet-100 to-violet-300 rounded-t-full h-24" />
                          <span className="text-[8px] font-bold text-slate-400">Jan</span>
                        </div>
                        <div className="flex flex-col items-center gap-1 flex-1">
                          <div className="w-5 bg-gradient-to-t from-violet-100 to-violet-300 rounded-t-full h-16" />
                          <span className="text-[8px] font-bold text-slate-400">Feb</span>
                        </div>
                        <div className="flex flex-col items-center gap-1 flex-1">
                          <div className="w-5 bg-gradient-to-t from-violet-100 to-violet-300 rounded-t-full h-28" />
                          <span className="text-[8px] font-bold text-slate-400">Mar</span>
                        </div>
                        <div className="flex flex-col items-center gap-1 flex-1">
                          <div className="w-5 bg-gradient-to-t from-violet-100 to-violet-300 rounded-t-full h-20" />
                          <span className="text-[8px] font-bold text-slate-400">Apr</span>
                        </div>
                        <div className="flex flex-col items-center gap-1 flex-1 relative">
                          {/* Active Highlighted Bar */}
                          <div className="w-5 bg-gradient-to-t from-violet-500 to-violet-700 rounded-t-full h-40 relative shadow-md shadow-violet-200">
                            {/* Hover info box simulation */}
                            <div className="absolute top-[-35px] left-1/2 -translate-x-1/2 bg-slate-900 text-white rounded px-1.5 py-0.5 text-[8px] font-bold whitespace-nowrap shadow-md z-30">
                              Revenue Sync: 28 <br/> Bandit Decs: 24
                            </div>
                          </div>
                          <span className="text-[8px] font-bold text-slate-500">May</span>
                        </div>
                        <div className="flex flex-col items-center gap-1 flex-1">
                          <div className="w-5 bg-gradient-to-t from-violet-100 to-violet-300 rounded-t-full h-26" />
                          <span className="text-[8px] font-bold text-slate-400">Jun</span>
                        </div>
                        <div className="flex flex-col items-center gap-1 flex-1">
                          <div className="w-5 bg-gradient-to-t from-violet-100 to-violet-300 rounded-t-full h-32" />
                          <span className="text-[8px] font-bold text-slate-400">Jul</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Right side list column: Recommended Actions */}
                  <div className="bg-white border border-slate-100 rounded-2xl p-4.5 shadow-sm flex flex-col gap-4 overflow-hidden">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-900 font-bold text-xs">Recommended Jobs</span>
                      <span className="text-slate-400 cursor-pointer">···</span>
                    </div>
                    
                    {/* Simulated Job search input */}
                    <div className="relative">
                      <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input 
                        type="text" 
                        placeholder="Search alerts..." 
                        className="bg-slate-50 border border-slate-100 rounded-lg pl-7 pr-3 py-1.5 text-[10px] text-slate-700 w-full focus:outline-none"
                        disabled
                      />
                    </div>

                    {/* Job Card component mockup */}
                    <div className="bg-slate-50/50 border border-slate-100 rounded-xl p-3.5 flex flex-col gap-2.5">
                      <div className="flex justify-between items-start">
                        <div className="flex gap-2 items-center">
                          <div className="w-6.5 h-6.5 rounded-full bg-violet-100 flex items-center justify-center text-violet-600 text-[10px] font-bold">
                            G
                          </div>
                          <div>
                            <span className="text-slate-900 font-bold text-[11px] block">Google</span>
                            <span className="text-slate-400 text-[9px] block">Hanric Office</span>
                          </div>
                        </div>
                        <Bookmark size={10} className="text-slate-400" />
                      </div>
                      
                      <div>
                        <span className="text-slate-800 font-extrabold text-[12px] block">Lead UI/UX Designer</span>
                        <div className="flex gap-1.5 mt-1.5">
                          <span className="text-[8px] font-bold bg-white border border-slate-100 rounded text-slate-500 px-1 py-0.5">Full Time</span>
                          <span className="text-[8px] font-bold bg-white border border-slate-100 rounded text-slate-500 px-1 py-0.5">Remote</span>
                          <span className="text-[8px] font-bold bg-white border border-slate-100 rounded text-slate-500 px-1 py-0.5">Part Time</span>
                        </div>
                      </div>

                      <div className="flex justify-between items-center border-t border-slate-100/80 pt-2.5 mt-0.5">
                        <span className="text-slate-900 font-extrabold text-[11px]">$70K-$90K<span className="text-slate-400 font-semibold text-[8px]">/Year</span></span>
                        <button className="bg-slate-900 text-white rounded-lg px-3 py-1 text-[9px] font-bold hover:bg-slate-800 transition-colors">Apply</button>
                      </div>
                    </div>
                  </div>

                </div>
              </div>
            </div>
          </div>

        </div>
      </section>

      {/* ─── PARTNERS LOGOS SECTION (TRUSTED BY) ──────────────────────── */}
      <section className="max-w-7xl mx-auto px-6 py-10 text-center border-t border-slate-200/50">
        <h2 className="text-slate-400 font-bold text-xs uppercase tracking-widest mb-10">Trusted by 2000 companies</h2>
        <div className="flex flex-wrap items-center justify-center gap-x-12 gap-y-6 opacity-45">
          {/* coinbase */}
          <div className="flex items-center gap-1.5 text-slate-800 font-bold text-lg select-none">
            <div className="w-5 h-5 bg-slate-800 rounded flex items-center justify-center text-white font-black text-xs">c</div>
            coinbase
          </div>
          {/* Spotify */}
          <div className="flex items-center gap-1.5 text-slate-800 font-bold text-lg select-none">
            <span className="text-xl leading-none">🟢</span>
            Spotify
          </div>
          {/* slack */}
          <div className="flex items-center gap-1 text-slate-800 font-bold text-lg select-none">
            <span className="text-xl">🟨</span>
            slack
          </div>
          {/* Dropbox */}
          <div className="flex items-center gap-1.5 text-slate-800 font-bold text-lg select-none">
            <span>📦</span>
            Dropbox
          </div>
          {/* Webflow */}
          <div className="flex items-center gap-1 text-slate-800 font-extrabold text-lg select-none">
            <span>W</span>
            Webflow
          </div>
          {/* zoom */}
          <div className="flex items-center gap-1 text-slate-800 font-bold text-lg select-none">
            <span>📹</span>
            zoom
          </div>
        </div>
      </section>

      {/* ─── HOW IT WORKS SECTION ─────────────────────────────────────── */}
      <section className="max-w-7xl mx-auto px-6 py-24 text-center">
        {/* Small badge */}
        <div className="inline-flex px-4 py-1.5 rounded-full bg-violet-50 text-violet-600 text-[11px] font-bold mb-4 shadow-sm border border-violet-100">
          How it works
        </div>
        <h2 className="text-3xl md:text-[2.25rem] font-extrabold text-slate-900 mb-4 tracking-tight">How It Works</h2>
        <p className="text-slate-500 text-sm max-w-2xl mx-auto mb-16 leading-relaxed">
          Get started in three simple steps Getting started is quick, easy, and completely hassle-free. Just follow three simple steps.
        </p>

        {/* 3 Step columns with gradient borders */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {howItWorks.map((item, idx) => (
            <div 
              key={idx}
              className="bg-white rounded-3xl p-7 flex flex-col justify-between items-center text-center shadow-md shadow-slate-100 relative group transition-all duration-300 hover:shadow-xl hover:translate-y-[-2px] border border-slate-100"
            >
              {/* Top illustration block wrapper with gradient border effect */}
              <div className="w-full aspect-[4/3] rounded-2xl bg-slate-50 border border-slate-100 mb-6 flex items-center justify-center overflow-hidden relative">
                
                {/* Illustration elements based on images */}
                {idx === 0 && (
                  <div className="relative w-full h-full flex items-center justify-center">
                    {/* Circle avatar cluster */}
                    <div className="w-9 h-9 rounded-full bg-slate-200 border border-white absolute top-6 left-12" />
                    <div className="w-9 h-9 rounded-full bg-slate-300 border border-white absolute top-6 right-12" />
                    <div className="w-9 h-9 rounded-full bg-slate-200 border border-white absolute bottom-6 left-16" />
                    <div className="w-9 h-9 rounded-full bg-slate-300 border border-white absolute bottom-8 right-16" />
                    <div className="w-12 h-12 rounded-full bg-violet-600 text-white flex items-center justify-center font-bold text-sm z-10 border-2 border-white shadow-md">
                      Store
                    </div>
                    {/* Center connect line vectors simulated */}
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-20">
                      <div className="w-full border-t border-dashed border-slate-900" />
                      <div className="h-full border-l border-dashed border-slate-900" />
                    </div>
                    {/* Add bubble */}
                    <div className="absolute bottom-4 right-4 bg-white px-2.5 py-1 rounded-lg border border-slate-200/80 shadow-sm text-[10px] font-bold text-slate-800 flex items-center gap-1 cursor-pointer hover:border-violet-300">
                      <Plus size={10} className="text-violet-600" /> Add
                    </div>
                  </div>
                )}

                {idx === 1 && (
                  <div className="w-full h-full flex items-center justify-center p-6">
                    {/* Upload document widget */}
                    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm w-44 text-left flex flex-col gap-2">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-bold text-slate-700">Competitors List</span>
                        <span className="text-slate-400 text-[9px]">···</span>
                      </div>
                      <div className="h-0.5 bg-slate-100 rounded-full w-full" />
                      <div className="flex items-center gap-1 text-[9px] font-medium text-slate-500">
                        <Check size={8} className="text-emerald-500" />
                        Blinkit connected
                      </div>
                      <div className="flex items-center gap-1 text-[9px] font-medium text-slate-500">
                        <Check size={8} className="text-emerald-500" />
                        Zepto connected
                      </div>
                      <button className="bg-slate-100 rounded-lg text-slate-700 font-bold text-[9px] py-1 text-center w-full mt-1 border border-slate-200/50 hover:bg-slate-200/50 transition-colors">
                        Upload Custom Feed
                      </button>
                    </div>
                  </div>
                )}

                {idx === 2 && (
                  <div className="w-full h-full flex items-center justify-center relative">
                    {/* Apply price checkbox dashboard widget */}
                    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm w-40 text-left flex flex-col gap-2 relative z-10">
                      <div className="flex items-center gap-1 text-[10px] font-medium text-slate-700">
                        <span className="text-emerald-500">✔</span> Ingestion Complete
                      </div>
                      <div className="flex items-center gap-1 text-[10px] font-medium text-slate-700">
                        <span className="text-emerald-500">✔</span> XGBoost Forecast Done
                      </div>
                      <div className="flex items-center gap-1 text-[10px] font-medium text-slate-700">
                        <span className="text-emerald-500">✔</span> Bandit Optimized
                      </div>
                      <button className="bg-[#7c3aed] text-white rounded-lg font-bold text-[9px] py-1 text-center w-full mt-1 shadow-sm hover:opacity-95 transition-opacity">
                        Apply Now
                      </button>
                    </div>
                    {/* Floating icons around it */}
                    <div className="absolute top-4 left-6 w-7 h-7 bg-white rounded-full border border-slate-100 shadow-sm flex items-center justify-center text-xs">🚀</div>
                    <div className="absolute top-6 right-6 w-7 h-7 bg-white rounded-full border border-slate-100 shadow-sm flex items-center justify-center text-xs">💰</div>
                    <div className="absolute bottom-4 left-8 w-7 h-7 bg-white rounded-full border border-slate-100 shadow-sm flex items-center justify-center text-xs">⚡</div>
                  </div>
                )}

                {/* Violet to Orange gradient border wrapper lines around illustration border */}
                <div className="absolute inset-0 rounded-2xl pointer-events-none border-[1.5px] border-transparent group-hover:border-violet-600/35 transition-all duration-300" />
              </div>

              {/* Text descriptions */}
              <div className="w-full">
                <h3 className="text-slate-900 font-extrabold text-lg mb-2.5">{item.title}</h3>
                <p className="text-slate-500 text-xs leading-relaxed px-2">{item.description}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ─── TOP FEATURED PRODUCTS SECTION (FEATURED JOBS EQUIVALENT) ─── */}
      <section className="max-w-7xl mx-auto px-6 py-12 text-center">
        {/* Small badge */}
        <div className="inline-flex px-4 py-1.5 rounded-full bg-violet-50 text-violet-600 text-[11px] font-bold mb-4 shadow-sm border border-violet-100">
          Featured Products
        </div>
        <h2 className="text-3xl md:text-[2.25rem] font-extrabold text-slate-900 mb-4 tracking-tight">Top Optimized Products</h2>
        <p className="text-slate-500 text-sm max-w-2xl mx-auto mb-16 leading-relaxed">
          Explore the best pricing recommendations available today, showcasing how AI balances margins and volumes for top items.
        </p>

        {/* Product recommendations grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {products.map((p, idx) => (
            <div 
              key={idx}
              className={`rounded-3xl p-6 text-left flex flex-col justify-between transition-all duration-300 relative border ${
                p.isHighlighted 
                  ? "bg-white border-violet-600/60 shadow-[0_12px_40px_rgba(124,58,237,0.12)] scale-[1.01]" 
                  : "bg-white border-slate-200/50 shadow-md shadow-slate-100/50 hover:shadow-xl hover:border-slate-300"
              }`}
            >
              <div>
                {/* Card Top */}
                <div className="flex justify-between items-start mb-4">
                  <div className="flex gap-3 items-center">
                    <div className={`w-8.5 h-8.5 rounded-full flex items-center justify-center font-bold text-xs ${p.logoBg}`}>
                      {p.logoText}
                    </div>
                    <div>
                      <span className="text-slate-900 font-bold text-xs block">{p.brand}</span>
                      <span className="text-slate-400 text-[9.5px] block">{p.location}</span>
                    </div>
                  </div>
                  <Bookmark size={12} className={p.isHighlighted ? "text-violet-600" : "text-slate-400"} />
                </div>

                {/* Card Main Title */}
                <h3 className="text-slate-900 font-extrabold text-[15px] mb-2">{p.title}</h3>

                {/* Sub Badges */}
                <div className="flex flex-wrap gap-1.5 mb-5">
                  {p.tags.map((t, tid) => (
                    <span 
                      key={tid}
                      className="text-[9px] font-bold border rounded px-1.5 py-0.5"
                      style={{
                        background: p.isHighlighted ? "rgba(124,58,237,0.06)" : "white",
                        borderColor: p.isHighlighted ? "rgba(124,58,237,0.15)" : "#e2e8f0",
                        color: p.isHighlighted ? "#7c3aed" : "#64748b"
                      }}
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>

              {/* Card Footer with Price Sync */}
              <div className="flex justify-between items-center border-t border-slate-100/80 pt-4 mt-2">
                <div className="flex flex-col">
                  <span className="text-[14px] font-extrabold text-slate-900">
                    {p.recommendedPrice} 
                    <span className="text-slate-400 font-semibold text-[10px] line-through ml-1">{p.currentPrice}</span>
                  </span>
                  <span className="text-[8px] font-bold text-slate-400 uppercase tracking-wide mt-0.5">Rec Price</span>
                </div>
                
                <button 
                  onClick={() => router.push(`/product/${idx + 1}`)}
                  className={`px-4.5 py-2 rounded-xl text-[10px] font-bold transition-all ${
                    p.isHighlighted 
                      ? "bg-gradient-to-r from-violet-600 to-[#9061f9] text-white shadow-sm hover:opacity-95 active:scale-[0.98]" 
                      : "bg-slate-50 hover:bg-slate-100 text-slate-800 border border-slate-200/50"
                  }`}
                >
                  Apply {p.isHighlighted ? "→" : "→"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ─── WHY CHOOSE US / WHAT MAKES US DIFFERENT SECTION ─────────── */}
      <section className="max-w-7xl mx-auto px-6 py-24 grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
        
        {/* Left Column Text details */}
        <div className="text-left">
          <div className="inline-flex px-4 py-1.5 rounded-full bg-violet-50 text-violet-600 text-[11px] font-bold mb-4 shadow-sm border border-violet-100">
            Why Choose us
          </div>
          <h2 className="text-3xl md:text-[2.25rem] font-extrabold text-slate-900 mb-4 tracking-tight leading-tight">What Makes Us Different</h2>
          <p className="text-slate-500 text-sm mb-10 leading-relaxed">
            Get started in three simple steps Getting started is quick, easy, and completely hassle-free. Just follow three simple steps.
          </p>

          <div className="flex flex-col gap-6">
            <div className="flex gap-4 items-start">
              <div className="w-5 h-5 rounded-full bg-violet-100 flex items-center justify-center text-violet-600 text-xs shrink-0 mt-0.5">✓</div>
              <div>
                <h4 className="text-slate-900 font-bold text-sm mb-1">AI-Powered Pricing Recommendations</h4>
                <p className="text-slate-500 text-xs leading-relaxed">
                  Discover optimal pricing models tailored to demand elasticities, competitor moves, and current inventory shelf-life to minimize waste.
                </p>
              </div>
            </div>
            
            <div className="flex gap-4 items-start">
              <div className="w-5 h-5 rounded-full bg-violet-100 flex items-center justify-center text-violet-600 text-xs shrink-0 mt-0.5">✓</div>
              <div>
                <h4 className="text-slate-900 font-bold text-sm mb-1">Seamless One-Click Repricing</h4>
                <p className="text-slate-500 text-xs leading-relaxed">
                  Apply complex pricing rules and recommendations across catalog listings instantly without tedious manual spreadsheet updates.
                </p>
              </div>
            </div>

            <div className="flex gap-4 items-start">
              <div className="w-5 h-5 rounded-full bg-violet-100 flex items-center justify-center text-violet-600 text-xs shrink-0 mt-0.5">✓</div>
              <div>
                <h4 className="text-slate-900 font-bold text-sm mb-1">Real-Time Competitor Tracking</h4>
                <p className="text-slate-500 text-xs leading-relaxed">
                  Stay ahead with hourly updates scraped directly from competing apps like Zepto, Blinkit, and BigBasket to ensure price match guarantees.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column Floating widgets panel matching image 5 */}
        <div className="relative w-full aspect-[4/3] rounded-3xl bg-[#f2f1fb] flex items-center justify-center overflow-hidden p-6 border border-violet-100">
          {/* Subtle background graphics */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 bg-violet-200/50 rounded-full blur-3xl pointer-events-none" />

          {/* Grid layout inside illustration containing floating cards */}
          <div className="grid grid-cols-2 gap-4 w-full relative z-10">
            
            {/* Card A: Smart Matches */}
            <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-lg shadow-slate-200/40 text-left flex flex-col gap-2.5">
              <span className="text-[9px] font-bold text-slate-400 block uppercase tracking-wider">Smart Matches</span>
              <div className="flex justify-between items-center">
                <div className="flex gap-1.5 items-center">
                  <div className="w-6 h-6 rounded-full bg-slate-300" />
                  <div>
                    <span className="text-[9.5px] font-bold text-slate-800 block">Recommended</span>
                    <span className="text-[8px] text-slate-400 block">For you</span>
                  </div>
                </div>
                {/* 90% circular indicator */}
                <div className="w-6 h-6 rounded-full border-2 border-violet-500 border-r-transparent flex items-center justify-center text-[7px] font-bold text-violet-600">
                  90%
                </div>
              </div>
              <div className="border-t border-slate-100 pt-2.5 flex justify-between items-center">
                <span className="text-[10px] font-bold text-slate-800">UI/UX Designer</span>
                <span className="text-[8.5px] font-bold text-emerald-500 bg-emerald-50 px-1 py-0.5 rounded">94% score</span>
              </div>
            </div>

            {/* Card B: Application Sent */}
            <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-lg shadow-slate-200/40 text-left flex flex-col gap-2.5">
              <span className="text-[9px] font-bold text-slate-400 block uppercase tracking-wider">Application Sent</span>
              <div className="flex gap-2 items-center">
                <div className="w-7 h-7 bg-blue-50 text-blue-500 rounded flex items-center justify-center text-[10px] font-bold">
                  PDF
                </div>
                <div>
                  <span className="text-[9.5px] font-bold text-slate-800 block">Apyedut.pdf</span>
                  <span className="text-[7.5px] text-slate-400 block">Application Sent</span>
                </div>
              </div>
              <div className="bg-violet-600 text-white font-bold text-[8.5px] py-1.5 text-center rounded-lg shadow-sm">
                Application sent successfully
              </div>
            </div>

            {/* Card C: Hiring Progress */}
            <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-lg shadow-slate-200/40 text-left flex flex-col gap-2.5">
              <span className="text-[9px] font-bold text-slate-400 block uppercase tracking-wider">Hiring Progress</span>
              {/* Stepper timeline */}
              <div className="flex items-center justify-between gap-1 mt-2.5">
                <div className="flex flex-col items-center gap-1.5">
                  <div className="w-3.5 h-3.5 rounded-full bg-emerald-500 border-2 border-white text-white flex items-center justify-center text-[6px] font-bold shadow-sm">✔</div>
                  <span className="text-[7px] font-bold text-slate-400">Applied</span>
                </div>
                <div className="flex-1 h-0.5 bg-emerald-500 translate-y-[-5px]" />
                <div className="flex flex-col items-center gap-1.5">
                  <div className="w-3.5 h-3.5 rounded-full bg-violet-600 border-2 border-white flex items-center justify-center text-[6px] font-bold text-white shadow-sm">•</div>
                  <span className="text-[7px] font-bold text-slate-700">Interview</span>
                </div>
                <div className="flex-1 h-0.5 bg-slate-100 translate-y-[-5px]" />
                <div className="flex flex-col items-center gap-1.5">
                  <div className="w-3.5 h-3.5 rounded-full bg-slate-100 border-2 border-white flex items-center justify-center text-[6px] font-bold text-slate-400"></div>
                  <span className="text-[7px] font-bold text-slate-400">Hired</span>
                </div>
              </div>
            </div>

            {/* Card D: Interview Scheduled */}
            <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-lg shadow-slate-200/40 text-left flex flex-col gap-2">
              <span className="text-[9px] font-bold text-slate-400 block uppercase tracking-wider">Interview Scheduled</span>
              <div className="flex items-center gap-2 mt-1">
                <div className="w-7 h-7 bg-violet-50 text-violet-600 rounded-lg flex items-center justify-center">
                  <Calendar size={13} />
                </div>
                <div>
                  <span className="text-[9.5px] font-bold text-slate-800 block">Tomorrow</span>
                  <span className="text-[8px] text-slate-500 block">at 10:30 AM</span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 mt-1">
                <div className="w-4 h-4 rounded-full bg-violet-600 flex items-center justify-center text-white text-[7px] font-extrabold">H</div>
                <span className="text-[8px] font-bold text-slate-800">Hireup</span>
              </div>
            </div>

          </div>
        </div>

      </section>

    </div>
  );
}
