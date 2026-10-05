"use client";

/** /agent — Retail Copilot: LLM with controlled tools over live store data + RAG policy knowledge. */

import { useEffect, useRef, useState } from "react";
import { Bot, BookOpen, MessageSquarePlus, Send, Wrench } from "lucide-react";
import { chat, ChatMessage, dateFmt, errorMessage, getConversation, getConversations } from "@/lib/api";
import { useApp } from "@/components/providers/AppProvider";
import { Notice, Pill, Spinner, useAsync } from "@/components/ui/kit";
import Markdown from "@/components/ui/Markdown";

const SUGGESTIONS = [
  "Which products may stock out?",
  "Which products are close to expiry?",
  "Which competitors are cheaper?",
  "Which products generated the most profit?",
  "Which products have high demand but low stock?",
  "Show my biggest pricing opportunities.",
  "What is the maximum price change allowed and why?",
];

export default function AgentPage() {
  const { storeId } = useApp();
  return <Copilot key={storeId} />;
}

function Copilot() {
  const { storeId, store } = useApp();
  const convs = useAsync(() => getConversations(storeId), [storeId]);
  const [convId, setConvId] = useState<string | undefined>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [meta, setMeta] = useState<{ mode: string; provider: string | null; model: string | null; warnings: string[] | null; factors: string[] | null } | null>(null);
  const [error, setError] = useState("");
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, busy]);

  async function open(id: string) {
    setConvId(id);
    setMeta(null);
    try { setMessages(await getConversation(storeId, id)); } catch (e) { setError(errorMessage(e)); }
  }

  async function send(text = input) {
    const msg = text.trim();
    if (!msg || busy) return;
    setInput("");
    setError("");
    setMessages((m) => [...m, { id: `tmp-${Date.now()}`, role: "user", content: msg, tool_calls: [], sources: [], created_at: new Date().toISOString() }]);
    setBusy(true);
    try {
      const r = await chat(storeId, msg, convId);
      setConvId(r.conversation_id);
      setMessages((m) => [...m, r.message]);
      setMeta({ mode: r.mode, provider: r.provider, model: r.model, warnings: r.warnings, factors: r.reasoning_factors });
      if (!convId) convs.reload();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <div className="flex h-[calc(100vh-7rem)] gap-6">
      <aside className="hidden w-64 shrink-0 flex-col rounded-2xl border border-slate-100 bg-white p-3 lg:flex">
        <button className="btn-primary mb-3" onClick={() => { setConvId(undefined); setMessages([]); setMeta(null); }}><MessageSquarePlus size={15} /> New conversation</button>
        <p className="px-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">History · {store?.store_name}</p>
        <div className="mt-1 flex-1 overflow-y-auto">
          {convs.data?.length === 0 && <p className="px-2 py-4 text-xs text-slate-400">No conversations yet.</p>}
          {convs.data?.map((c) => (
            <button key={c.id} onClick={() => open(c.id)} className={`block w-full rounded-lg px-2 py-2 text-left text-sm hover:bg-slate-50 ${convId === c.id ? "bg-violet-50 text-violet-800" : "text-slate-600"}`}>
              <p className="truncate">{c.title || "Conversation"}</p><p className="text-[10px] text-slate-400">{dateFmt(c.updated_at, true)}</p>
            </button>
          ))}
        </div>
      </aside>

      <section className="flex flex-1 flex-col rounded-2xl border border-slate-100 bg-white">
        <header className="flex items-center gap-3 border-b border-slate-100 px-5 py-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: "linear-gradient(135deg,#7c3aed,#22d3ee)" }}><Bot size={18} className="text-white" /></div>
          <div className="flex-1">
            <p className="font-semibold text-slate-800">Retail Copilot</p>
            <p className="text-xs text-slate-500">Answers from your store&apos;s live data through controlled tools, with your permissions. It cannot change prices or stock.</p>
          </div>
          {meta && <Pill tone={meta.mode === "llm" ? "violet" : "slate"}>{meta.mode === "llm" ? `LLM · ${meta.provider ?? ""} · ${meta.model ?? ""}` : meta.mode === "rule_based" ? "Rule-based fallback" : "error"}</Pill>}
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4" aria-live="polite">
          {messages.length === 0 && (
            <div className="mx-auto max-w-2xl py-8 text-center">
              <p className="text-lg font-semibold text-slate-700">Ask about pricing, stock, expiry, competitors or profits</p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => <button key={s} onClick={() => send(s)} className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1.5 text-sm text-violet-800 hover:bg-violet-100">{s}</button>)}
              </div>
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${m.role === "user" ? "bg-violet-600 text-white" : "border border-slate-100 bg-slate-50"}`}>
                {m.role === "user" ? <p className="whitespace-pre-wrap text-sm">{m.content}</p> : <Markdown text={m.content} />}
                {m.role === "assistant" && (m.tool_calls.length > 0 || m.sources.length > 0) && (
                  <details className="mt-2 text-xs text-slate-500">
                    <summary className="cursor-pointer select-none">Data used: {m.tool_calls.length} tool call(s){m.sources.length ? `, ${m.sources.length} policy document(s)` : ""}</summary>
                    <ul className="mt-1 space-y-0.5">
                      {m.tool_calls.map((t, i) => <li key={i} className="flex items-center gap-1"><Wrench size={11} /> <code>{t.tool}</code> {JSON.stringify(t.input) !== "{}" && <span className="truncate text-slate-400">{JSON.stringify(t.input)}</span>} {!t.ok && <span className="text-red-600">failed: {t.error}</span>}</li>)}
                      {m.sources.map((s, i) => <li key={`s${i}`} className="flex items-center gap-1"><BookOpen size={11} /> {s.title}</li>)}
                    </ul>
                  </details>
                )}
              </div>
            </div>
          ))}
          {busy && <div className="flex items-center gap-2 text-sm text-slate-500"><Spinner /> Looking up your store data…</div>}
          <div ref={end} />
        </div>

        {!!meta?.factors?.length && (
          <div className="px-5 pb-1 text-xs text-slate-500"><span className="font-medium text-slate-600">Key factors (last answer):</span> {meta.factors.join(" · ")}</div>
        )}
        {(error || meta?.warnings?.length) && (
          <div className="space-y-1 px-5">{error && <Notice tone="danger">{error}</Notice>}{meta?.warnings?.map((w, i) => <Notice key={i} tone="warning">{w}</Notice>)}</div>
        )}
        <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex gap-2 border-t border-slate-100 p-4">
          <input className="input flex-1" placeholder="e.g. Why was the price of Amul Butter recommended?" value={input} onChange={(e) => setInput(e.target.value)} maxLength={4000} aria-label="Message" />
          <button className="btn-primary" disabled={busy || !input.trim()} aria-label="Send"><Send size={15} /></button>
        </form>
      </section>
    </div>
  );
}
