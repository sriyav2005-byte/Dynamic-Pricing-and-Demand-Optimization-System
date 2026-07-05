/**
 * app/agent/page.tsx — AI Agent Chat Interface
 * ===============================================
 * Conversational AI interface for shop owners.
 * Features chat bubbles, rich response cards, suggested questions,
 * and typing indicator animation.
 */

"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import {
  sendChatMessage,
  getAgentSuggestions,
  ChatResponse,
  SuggestedQuestion,
} from "@/lib/api";
import ChatBubble from "@/components/agent/ChatBubble";
import AgentResponseCard from "@/components/agent/AgentResponseCard";
import {
  Send,
  Bot,
  Sparkles,
  MessageSquare,
  Tag,
  Clock,
  BarChart3,
  HelpCircle,
  TrendingUp,
  AlertTriangle,
} from "lucide-react";

interface Message {
  id: string;
  role: "user" | "agent";
  content: string;
  timestamp: string;
  data?: unknown;
  dataType?: string | null;
  suggestions?: string[];
}

const iconMap: Record<string, React.ReactNode> = {
  tag: <Tag size={12} />,
  clock: <Clock size={12} />,
  chart: <BarChart3 size={12} />,
  help: <HelpCircle size={12} />,
  trending: <TrendingUp size={12} />,
  alert: <AlertTriangle size={12} />,
};

