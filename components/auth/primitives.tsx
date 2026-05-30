"use client";

import { forwardRef } from "react";
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
} from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, Check, Loader, X } from "lucide-react";
import { cn } from "@/lib/cn";

// ─────────────────────────────────────────────────────────────────────────────
// Auth-screen primitives — focused on the 4 auth pages, not used elsewhere.
// Keeps the workspace's UI library uncoupled from auth-specific styles.
// ─────────────────────────────────────────────────────────────────────────────

export interface AuthButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "dark" | "outline";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
}

export function AuthButton({
  children,
  variant = "primary",
  size = "md",
  className,
  loading,
  disabled,
  ...rest
}: AuthButtonProps) {
  const sizes: Record<string, string> = {
    sm: "h-9 px-3 text-sm",
    md: "h-10 px-4 text-sm",
    lg: "h-11 px-5 text-[14.5px]",
  };
  const variants: Record<string, string> = {
    primary:
      "bg-coral-500 text-white hover:bg-coral-600 active:bg-coral-700 btn-coral-shadow",
    dark:
      "bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white",
    outline:
      "bg-white text-zinc-900 ring-1 ring-zinc-200 hover:bg-zinc-50 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800 dark:hover:bg-zinc-900",
  };
  return (
    <button
      disabled={disabled || loading}
      className={cn(
        "relative inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-coral-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-950 disabled:opacity-60 disabled:cursor-not-allowed",
        sizes[size],
        variants[variant],
        className,
      )}
      {...rest}
    >
      {loading && <Loader size={16} className="animate-spin" />}
      {children}
    </button>
  );
}

export interface AuthInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: boolean;
  leftIcon?: ReactNode;
  rightSlot?: ReactNode;
}

export const AuthInput = forwardRef<HTMLInputElement, AuthInputProps>(
  function AuthInput(
    { label, hint, error, leftIcon, rightSlot, className, id, type = "text", ...rest },
    ref,
  ) {
    return (
      <div className="block">
        {label && (
          <label
            htmlFor={id}
            className="block text-[13px] font-medium text-zinc-900 dark:text-zinc-100 mb-1.5"
          >
            {label}
          </label>
        )}
        <div
          className={cn(
            "relative flex items-center rounded-lg bg-white dark:bg-[#0a0a0a] ring-1 transition-shadow",
            error
              ? "ring-red-500/70 focus-within:ring-2 focus-within:ring-red-500"
              : "ring-zinc-200 dark:ring-zinc-800 focus-within:ring-2 focus-within:ring-coral-500",
          )}
        >
          {leftIcon && <span className="pl-3 text-zinc-400">{leftIcon}</span>}
          <input
            id={id}
            ref={ref}
            type={type}
            className={cn(
              "w-full h-10 bg-transparent text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none",
              leftIcon ? "pl-2" : "pl-3",
              rightSlot ? "pr-2" : "pr-3",
              className,
            )}
            {...rest}
          />
          {rightSlot && <span className="pr-1.5">{rightSlot}</span>}
        </div>
        {hint && !error && (
          <p className="mt-1.5 text-[11px] text-zinc-500 dark:text-zinc-500">{hint}</p>
        )}
      </div>
    );
  },
);

export function AuthDivider({ children }: { children: ReactNode }) {
  return (
    <div className="relative my-1 flex items-center">
      <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-800" />
      <span className="px-3 text-[11px] uppercase tracking-[0.18em] text-zinc-400 dark:text-zinc-500">
        {children}
      </span>
      <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-800" />
    </div>
  );
}

export function ErrorBanner({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg bg-red-50 dark:bg-red-500/10 ring-1 ring-red-200 dark:ring-red-500/30 px-3 py-2.5 flex items-start gap-2.5 text-[13px] text-red-700 dark:text-red-300 lift">
      <AlertCircle size={15} className="shrink-0 mt-0.5" />
      <div className="leading-snug">{children}</div>
    </div>
  );
}

