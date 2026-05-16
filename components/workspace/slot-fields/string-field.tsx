"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";
import type { StringFormField } from "@/lib/zod-to-form";

export interface StringFieldProps {
  field: StringFormField;
  value: string;
  onChange: (value: string) => void;
}

// Mirrors the regex in lib/gates/conversion.ts. The quality gate rejects these
// post-generation; surfacing the warning inline saves the user a regenerate
// cycle. Kept in sync manually — a shared constant would force every gate
// consumer through this module (overkill for a 1-line UI hint).
const BANNED_PHRASES_REGEX =
  /\b(world-class|cutting-edge|revolutionary|game-changing|leverage|unlock|supercharge|next-gen|reimagined|lorem ipsum|lorem)\b/i;
const FUTURE_OF_REGEX = /\bthe future of\s+\w+/i;

export function StringField({ field, value, onChange }: StringFieldProps) {
  const banned = detectBanned(value);
  const overMax =
    typeof field.maxLength === "number" && value.length > field.maxLength;
  const overMin =
    typeof field.minLength === "number" && value.length < field.minLength && value.length > 0;
  const patternMismatch =
    typeof field.pattern === "string" && value.length > 0 && !new RegExp(field.pattern).test(value);

  return (
    <div className="flex flex-col gap-1">
      {field.multiline ? (
        <AutoTextarea value={value} onChange={onChange} placeholder={field.label} />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.label}
          className="block w-full h-8 px-2.5 text-[13px] rounded-md bg-white dark:bg-[#0a0a0a] ring-1 ring-zinc-200 dark:ring-zinc-800 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-coral-500 transition-shadow"
        />
      )}
      {(field.maxLength || field.patternHint || banned || overMin || patternMismatch) && (
        <div className="flex items-center justify-between gap-2 text-[10.5px]">
          <span
            className={cn(
              "truncate",
              banned
                ? "text-red-600 dark:text-red-400 font-medium"
                : patternMismatch
                  ? "text-amber-600 dark:text-amber-400"
                  : overMin
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-zinc-400 dark:text-zinc-600",
            )}
          >
            {banned
              ? `"${banned}" is a banned phrase — try concrete copy that names the outcome`
              : patternMismatch
                ? (field.patternHint ?? `must match: ${field.pattern}`)
                : overMin
                  ? `min ${field.minLength} chars`
                  : (field.patternHint ?? "")}
          </span>
          {typeof field.maxLength === "number" && (
            <span
              className={cn(
                "tabular-nums shrink-0",
                overMax
                  ? "text-red-600 dark:text-red-400 font-medium"
                  : value.length > field.maxLength * 0.85
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-zinc-400 dark:text-zinc-600",
              )}
            >
              {value.length}/{field.maxLength}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// Returns the matched banned phrase (lowercased) or null.
function detectBanned(value: string): string | null {
  if (!value) return null;
  const m1 = value.match(BANNED_PHRASES_REGEX);
  if (m1) return m1[0].toLowerCase();
  const m2 = value.match(FUTURE_OF_REGEX);
  if (m2) return m2[0].toLowerCase();
  return null;
}

// Auto-growing textarea — saves the user a manual resize on long-form copy
// fields. The 32px min keeps the visual baseline matched to the single-line
// inputs above.
function AutoTextarea({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(32, el.scrollHeight)}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={1}
      className="block w-full min-h-[32px] px-2.5 py-1.5 text-[13px] leading-snug rounded-md bg-white dark:bg-[#0a0a0a] ring-1 ring-zinc-200 dark:ring-zinc-800 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-coral-500 transition-shadow resize-none"
    />
  );
}