export default function AgentPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [suggestions, setSuggestions] = useState<SuggestedQuestion[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load suggestions + welcome message
  useEffect(() => {
    (async () => {
      try {
        const sug = await getAgentSuggestions();
        setSuggestions(sug);
      } catch (e) {
        console.error(e);
      }

      // Welcome message
      setMessages([
        {
          id: "welcome",
          role: "agent",
          content:
            "👋 **Hello! I'm your PriceIQ AI Assistant.**\n\n" +
            "I can help you with pricing decisions, discount strategies, " +
            "competitor analysis, and inventory management. " +
            "Ask me anything or pick a suggestion below!",
          timestamp: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
          suggestions: [
            "Which products should be discounted today?",
            "What products are at expiry risk?",
            "How does my pricing compare with competitors?",
          ],
        },
      ]);
    })();
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = useCallback(
    async (text?: string) => {
      const msg = (text || input).trim();
      if (!msg || sending) return;

      const time = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });

      // Add user message
      const userMsg: Message = {
        id: `user-${Date.now()}`,
        role: "user",
        content: msg,
        timestamp: time,
      };
      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setSending(true);

      try {
        const response: ChatResponse = await sendChatMessage(msg);

        const agentMsg: Message = {
          id: `agent-${Date.now()}`,
          role: "agent",
          content: response.response_text,
          timestamp: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
          data: response.data,
          dataType: response.data_type,
          suggestions: response.suggestions,
        };
        setMessages((prev) => [...prev, agentMsg]);
      } catch (e) {
        const errorMsg: Message = {
          id: `error-${Date.now()}`,
          role: "agent",
          content:
            "❌ Sorry, I encountered an error processing your request. " +
            "Please make sure the backend server is running and try again.",
          timestamp: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
        };
        setMessages((prev) => [...prev, errorMsg]);
      } finally {
        setSending(false);
        inputRef.current?.focus();
      }
    },
    [input, sending]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Get the latest suggestions from the last agent message
  const latestSuggestions =
    [...messages].reverse().find((m) => m.role === "agent" && m.suggestions?.length)
      ?.suggestions || [];

  return (
    <div className="flex flex-col h-screen bg-slate-50">
      {/* Header */}
      <div className="p-6 pb-4 border-b bg-white" style={{ borderColor: "rgba(0, 0, 0, 0.05)" }}>
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{
              background: "linear-gradient(135deg, #7c3aed, #22d3ee)",
              boxShadow: "0 0 20px rgba(124, 58, 237, 0.25)",
            }}
          >
            <Bot size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-slate-800 flex items-center gap-2">
              PriceIQ Agent
              <Sparkles size={16} className="text-[#22d3ee]" />
            </h1>
            <p className="text-xs font-semibold text-slate-400">
              AI-powered pricing advisor · Ask about pricing, inventory, and competitors
            </p>
          </div>
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-3">
        {messages.map((msg) => (
          <div key={msg.id}>
            <ChatBubble
              role={msg.role}
              content={msg.content}
              timestamp={msg.timestamp}
            />
            {msg.role === "agent" && msg.data && msg.dataType ? (
              <div className="ml-11">
                <AgentResponseCard
                  data={msg.data as Record<string, unknown> | unknown[]}
                  dataType={msg.dataType}
                />
              </div>
            ) : null}
          </div>
        ))}

        {/* Typing indicator */}
        {sending && (
          <div className="flex gap-3 mb-4">
            <div
              className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{
                background: "linear-gradient(135deg, #7c3aed, #22d3ee)",
              }}
            >
              <Bot size={14} className="text-white" />
            </div>
            <div
              className="rounded-2xl rounded-tl-md px-4 py-3"
              style={{
                background: "rgba(0, 0, 0, 0.02)",
                border: "1px solid rgba(0, 0, 0, 0.05)",
              }}
            >
              <div className="flex gap-1.5">
                <div
                  className="w-2 h-2 rounded-full animate-bounce"
                  style={{ background: "#7c3aed", animationDelay: "0ms" }}
                />
                <div
                  className="w-2 h-2 rounded-full animate-bounce"
                  style={{ background: "#8b5cf6", animationDelay: "150ms" }}
                />
                <div
                  className="w-2 h-2 rounded-full animate-bounce"
                  style={{ background: "#22d3ee", animationDelay: "300ms" }}
                />
              </div>
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* Suggestions */}
      {latestSuggestions.length > 0 && !sending && (
        <div className="px-6 pb-2">
          <div className="flex flex-wrap gap-2">
            {latestSuggestions.map((sug, i) => (
              <button
                key={i}
                onClick={() => handleSend(sug)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all hover:scale-[1.02] cursor-pointer"
                style={{
                  background: "rgba(124, 58, 237, 0.08)",
                  border: "1px solid rgba(124, 58, 237, 0.15)",
                  color: "#7c3aed",
                }}
              >
                <MessageSquare size={10} />
                {sug}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Quick Suggestions from API (initial) */}
      {messages.length <= 1 && suggestions.length > 0 && (
        <div className="px-6 pb-2">
          <div className="text-xs font-bold mb-2 text-slate-400 uppercase tracking-widest">
            SUGGESTED QUESTIONS
          </div>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((sug, i) => (
              <button
                key={i}
                onClick={() => handleSend(sug.text)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all hover:scale-[1.02] cursor-pointer shadow-sm"
                style={{
                  background:
                    sug.category === "urgent"
                      ? "rgba(239, 68, 68, 0.08)"
                      : "#ffffff",
                  border: `1px solid ${
                    sug.category === "urgent"
                      ? "rgba(239, 68, 68, 0.15)"
                      : "rgba(0, 0, 0, 0.06)"
                  }`,
                  color: sug.category === "urgent" ? "#ef4444" : "#475569",
                }}
              >
                {iconMap[sug.icon] || <MessageSquare size={10} />}
                {sug.text}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input Area */}
      <div className="p-4 border-t bg-white" style={{ borderColor: "rgba(0, 0, 0, 0.05)" }}>
        <div
          className="flex items-center gap-3 rounded-2xl px-4 py-3"
          style={{
            background: "#ffffff",
            border: "1px solid rgba(0, 0, 0, 0.08)",
          }}
        >
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about pricing, discounts, competitors, or inventory..."
            className="flex-1 bg-transparent outline-none text-sm text-slate-800 placeholder-slate-400"
            disabled={sending}
          />
          <button
            onClick={() => handleSend()}
            disabled={!input.trim() || sending}
            className="w-9 h-9 rounded-xl flex items-center justify-center transition-all"
            style={{
              background:
                input.trim() && !sending
                  ? "linear-gradient(135deg, #7c3aed, #22d3ee)"
                  : "rgba(0, 0, 0, 0.02)",
              cursor: input.trim() && !sending ? "pointer" : "not-allowed",
              opacity: input.trim() && !sending ? 1 : 0.5,
            }}
          >
            <Send size={14} className={input.trim() && !sending ? "text-white" : "text-slate-300"} />
          </button>
        </div>
        <div className="text-center mt-2.5">
          <span className="text-[10px] font-bold text-slate-400">
            Powered by PriceIQ ML Engine · Thompson Sampling + XGBoost
          </span>
        </div>
      </div>
    </div>
  );
}
