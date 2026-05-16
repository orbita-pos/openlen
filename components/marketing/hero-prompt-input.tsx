"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { ArrowUp, Globe, Lock, Paperclip, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";

// ─────────────────────────────────────────────────────────────────────────────
// Hero prompt input (v0 / Lovable style).
//
// Replaces the previous "Generate yours free / Star on GitHub" CTA pair with
// a chat-style textarea. Submit routes to:
//   - /new?brief=<text>             when the user is already signed in
//   - /register?next=/new?brief=…   otherwise (sign in via the link inside)
//
// The brief is carried through register so the user lands in the workspace
// with their idea pre-filled and just has to hit Generate.
// ─────────────────────────────────────────────────────────────────────────────

const SUGGESTED_PROMPTS = [
  "SaaS for freelance invoicing",
  "Designer portfolio in CDMX",
  "Coffee subscription",
  "Indie hacker conference",
];

export function HeroPromptInput() {
  const router = useRouter();
  const { status } = useSession();
  const [value, setValue] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow up to ~10 lines.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 240) + "px";
  }, [value]);

  const canSend = value.trim().length > 0;

  const submit = () => {
    if (!canSend || submitting) return;
    setSubmitting(true);
    const brief = value.trim();
    const target = `/new?brief=${encodeURIComponent(brief)}`;
    if (status === "authenticated") {
      router.push(target);
    } else {
      router.push(`/register?next=${encodeURIComponent(target)}`);
    }
  };

  return (
    <div className="relative">
      {/* soft coral glow under the input */}
      <div
        className="absolute -inset-x-8 -inset-y-4 -z-10 rounded-[28px] blur-2xl opacity-60 dark:opacity-80 bg-[radial-gradient(60%_50%_at_50%_50%,rgba(255,90,54,0.18)_0%,rgba(255,90,54,0)_70%)]"
        aria-hidden
      />

      <div className="group rounded-2xl bg-white dark:bg-zinc-950 ring-1 ring-zinc-200 dark:ring-zinc-800 shadow-[0_24px_60px_-30px_rgba(0,0,0,0.18)] dark:shadow-[0_30px_80px_-30px_rgba(0,0,0,0.7)] focus-within:ring-2 focus-within:ring-coral-500 transition">
        <div className="px-4 pt-3.5">
          <textarea
            ref={taRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
            rows={2}
            placeholder="Ask Inari to build a landing page for…"
            className="block w-full resize-none bg-transparent text-[15px] leading-relaxed text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none"
            style={{ minHeight: 56 }}
          />
        </div>

        <div className="flex items-center justify-between gap-2 px-2.5 pb-2.5 pt-1">
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled
              title="Attachments — coming soon"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 dark:text-zinc-600 cursor-not-allowed"
              aria-label="Attach a file (coming soon)"
            >
              <Paperclip size={15} />
            </button>
            <button
              type="button"
              onClick={() => setIsPublic((p) => !p)}
              className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-900 transition text-[12.5px]"
              title="Toggle visibility"
            >
              {isPublic ? <Globe size={13} /> : <Lock size={13} />}
              <span className="hidden sm:inline">{isPublic ? "Public" : "Private"}</span>
            </button>
            <span className="hidden md:inline h-4 w-px bg-zinc-200 dark:bg-zinc-800 mx-1" />
            <span className="hidden md:inline-flex items-center gap-1.5 h-8 px-2 rounded-lg text-[11.5px] font-medium text-zinc-500 dark:text-zinc-500">
              <span className="relative inline-flex h-1.5 w-1.5">
                <span className="absolute inset-0 rounded-full bg-emerald-500 opacity-70 animate-ping" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
              Inari Orchestra · auto-routing
            </span>
          </div>

          <button
            type="button"
            onClick={submit}
            disabled={!canSend || submitting}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 h-9 rounded-lg text-[13px] font-medium transition",
              canSend
                ? "px-3.5 bg-coral-500 text-white hover:bg-coral-600 active:bg-coral-700 btn-coral-shadow"
                : "w-9 bg-zinc-100 dark:bg-zinc-900 text-zinc-400 dark:text-zinc-600 cursor-not-allowed",
            )}
            aria-label="Generate"
          >
            {canSend ? (
              <>
                <Sparkles size={14} /> Generate
                <kbd className="ml-0.5 hidden sm:inline-flex items-center px-1 rounded text-[10px] font-mono bg-white/20 text-white/90">
                  ⌘↵
                </kbd>
              </>
            ) : (
              <ArrowUp size={15} />
            )}
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-center gap-1.5">
        <span className="text-[11px] uppercase tracking-[0.18em] text-zinc-400 dark:text-zinc-600 font-semibold mr-1">
          Try
        </span>
        {SUGGESTED_PROMPTS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => {
              setValue(p);
              taRef.current?.focus();
            }}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[12px] text-zinc-700 dark:text-zinc-300 ring-1 ring-zinc-200 dark:ring-zinc-800 bg-white/70 dark:bg-zinc-950/70 backdrop-blur hover:bg-white dark:hover:bg-zinc-900 hover:ring-zinc-300 dark:hover:ring-zinc-700 transition"
          >
            <Sparkles size={10} className="text-coral-500" />
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}
