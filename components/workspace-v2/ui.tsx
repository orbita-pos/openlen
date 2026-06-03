// Shared UI primitives for workspace v2: Button, Segmented, Pill, StatusDot,
// Tooltip, IconBtn. Same surface as the artifact's d19fca88 asset, ported to
// TypeScript with React 19 typing.

"use client";

import type {
  ButtonHTMLAttributes,
  ComponentType,
  ReactNode,
} from "react";

interface TooltipProps {
  children: ReactNode;
  label: ReactNode;
  side?: "top" | "bottom" | "right";
  className?: string;
}

export function Tooltip({
  children,
  label,
  side = "bottom",
  className = "",
}: TooltipProps) {
  const sidePos =
    side === "top"
      ? "left-1/2 -translate-x-1/2 bottom-full mb-1.5"
      : side === "right"
        ? "left-full top-1/2 -translate-y-1/2 ml-1.5"
        : "left-1/2 -translate-x-1/2 top-full mt-1.5";
  return (
    <span className="relative inline-flex group">
      {children}
      <span
        className={`pointer-events-none absolute z-50 max-w-[200px] rounded-md border bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 dark:border-zinc-200/60 border-zinc-700/60 px-2 py-1 text-[11px] font-medium leading-snug opacity-0 transition group-hover:opacity-100 shadow-md ${sidePos} ${className}`}
      >
        {label}
      </span>
    </span>
  );
}

interface IconBtnProps {
  children: ReactNode;
  label: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function IconBtn({
  children,
  label,
  onClick,
  active = false,
  disabled = false,
  size = "md",
  className = "",
}: IconBtnProps) {
  const sizes = { sm: "h-7 w-7", md: "h-8 w-8", lg: "h-9 w-9" };
  return (
    <Tooltip label={label}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        className={`inline-flex ${sizes[size]} items-center justify-center rounded-md transition ${
          disabled
            ? "fg-faint opacity-40 cursor-not-allowed"
            : active
              ? "bg-[var(--accent-strong)] text-white"
              : "fg-muted hover:fg hover:bg-hover"
        } ${className}`}
      >
        {children}
      </button>
    </Tooltip>
  );
}

export type ButtonVariant =
  | "primary"
  | "ghost"
  | "outline"
  | "dark"
  | "accentSoft";

interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  className?: string;
  children: ReactNode;
  type?: ButtonHTMLAttributes<HTMLButtonElement>["type"];
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  const sizes = {
    sm: "h-7 px-2.5 text-[12px]",
    md: "h-8 px-3 text-[12.5px]",
    lg: "h-9 px-3.5 text-[13px]",
  };
  const variants: Record<ButtonVariant, string> = {
    primary:
      "bg-[var(--accent-strong)] text-white border border-[var(--accent)] hover:brightness-105 active:brightness-95 shadow-coral",
    ghost:
      "bg-transparent fg-muted border border-transparent hover:bg-hover hover:fg hover:border-[color:var(--border)]",
    outline:
      "bg-transparent fg border border-[color:var(--border)] hover:bg-hover hover:border-[color:var(--border-strong)]",
    dark: "bg-[var(--fg)] text-[var(--bg)] hover:opacity-90",
    accentSoft: "bg-accent-soft text-accent hover:brightness-95",
  };
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] disabled:opacity-50 disabled:cursor-not-allowed ${sizes[size]} ${variants[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Accessible name when the visual `label` is empty (icon-only option). */
  ariaLabel?: string;
  icon?: ComponentType<{ size?: number }>;
}

interface SegmentedProps<T extends string> {
  value: T;
  onChange: (next: T) => void;
  options: SegmentedOption<T>[];
  size?: "sm" | "md";
  className?: string;
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = "md",
  className = "",
}: SegmentedProps<T>) {
  const sizes = { sm: "h-7 text-[11.5px]", md: "h-8 text-[12.5px]" };
  return (
    <div
      className={`inline-flex items-center gap-0.5 rounded-lg bg-hover p-0.5 border border-[color:var(--border)] ${className}`}
    >
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-label={o.ariaLabel}
            aria-pressed={active}
            className={`inline-flex items-center gap-1.5 ${sizes[size]} px-2.5 rounded-md font-medium transition ${
              active ? "seg-active" : "fg-muted hover:fg"
            }`}
          >
            {o.icon && <o.icon size={13} />}
            {o.label && <span>{o.label}</span>}
          </button>
        );
      })}
    </div>
  );
}

export type PillVariant = "default" | "coral" | "green" | "amber" | "zinc";

interface PillProps {
  children: ReactNode;
  variant?: PillVariant;
  className?: string;
}

export function Pill({
  children,
  variant = "default",
  className = "",
}: PillProps) {
  const variants: Record<PillVariant, string> = {
    default: "bg-hover fg-muted border-[color:var(--border)]",
    coral:
      "bg-accent-soft text-accent border-[color:var(--accent)]/30",
    green:
      "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
    amber:
      "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
    zinc: "bg-zinc-500/10 fg-muted border-zinc-500/20",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-1.5 py-0.5 text-[10.5px] font-medium ui-small ${variants[variant]} ${className}`}
    >
      {children}
    </span>
  );
}

interface StatusDotProps {
  color: string;
  pulse?: boolean;
}

export function StatusDot({ color, pulse = false }: StatusDotProps) {
  return (
    <span className="relative inline-flex h-1.5 w-1.5">
      {pulse && (
        <span
          className="absolute inset-0 rounded-full animate-ping opacity-60"
          style={{ background: color }}
        />
      )}
      <span
        className="relative inline-flex h-1.5 w-1.5 rounded-full"
        style={{ background: color }}
      />
    </span>
  );
}
