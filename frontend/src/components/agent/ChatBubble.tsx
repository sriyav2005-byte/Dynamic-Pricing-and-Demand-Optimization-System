/**
 * components/agent/ChatBubble.tsx
 * ================================
 * Message bubble for the AI agent chat interface.
 * User messages appear on the right, agent messages on the left.
 */

"use client";

import { Bot, User } from "lucide-react";

interface Props {
  role: "user" | "agent";
  content: string;
  timestamp?: string;
}

export default function ChatBubble({ role, content, timestamp }: Props) {
  const isUser = role === "user";
  const boldColor = isUser ? "#ffffff" : "#7c3aed";

  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : "flex-row"} mb-4`}>
      {/* Avatar */}
      <div
        className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 mt-1"
        style={{
          background: isUser
            ? "rgba(124, 58, 237, 0.15)"
            : "linear-gradient(135deg, #7c3aed, #22d3ee)",
          boxShadow: isUser ? "none" : "0 0 16px rgba(124, 58, 237, 0.2)",
        }}
      >
        {isUser ? (
          <User size={14} style={{ color: "#7c3aed" }} />
        ) : (
          <Bot size={14} className="text-white" />
        )}
      </div>

      {/* Bubble */}
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
          isUser ? "rounded-tr-md" : "rounded-tl-md"
        }`}
        style={{
          background: isUser
            ? "linear-gradient(135deg, #7c3aed, #6d28d9)"
            : "#ffffff",
          border: isUser ? "none" : "1px solid rgba(0, 0, 0, 0.06)",
          color: isUser ? "#ffffff" : "#334155",
          boxShadow: isUser
            ? "0 4px 12px rgba(124, 58, 237, 0.15)"
            : "0 2px 6px rgba(0, 0, 0, 0.02)",
        }}
      >
        {/* Render markdown-like content */}
        <div
          className="agent-message"
          dangerouslySetInnerHTML={{
            __html: content
              .replace(/\*\*(.*?)\*\*/g, `<strong style="color:${boldColor}; font-weight: 700">$1</strong>`)
              .replace(/\n/g, "<br>")
              .replace(
                /\|(.+?)\|/g,
                (match) => `<span style="font-family:monospace;font-size:0.85em;background:rgba(0,0,0,0.05);padding:1px 4px;border-radius:4px">${match}</span>`
              ),
          }}
        />
        {timestamp && (
          <div
            className="text-[10px] mt-2 font-semibold tracking-wide"
            style={{ color: isUser ? "rgba(255, 255, 255, 0.7)" : "#94a3b8" }}
          >
            {timestamp}
          </div>
        )}
      </div>
    </div>
  );
}