export function AuthCheckbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
}) {
  return (
    <label className="flex items-start gap-2.5 cursor-pointer group select-none">
      <span
        className={cn(
          "relative inline-flex h-4 w-4 items-center justify-center rounded-[5px] ring-1 transition mt-0.5",
          checked
            ? "bg-coral-500 ring-coral-500"
            : "bg-white dark:bg-[#0a0a0a] ring-zinc-300 dark:ring-zinc-700 group-hover:ring-zinc-400",
        )}
      >
        {checked && <Check size={11} strokeWidth={3} className="text-white" />}
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="absolute inset-0 opacity-0 cursor-pointer"
        />
      </span>
      <span className="text-[12.5px] leading-snug text-zinc-600 dark:text-zinc-400">
        {label}
      </span>
    </label>
  );
}

// Password strength scoring 0..3 (Weak / Okay / Strong / Very strong).
// -1 means "no password yet" → bar hidden.
export function scorePassword(pw: string): number {
  if (!pw) return -1;
  let s = 0;
  if (pw.length >= 8) s++;
  if (/\d/.test(pw) && /[a-zA-Z]/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  if (pw.length >= 14) s++;
  return Math.min(s, 3);
}

export function StrengthBar({ pw }: { pw: string }) {
  const t = useTranslations("auth");
  const s = scorePassword(pw);
  if (s < 0) return null;
  const labels = [
    t("strength.weak"),
    t("strength.okay"),
    t("strength.strong"),
    t("strength.veryStrong"),
  ];
  const colors = ["bg-red-500", "bg-amber-500", "bg-emerald-500", "bg-emerald-500"];
  return (
    <div className="mt-2 flex items-center gap-2">
      <div className="flex-1 grid grid-cols-4 gap-1">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={cn(
              "h-1 rounded-full transition-colors",
              i <= s ? colors[s] : "bg-zinc-200 dark:bg-zinc-800",
            )}
          />
        ))}
      </div>
      <span
        className={cn(
          "text-[11px] font-medium tabular-nums",
          s === 0
            ? "text-red-600 dark:text-red-400"
            : s === 1
              ? "text-amber-600 dark:text-amber-400"
              : "text-emerald-600 dark:text-emerald-400",
        )}
      >
        {labels[s]}
      </span>
    </div>
  );
}

export function Requirement({
  ok,
  children,
}: {
  ok: boolean;
  children: ReactNode;
}) {
  return (
    <li
      className={cn(
        "flex items-center gap-2 text-[12px] transition-colors",
        ok ? "text-emerald-700 dark:text-emerald-400" : "text-zinc-500 dark:text-zinc-500",
      )}
    >
      <span
        className={cn(
          "inline-flex h-3.5 w-3.5 items-center justify-center rounded-full ring-1 transition-colors",
          ok
            ? "bg-emerald-500 ring-emerald-500 text-white"
            : "bg-white dark:bg-[#0a0a0a] ring-zinc-300 dark:ring-zinc-700 text-zinc-400",
        )}
      >
        {ok ? (
          <Check size={9} strokeWidth={3} />
        ) : (
          <span className="h-1 w-1 rounded-full bg-zinc-300 dark:bg-zinc-700" />
        )}
      </span>
      <span>{children}</span>
    </li>
  );
}

export function MatchIndicator({
  match,
  mismatch,
}: {
  match: boolean;
  mismatch: boolean;
}) {
  const t = useTranslations("auth");
  if (match) {
    return (
      <span
        className="inline-flex items-center justify-center h-7 w-7 text-emerald-500"
        aria-label={t("reset.passwordsMatch")}
      >
        <Check size={15} strokeWidth={3} />
      </span>
    );
  }
  if (mismatch) {
    return (
      <span
        className="inline-flex items-center justify-center h-7 w-7 text-red-500"
        aria-label={t("reset.passwordsNoMatch")}
      >
        <X size={15} strokeWidth={2.5} />
      </span>
    );
  }
  return null;
}
