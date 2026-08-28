"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter, Link } from "@/i18n/navigation";
import { useSession } from "next-auth/react";
import {
  ArrowUp,
  Crosshair,
  Image as ImageIcon,
  Loader2,
  Sparkles,
  Wand2,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { QUICK_PROMPTS } from "@/lib/quick-prompts";
import {
  GenerationBriefLimitFeedback,
  useGenerationBriefLimit,
} from "@/components/generation-brief-limit";

// ─────────────────────────────────────────────────────────────────────────────
// Hero prompt input — the homepage entry into AI generation. Mirrors the
// /new AI brief panel: same quick-prompts, same composer affordances.
//
// Submit, when signed in, routes to /new?mode=ai&brief=…&autostart=1 so the
// build kicks off on arrival. When signed out, a dialog asks the user to sign
// in first — the brief rides along via ?next= so nothing is lost.
// ─────────────────────────────────────────────────────────────────────────────

export function HeroPromptInput() {
  const t = useTranslations("marketing");
  const tp = useTranslations("panelsA");
  const router = useRouter();
  const { status } = useSession();
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const briefLimit = useGenerationBriefLimit({
    value,
    onValueChange: setValue,
  });

  // Auto-grow up to ~10 lines.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 240) + "px";
  }, [value]);

  // Match the /new brief panel — a real brief needs a little substance.
  const canSend = briefLimit.isValid;

  const target = `/new?mode=ai&brief=${encodeURIComponent(
    value.trim(),
  )}&autostart=1`;

  const submit = () => {
    if (!canSend || submitting || status === "loading") return;
    if (status === "authenticated") {
      setSubmitting(true);
      router.push(target);
    } else {
      setLoginOpen(true);
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
            onChange={briefLimit.onChange}
            onPaste={briefLimit.onPaste}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
            rows={2}
            placeholder={t("heroPrompt.placeholder")}
            maxLength={briefLimit.maxLength}
            aria-describedby={
              briefLimit.warningVisible ? briefLimit.feedbackId : undefined
            }
            className="block w-full resize-none bg-transparent text-[15px] leading-relaxed text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-500 dark:placeholder:text-zinc-500 focus:outline-none"
            style={{ minHeight: 56 }}
          />
        </div>

        <GenerationBriefLimitFeedback
          valueLength={value.length}
          state={briefLimit}
          warningText={tp("aiBrief.trimmed", { max: briefLimit.maxLength })}
          className="px-4 pb-1 text-[11px]"
          warningClassName="text-amber-600 dark:text-amber-400"
          counterClassName="text-zinc-500 dark:text-zinc-400"
        />

        <div className="flex items-center justify-between gap-2 px-2.5 pb-2.5 pt-1">
          <div className="flex items-center gap-0.5">
            {/* Editing affordances — a preview of what unlocks once the page
                exists, mirroring the /new brief panel. */}
            {[
              { Icon: ImageIcon, label: t("heroPrompt.tools.attachImage") },
              { Icon: Crosshair, label: t("heroPrompt.tools.scopeSection") },
              { Icon: Wand2, label: t("heroPrompt.tools.autofill") },
            ].map(({ Icon, label }) => (
              <button
                key={label}
                type="button"
                disabled
                title={t("heroPrompt.tools.titleSuffix", { label })}
                aria-label={t("heroPrompt.tools.ariaSuffix", { label })}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-300 dark:text-zinc-700 cursor-not-allowed"
              >
                <Icon size={15} />
              </button>
            ))}
            <span className="ml-1 inline-flex items-center gap-1.5 h-8 px-1.5 text-[11.5px] font-medium text-zinc-500 dark:text-zinc-400">
              <span className="relative inline-flex h-1.5 w-1.5">
                <span className="absolute inset-0 rounded-full bg-emerald-500 opacity-70 animate-ping" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
              {/* NUNCA EL NOMBRE DEL PROVEEDOR. Decía «Gemini 3.1 Pro» con este
                  mismo punto verde en vivo, y Gemini no corre en ninguna
                  superficie desde el 2026-08-28 — era un indicador de estado
                  afirmando un modelo apagado. Y estaba CABLEADO en inglés en un
                  producto de 10 idiomas, así que no se traducía. */}
              {t("heroPrompt.ready")}
            </span>
          </div>

          <button
            type="button"
            onClick={submit}
            disabled={!canSend || submitting || status === "loading"}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 h-9 rounded-lg text-[13px] font-medium transition",
              canSend
                ? "px-3.5 bg-coral-500 text-white hover:bg-coral-600 active:bg-coral-700 btn-coral-shadow disabled:opacity-80"
                : "w-9 bg-zinc-100 dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400 cursor-not-allowed",
            )}
            aria-label={t("heroPrompt.generate")}
          >
            {submitting ? (
              <Loader2 size={15} className="animate-spin" />
            ) : canSend ? (
              <>
                <Sparkles size={14} /> {t("heroPrompt.generate")}
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
        <span className="text-[11px] uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400 font-semibold mr-1">
          {t("heroPrompt.tryLabel")}
        </span>
        {QUICK_PROMPTS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => {
              briefLimit.replaceValue(p.prompt);
              taRef.current?.focus();
            }}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[12px] text-zinc-700 dark:text-zinc-300 ring-1 ring-zinc-200 dark:ring-zinc-800 bg-white/70 dark:bg-zinc-950/70 backdrop-blur hover:bg-white dark:hover:bg-zinc-900 hover:ring-zinc-300 dark:hover:ring-zinc-700 transition"
          >
            <Sparkles size={10} className="text-coral-500" />
            {p.label}
          </button>
        ))}
      </div>

      {loginOpen && (
        <SignInDialog next={target} onClose={() => setLoginOpen(false)} />
      )}
    </div>
  );
}

// Shown when a signed-out visitor hits Generate. The brief rides along in
// `next` so they land back in the workspace, generating, after auth.
function SignInDialog({
  next,
  onClose,
}: {
  next: string;
  onClose: () => void;
}) {
  const t = useTranslations("marketing");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const q = `?next=${encodeURIComponent(next)}`;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="signin-dialog-title"
    >
      <div
        className="absolute inset-0 bg-zinc-950/55 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div className="relative w-full max-w-sm rounded-2xl bg-white dark:bg-zinc-950 ring-1 ring-zinc-200 dark:ring-zinc-800 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.5)] p-6 text-center">
        <button
          type="button"
          onClick={onClose}
          aria-label={t("signInDialog.close")}
          className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-lg text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 dark:hover:text-zinc-200 dark:hover:bg-zinc-900 transition"
        >
          <X size={15} />
        </button>
        <div className="mx-auto mb-3.5 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-coral-500/10 text-coral-600 dark:text-coral-400">
          <Sparkles size={20} />
        </div>
        <h2
          id="signin-dialog-title"
          className="text-[17px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-100"
        >
          {t("signInDialog.title")}
        </h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-400">
          {t("signInDialog.body")}
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <Link
            href={`/register${q}`}
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-coral-500 text-white text-[13.5px] font-medium hover:bg-coral-600 active:bg-coral-700 btn-coral-shadow transition"
          >
            <Sparkles size={14} /> {t("signInDialog.createAccount")}
          </Link>
          <Link
            href={`/login${q}`}
            className="inline-flex h-10 items-center justify-center rounded-lg ring-1 ring-zinc-200 dark:ring-zinc-800 text-[13.5px] font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition"
          >
            {t("signInDialog.logIn")}
          </Link>
        </div>
      </div>
    </div>
  );
}
