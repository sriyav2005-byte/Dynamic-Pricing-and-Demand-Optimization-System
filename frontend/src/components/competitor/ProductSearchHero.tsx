/**
 * components/competitor/ProductSearchHero.tsx
 * ============================================
 * Hero search bar for the Competitor Analysis page.
 *
 * Features
 * --------
 * - Animated cycling placeholder (rotates through product examples)
 * - Autocomplete dropdown filtered against curated product catalog
 * - Keyboard navigation (↑↓ arrows, Enter, Escape)
 * - "Popular searches" chip buttons for one-click searches
 * - Loading state with animated dots
 */

"use client";

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  KeyboardEvent,
} from "react";
import { Search, Sparkles, X, ChevronRight } from "lucide-react";
import { POPULAR_SEARCHES, AUTOCOMPLETE_CATALOG } from "@/lib/competitorsApi";

interface Props {
  onSearch: (query: string) => void;
  loading?: boolean;
  initialQuery?: string;
}

// Rotating placeholder examples
const PLACEHOLDER_CYCLE = [
  "Search any product, e.g. Amul Taaza Milk 1L",
  "Try: Tata Salt 1kg",
  "Try: Fortune Sunflower Oil 1L",
  "Try: Maggi Noodles 280g",
  "Try: Colgate Toothpaste 150g",
  "Try: Haldirams Bhujia 150g",
];

export default function ProductSearchHero({ onSearch, loading = false, initialQuery = "" }: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [highlightedIdx, setHighlightedIdx] = useState(-1);
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Cycle placeholder text every 2.5 s
  useEffect(() => {
    if (isFocused || query) return;
    const t = setInterval(() => {
      setPlaceholderIdx((i) => (i + 1) % PLACEHOLDER_CYCLE.length);
    }, 2500);
    return () => clearInterval(t);
  }, [isFocused, query]);

  // Filter autocomplete suggestions
  const handleInput = useCallback((val: string) => {
    setQuery(val);
    setHighlightedIdx(-1);
    if (!val.trim()) {
      setSuggestions([]);
      return;
    }
    const lower = val.toLowerCase();
    const filtered = AUTOCOMPLETE_CATALOG.filter((s) =>
      s.toLowerCase().includes(lower)
    ).slice(0, 8);
    setSuggestions(filtered);
  }, []);

  const submitSearch = useCallback(
    (q: string) => {
      if (!q.trim()) return;
      setQuery(q);
      setSuggestions([]);
      setHighlightedIdx(-1);
      onSearch(q.trim());
      inputRef.current?.blur();
    },
    [onSearch]
  );

  // Keyboard navigation
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!suggestions.length) {
      if (e.key === "Enter") submitSearch(query);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIdx((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIdx((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlightedIdx >= 0) {
        submitSearch(suggestions[highlightedIdx]);
      } else {
        submitSearch(query);
      }
    } else if (e.key === "Escape") {
      setSuggestions([]);
      setHighlightedIdx(-1);
    }
  };

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        !inputRef.current?.contains(e.target as Node)
      ) {
        setSuggestions([]);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="mb-8">
      {/* Hero title area */}
      <div className="text-center mb-6">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold mb-3"
          style={{ background: "rgba(124,58,237,0.08)", color: "#7c3aed", border: "1px solid rgba(124,58,237,0.15)" }}
        >
          <Sparkles size={11} />
          Real Product Search — 6 Platforms
        </div>
        <h2 className="text-2xl font-extrabold text-slate-900 mb-1">
          Compare Prices Instantly
        </h2>
        <p className="text-sm text-slate-500 font-medium">
          Search any real Indian grocery or FMCG product to compare estimated prices across Blinkit, Zepto,
          Swiggy Instamart, BigBasket, Amazon Fresh & Flipkart Minutes
        </p>
      </div>

      {/* Search box */}
      <div className="relative max-w-2xl mx-auto">
        <div
          className="flex items-center rounded-2xl overflow-hidden transition-all duration-200"
          style={{
            border: isFocused
              ? "2px solid #7c3aed"
              : "2px solid rgba(0,0,0,0.08)",
            boxShadow: isFocused
              ? "0 0 0 4px rgba(124,58,237,0.1), 0 8px 24px rgba(0,0,0,0.06)"
              : "0 4px 16px rgba(0,0,0,0.04)",
            background: "#fff",
          }}
        >
          {/* Search icon */}
          <div className="pl-4 pr-2 flex items-center flex-shrink-0">
            {loading ? (
              <div className="flex gap-0.5 items-center">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-bounce"
                    style={{ animationDelay: `${i * 100}ms` }}
                  />
                ))}
              </div>
            ) : (
              <Search size={18} className="text-violet-500" />
            )}
          </div>

          {/* Input */}
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder={PLACEHOLDER_CYCLE[placeholderIdx]}
            disabled={loading}
            className="flex-1 py-4 text-sm font-semibold text-slate-800 bg-transparent outline-none placeholder:text-slate-400 placeholder:font-normal disabled:opacity-50"
            id="competitor-search-input"
            autoComplete="off"
          />

          {/* Clear button */}
          {query && !loading && (
            <button
              type="button"
              onClick={() => { setQuery(""); setSuggestions([]); inputRef.current?.focus(); }}
              className="p-2 mr-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-colors cursor-pointer"
            >
              <X size={14} />
            </button>
          )}

          {/* Search button */}
          <button
            type="button"
            onClick={() => submitSearch(query)}
            disabled={loading || !query.trim()}
            className="mr-1.5 px-5 py-2.5 rounded-xl text-sm font-bold text-white transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: "linear-gradient(135deg,#7c3aed,#6d28d9)",
              boxShadow: "0 4px 12px rgba(124,58,237,0.3)",
            }}
            id="competitor-search-btn"
          >
            Search
          </button>
        </div>

        {/* Autocomplete dropdown */}
        {suggestions.length > 0 && (
          <div
            ref={dropdownRef}
            className="absolute top-full left-0 right-0 mt-1 bg-white rounded-2xl overflow-hidden z-50"
            style={{
              border: "1.5px solid rgba(124,58,237,0.15)",
              boxShadow: "0 12px 40px rgba(0,0,0,0.1)",
            }}
          >
            {suggestions.map((s, i) => (
              <button
                key={s}
                type="button"
                onMouseDown={() => submitSearch(s)}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors cursor-pointer"
                style={{
                  background:
                    i === highlightedIdx
                      ? "rgba(124,58,237,0.06)"
                      : "transparent",
                  color: i === highlightedIdx ? "#7c3aed" : "#334155",
                  fontWeight: i === highlightedIdx ? 700 : 500,
                }}
              >
                <Search size={13} className="text-slate-400 flex-shrink-0" />
                <span className="flex-1 truncate">{s}</span>
                <ChevronRight size={13} className="text-slate-300 flex-shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Popular searches chips */}
      <div className="flex flex-wrap justify-center gap-2 mt-4">
        <span className="text-xs text-slate-400 font-medium self-center">Popular:</span>
        {POPULAR_SEARCHES.slice(0, 8).map((ps) => (
          <button
            key={ps}
            type="button"
            onClick={() => submitSearch(ps)}
            disabled={loading}
            className="px-3 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer disabled:opacity-50 hover:scale-[1.04] active:scale-95"
            style={{
              background: "rgba(124,58,237,0.06)",
              border: "1px solid rgba(124,58,237,0.15)",
              color: "#6d28d9",
            }}
          >
            {ps}
          </button>
        ))}
      </div>
    </div>
  );
}
