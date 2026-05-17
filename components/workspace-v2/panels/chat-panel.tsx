// Chat mode panel — Inari Orchestra style chat composer over the page brief.
// Mocked round-trip simulates the future V3 pipeline conversation.

"use client";

import { useEffect, useRef, useState } from "react";
import { Paperclip, SendUp, Sparkles, Wand } from "../icons";
import { INITIAL_CHAT, type ChatMessage } from "../mock-data";
import { StatusDot } from "../ui";

export function ChatPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>(INITIAL_CHAT);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, thinking]);

  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

  const send = (textOverride?: string) => {
    const t = (textOverride ?? draft).trim();
    if (!t || thinking) return;
    setMessages((m) => [...m, { from: "me", at: "just now", text: t }]);
    setDraft("");
    setThinking(true);
    setTimeout(() => {
      setMessages((m) => [
        ...m,
        {
          from: "ai",
          at: "just now",
          text:
            "On it. Orchestra is regenerating the relevant sections. Streaming changes to the preview now…",
          action: "Re-routed to Kimi K2.6 · Qwen3-Coder",
        },
      ]);
      setThinking(false);
    }, 1400);
  };

  return (
    <div className="flex flex-col h-full">
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto nice-scroll px-3 py-3 space-y-3"
      >
        {messages.map((m, i) => (
          <div
            key={i}
            className={`flex gap-2 ${m.from === "me" ? "flex-row-reverse" : ""}`}
          >
            <span
              className={`shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold ${
                m.from === "ai"
                  ? "bg-[var(--accent)] text-white"
                  : "bg-gradient-to-br from-[#FF7E55] to-[#C72E10] text-white"
              }`}
            >
              {m.from === "ai" ? <Sparkles size={11} /> : "J"}
            </span>
            <div
              className={`min-w-0 max-w-[80%] ${m.from === "me" ? "text-right" : ""}`}
            >
              <div
                className={`inline-block rounded-2xl px-3 py-2 text-left ${
                  m.from === "ai"
                    ? "bg-elev border bd"
                    : "bg-accent-soft text-accent border border-[color:var(--accent)]/30"
                }`}
              >
                <div className="text-[12.5px] fg leading-relaxed">{m.text}</div>
                {m.action && (
                  <div className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-app border bd px-1.5 py-0.5 text-[10.5px] fg-faint ui-small">
                    <Wand size={10} className="text-[var(--accent)]" />{" "}
                    {m.action}
                  </div>
                )}
              </div>
              <div
                className={`mt-1 text-[10px] fg-faint tabular ui-small ${
                  m.from === "me" ? "pr-1" : "pl-1"
                }`}
              >
                {m.at}
              </div>
            </div>
          </div>
        ))}
        {thinking && (
          <div className="flex gap-2">
            <span className="shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent)] text-white">
              <Sparkles size={11} />
            </span>
            <div className="inline-flex items-center gap-1.5 rounded-2xl px-3 py-2.5 bg-elev border bd">
              <span
                className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] pulse-soft"
                style={{ animationDelay: "0ms" }}
              />
              <span
                className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] pulse-soft"
                style={{ animationDelay: "180ms" }}
              />
              <span
                className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] pulse-soft"
                style={{ animationDelay: "360ms" }}
              />
            </div>
          </div>
        )}
      </div>
      <div className="shrink-0 px-3 pb-3">
        <div className="rounded-xl border bd bg-elev focus-within:border-[color:var(--accent)] focus-within:ring-1 focus-within:ring-[color:var(--accent-ring)]/30 transition">
          <textarea
            ref={taRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            placeholder="Ask Orchestra to refine your page…"
            className="block w-full bg-transparent text-[12.5px] leading-relaxed px-3 pt-2.5 pb-1 fg placeholder:fg-faint focus:outline-none resize-none"
            style={{ minHeight: 32 }}
          />
          <div className="flex items-center justify-between px-1.5 pb-1.5 pt-0.5">
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                aria-label="Attach"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md fg-faint hover:fg hover:bg-hover transition"
              >
                <Paperclip size={13} />
              </button>
              <span className="inline-flex items-center gap-1 h-7 px-1.5 text-[10px] fg-faint ui-small">
                <StatusDot color="#10B981" pulse />
                <span>Orchestra · auto</span>
              </span>
            </div>
            <button
              type="button"
              onClick={() => send()}
              disabled={!draft.trim() || thinking}
              className={`inline-flex items-center justify-center gap-1 h-7 rounded-md text-[11.5px] font-medium transition ${
                draft.trim() && !thinking
                  ? "px-2.5 bg-[var(--accent)] text-white shadow-coral hover:brightness-105"
                  : "w-7 bg-hover fg-faint cursor-not-allowed"
              }`}
            >
              {draft.trim() && !thinking ? (
                <>
                  <SendUp size={12} /> <span>Send</span>
                </>
              ) : (
                <SendUp size={13} />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
