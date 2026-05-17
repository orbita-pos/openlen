// Shared primitive helpers. Server-renderable. No "use client".
//
// `Slot` is the integration point with Session 12's inline editor: when
// rendered, it emits a `<span data-slot-path={path}>` that `public/iframe-editor.js`
// picks up for click-to-edit. Outside the workspace iframe the same span
// is just a span, no JS attached, no behavior — the published HTML stays
// clean (the publish path's defensive assertion would catch the attr
// leaking, but we render through the editor context everywhere it lives).
//
// Ported from claude.ai layout-primitives _shared.jsx (May 2026).

import type { CSSProperties, ElementType, ReactNode } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Slot — placeholder for `<EditableText>`. The real EditableText (server-
// renderable, context-driven, ships in lib/blocks/_editable.tsx) is the
// production wrapper. Slot here renders the same data-slot-path span so
// iframe-editor.js can find it. When V3 is wired into the workspace, the
// renderer flips slots on/off via context (see lib/orchestrator/v3/render.ts).
// ─────────────────────────────────────────────────────────────────────────────

export interface SlotProps {
  path: string;
  children: ReactNode;
  as?: ElementType;
  className?: string;
  style?: CSSProperties;
}

export function Slot({ path, children, as: As = "span", className, style }: SlotProps) {
  const Tag = As;
  return (
    <Tag data-slot-path={path} className={className} style={style}>
      {children}
    </Tag>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Buttons
// ─────────────────────────────────────────────────────────────────────────────

export type BtnVariant = "primary" | "secondary" | "inverse";

export interface BtnProps {
  href?: string;
  variant?: BtnVariant;
  children: ReactNode;
  className?: string;
}

export function Btn({ href = "#", variant = "primary", children, className = "" }: BtnProps) {
  const base =
    "inline-flex items-center justify-center gap-2 h-11 px-5 rounded-[10px] text-[15px] font-medium tracking-[-0.005em] transition-colors focus-ring whitespace-nowrap";
  if (variant === "primary") {
    return (
      <a
        href={href}
        className={`${base} ${className}`}
        style={{ background: "var(--color-accent)", color: "var(--color-accent-fg)" }}
      >
        {children}
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M3.5 8h9m0 0L8.5 4m4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </a>
    );
  }
  if (variant === "secondary") {
    return (
      <a
        href={href}
        className={`${base} ${className}`}
        style={{
          background: "transparent",
          color: "var(--color-fg)",
          boxShadow: "inset 0 0 0 1px var(--color-border-strong)",
        }}
      >
        {children}
      </a>
    );
  }
  return (
    <a
      href={href}
      className={`${base} ${className}`}
      style={{ background: "var(--color-fg)", color: "var(--color-bg)" }}
    >
      {children}
    </a>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Eyebrow — small uppercase chip with a leading dot
// ─────────────────────────────────────────────────────────────────────────────

export interface EyebrowProps {
  children: ReactNode;
  path?: string;
  tone?: "default" | "onAccent";
}

export function Eyebrow({ children, path, tone = "default" }: EyebrowProps) {
  return (
    <div
      className="inline-flex items-center gap-2 h-7 px-3 rounded-full text-[11px] uppercase tracking-[0.14em] font-medium"
      style={{
        color: tone === "onAccent" ? "var(--color-accent-fg)" : "var(--color-text-muted)",
        background: tone === "onAccent" ? "oklch(1 0 0 / 0.14)" : "var(--color-surface)",
        boxShadow:
          tone === "onAccent"
            ? "inset 0 0 0 1px oklch(1 0 0 / 0.2)"
            : "inset 0 0 0 1px var(--color-border)",
      }}
    >
      <span
        className="block w-1.5 h-1.5 rounded-full"
        style={{ background: tone === "onAccent" ? "var(--color-accent-fg)" : "var(--color-accent)" }}
      />
      {path ? <Slot path={path}>{children}</Slot> : children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section header (eyebrow + title + sub)
// ─────────────────────────────────────────────────────────────────────────────

export interface SectionHeadProps {
  id: string;
  eyebrow?: string;
  title?: string;
  sub?: string;
  align?: "left" | "center";
}

export function SectionHead({ id, eyebrow, title, sub, align = "left" }: SectionHeadProps) {
  const a = align === "center" ? "text-center mx-auto" : "";
  return (
    <header className={`max-w-[44rem] ${a}`}>
      {eyebrow && (
        <div className={align === "center" ? "flex justify-center" : ""}>
          <Eyebrow path={`${id}.eyebrow`}>{eyebrow}</Eyebrow>
        </div>
      )}
      {title && (
        <h2
          className="mt-5 font-display text-[44px] md:text-[56px] leading-[1.02] tracking-[-0.02em] text-balance"
          style={{ color: "var(--color-fg)" }}
        >
          <Slot path={`${id}.title`}>{title}</Slot>
        </h2>
      )}
      {sub && (
        <p
          className="mt-5 text-[17px] leading-[1.55] max-w-prose text-pretty"
          style={{ color: "var(--color-text-muted)" }}
        >
          <Slot path={`${id}.sub`}>{sub}</Slot>
        </p>
      )}
    </header>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Icon — small curated inline-SVG set. No lucide-react in lib/blocks/.
// ─────────────────────────────────────────────────────────────────────────────

export type IconName =
  | "spark" | "wand" | "code" | "layers" | "bolt" | "shield"
  | "globe" | "compass" | "git" | "kbd" | "check" | "x"
  | "arrow" | "quote" | "lock";

export interface IconProps {
  name?: IconName | string;
  size?: number;
  className?: string;
  style?: CSSProperties;
}

export function Icon({ name, size = 22, className = "", style }: IconProps) {
  const props = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
    style,
    "aria-hidden": true,
  };
  switch (name) {
    case "spark":
      return (
        <svg {...props}>
          <path d="M12 3v4M12 17v4M5 12H1M23 12h-4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    case "wand":
      return (
        <svg {...props}>
          <path d="m4 20 9-9" />
          <path d="M14 6l1.5-1.5M19.5 9.5 21 8M15 11l1 1" />
          <path d="m18 4 1 1m-1-1-1 1m1-1v2" />
        </svg>
      );
    case "code":
      return (
        <svg {...props}>
          <path d="m8 6-6 6 6 6M16 6l6 6-6 6M14 4 10 20" />
        </svg>
      );
    case "layers":
      return (
        <svg {...props}>
          <path d="m12 2 9 5-9 5-9-5 9-5Z" />
          <path d="m3 12 9 5 9-5" />
          <path d="m3 17 9 5 9-5" />
        </svg>
      );
    case "bolt":
      return (
        <svg {...props}>
          <path d="M13 2 3 14h8l-1 8 10-12h-8l1-8Z" />
        </svg>
      );
    case "shield":
      return (
        <svg {...props}>
          <path d="M12 3 4 6v6c0 5 3.5 8.5 8 9 4.5-.5 8-4 8-9V6l-8-3Z" />
        </svg>
      );
    case "globe":
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
        </svg>
      );
    case "compass":
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="9" />
          <path d="m9 15 2-6 6-2-2 6-6 2Z" />
        </svg>
      );
    case "git":
      return (
        <svg {...props}>
          <circle cx="6" cy="6" r="2.5" />
          <circle cx="6" cy="18" r="2.5" />
          <circle cx="18" cy="12" r="2.5" />
          <path d="M6 8.5v7" />
          <path d="M6 12h6c2 0 3.5-1 3.5-2.5" />
        </svg>
      );
    case "kbd":
      return (
        <svg {...props}>
          <rect x="2" y="6" width="20" height="12" rx="2" />
          <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h12" />
        </svg>
      );
    case "check":
      return (
        <svg {...props}>
          <path d="M5 12.5 10 17l9-10" />
        </svg>
      );
    case "x":
      return (
        <svg {...props}>
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      );
    case "arrow":
      return (
        <svg {...props}>
          <path d="M5 12h14m0 0-5-5m5 5-5 5" />
        </svg>
      );
    case "quote":
      return (
        <svg {...props} strokeWidth={0} fill="currentColor">
          <path d="M6 7h5l-2 5h2v6H4v-6l2-5Zm10 0h5l-2 5h2v6h-7v-6l2-5Z" />
        </svg>
      );
    case "lock":
      return (
        <svg {...props}>
          <rect x="4" y="11" width="16" height="10" rx="2" />
          <path d="M8 11V8a4 4 0 1 1 8 0v3" />
        </svg>
      );
    default:
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="9" />
        </svg>
      );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LogoTile — stand-in for a logo when no asset is present.
// ─────────────────────────────────────────────────────────────────────────────

export function LogoTile({ label }: { label: string }) {
  return (
    <div
      className="h-9 px-4 flex items-center justify-center rounded-[6px] text-[13px] font-medium tracking-[-0.005em] select-none"
      style={{
        color: "var(--color-text-dim)",
        boxShadow: "inset 0 0 0 1px var(--color-border)",
      }}
    >
      {label}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MediaPlaceholder — used wherever the user hasn't dropped a real image.
// ─────────────────────────────────────────────────────────────────────────────

export interface MediaPlaceholderProps {
  ratio?: string;
  label?: string;
  rotate?: number;
  shadow?: string;
}

export function MediaPlaceholder({
  ratio = "4 / 5",
  label,
  rotate = 0,
  shadow = "0 60px 100px -40px oklch(0% 0 0 / 0.22)",
}: MediaPlaceholderProps) {
  return (
    <div
      className="relative w-full media-placeholder"
      style={{
        aspectRatio: ratio,
        borderRadius: "var(--radius)",
        transform: rotate ? `rotate(${rotate}deg)` : undefined,
        boxShadow: shadow,
        border: "1px solid var(--color-border)",
      }}
    >
      <div className="absolute inset-0 p-5 flex flex-col gap-3">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: "oklch(0.78 0.13 27)" }} />
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: "oklch(0.88 0.13 92)" }} />
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: "oklch(0.82 0.13 145)" }} />
          <span className="ml-3 text-[11px] font-mono" style={{ color: "var(--color-text-dim)" }}>
            openlen.com/preview
          </span>
        </div>
        <div
          className="flex-1 rounded-[8px] overflow-hidden"
          style={{ background: "oklch(1 0 0 / 0.55)", border: "1px solid var(--color-border)" }}
        >
          <div className="p-5 flex flex-col gap-3">
            <div className="h-2 rounded-full w-1/3" style={{ background: "var(--color-border-strong)" }} />
            <div className="h-7 rounded w-3/4" style={{ background: "var(--color-fg)", opacity: 0.85 }} />
            <div className="h-7 rounded w-1/2" style={{ background: "var(--color-fg)", opacity: 0.85 }} />
            <div className="h-2 rounded-full w-2/3" style={{ background: "var(--color-border-strong)" }} />
            <div className="h-2 rounded-full w-1/2" style={{ background: "var(--color-border-strong)" }} />
            <div className="mt-3 flex gap-2">
              <div className="h-8 w-28 rounded-[8px]" style={{ background: "var(--color-accent)" }} />
              <div
                className="h-8 w-20 rounded-[8px]"
                style={{ boxShadow: "inset 0 0 0 1px var(--color-border-strong)" }}
              />
            </div>
          </div>
        </div>
        {label && (
          <div
            className="absolute bottom-3 right-3 px-2 py-1 rounded-md text-[10px] uppercase tracking-[0.12em] font-mono"
            style={{
              color: "var(--color-text-dim)",
              background: "oklch(1 0 0 / 0.7)",
              boxShadow: "inset 0 0 0 1px var(--color-border)",
            }}
          >
            {label}
          </div>
        )}
      </div>
    </div>
  );
}
