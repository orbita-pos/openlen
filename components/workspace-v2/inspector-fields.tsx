"use client";

import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { lookFromAccent } from "@/lib/palette-gen";
import {
  buildLinearGradient,
  buildRadialGradient,
  parseSimpleGradient,
} from "@/lib/gradients";

// Section — labeled card with optional icon, contains a stack of fields.
export function Section({
  label,
  icon,
  action,
  children,
}: {
  label: string;
  icon?: ReactNode;
  /** Rendered to the right of the label — e.g. a facet-level "Reset style". */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="border-b bd last:border-b-0 px-3 py-3">
      <div className="flex items-center gap-1.5 mb-2 text-[10px] uppercase tracking-[0.16em] fg-faint font-semibold ui-small">
        {icon}
        <span className="flex-1">{label}</span>
        {action}
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

// Dot de procedencia + reset — el patrón Webflow: sin dot = valor del diseño;
// dot ámbar = "tú cambiaste esto"; hover/focus revela el ↺ que lo restaura.
export function ProvenanceReset({
  dirty,
  title,
  onReset,
}: {
  dirty: boolean;
  title: string;
  onReset: () => void;
}) {
  if (!dirty) return null;
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onReset}
      className="group/dot relative inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-amber-500 transition group-hover/dot:opacity-0 group-focus-visible/dot:opacity-0" />
      <span className="absolute inset-0 hidden items-center justify-center text-[10px] fg-muted group-hover/dot:flex group-focus-visible/dot:flex">
        ↺
      </span>
    </button>
  );
}

/** Shared shape for the optional reset affordance a label-row field can take. */
type ResetAffordance = { dirty: boolean; title: string; onReset: () => void };

// TextField — labeled input with onCommit on blur or Enter. Optional
// commit-time validation keeps an invalid value in the field (shown inline)
// instead of pushing it downstream.
export function TextField({
  label,
  value,
  placeholder,
  mono,
  multiline,
  validate,
  dataField,
  reset,
  onCommit,
}: {
  label: string;
  value: string;
  placeholder?: string;
  mono?: boolean;
  multiline?: boolean;
  /** Return an error message to reject the edit, or null to accept. */
  validate?: (value: string) => string | null;
  /** Stamped as data-meta-field so the SEO health report can focus this
   *  field when an issue is clicked. */
  dataField?: string;
  /** Provenance-reset affordance — an amber dot next to the label when this
   *  field's CSS prop was edited away from the design's original value. */
  reset?: ResetAffordance;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  useEffect(() => {
    setDraft(value);
    setError(null);
  }, [value]);
  const commit = () => {
    if (draft === value) {
      setError(null);
      return;
    }
    const err = validate ? validate(draft) : null;
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    onCommit(draft);
  };
  const cls = `w-full bg-app border rounded-md px-2 py-1.5 text-[12px] fg focus:outline-none focus:ring-1 transition placeholder:fg-faint ${
    error
      ? "border-red-500/60 focus:border-red-500 focus:ring-red-500/30"
      : "bd focus:border-[color:var(--accent)] focus:ring-[color:var(--accent-ring)]/30"
  } ${mono ? "font-mono text-[11.5px]" : ""}`;
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-center gap-1.5">
        <span className="text-[10.5px] fg-faint flex-1">{label}</span>
        {reset && <ProvenanceReset dirty={reset.dirty} title={reset.title} onReset={reset.onReset} />}
      </span>
      {multiline ? (
        <textarea
          value={draft}
          placeholder={placeholder}
          aria-invalid={!!error}
          aria-describedby={error ? errorId : undefined}
          data-meta-field={dataField}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          rows={2}
          className={cls + " resize-y min-h-[44px]"}
        />
      ) : (
        <input
          type="text"
          value={draft}
          placeholder={placeholder}
          aria-invalid={!!error}
          aria-describedby={error ? errorId : undefined}
          data-meta-field={dataField}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className={cls}
        />
      )}
      {error && (
        <span
          id={errorId}
          className="text-[10px] text-red-600 dark:text-red-400 leading-snug"
        >
          {error}
        </span>
      )}
    </label>
  );
}

// ColorField — labeled native color input + hex text input. Both commit only
// on blur/Enter (never per keystroke or per picker-drag frame): a draft holds
// the in-progress value so the swatch previews live without flooding the
// iframe, and a half-typed/invalid hex reverts instead of round-tripping.
export function ColorField({
  label,
  value,
  reset,
  onCommit,
}: {
  label: string;
  value: string;
  /** Provenance-reset affordance — an amber dot next to the label when this
   *  field's CSS prop was edited away from the design's original value. */
  reset?: ResetAffordance;
  onCommit: (value: string) => void;
}) {
  const t = useTranslations("modalsDomain");
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const isHex = (v: string) => /^#[0-9a-fA-F]{6}$/.test(v);
  const safe = isHex(draft) ? draft : "#000000";
  const commit = () => {
    const v = draft.trim();
    if (v === value) return;
    if (v === "" || isHex(v)) onCommit(v);
    else setDraft(value);
  };
  return (
    <label className="flex items-center gap-2">
      <span className="text-[10.5px] fg-faint flex-1">{label}</span>
      {reset && <ProvenanceReset dirty={reset.dirty} title={reset.title} onReset={reset.onReset} />}
      <input
        type="color"
        value={safe}
        aria-label={label}
        onChange={(e) => {
          // The native picker always yields a valid #rrggbb and is a
          // deliberate pick, so commit live. (Only the hex TEXT field waits
          // for blur — that's where per-keystroke floods + half-typed values
          // came from. The native picker has no onBlur on most browsers.)
          setDraft(e.target.value);
          onCommit(e.target.value);
        }}
        className="h-7 w-8 rounded border bd cursor-pointer p-0 focus:outline-none focus:ring-1 focus:ring-[color:var(--accent-ring)]/30"
      />
      <input
        type="text"
        value={draft}
        aria-label={label}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        placeholder={t("inspector.hexPlaceholder")}
        className="w-[80px] bg-app border bd rounded-md px-2 py-1 text-[11px] font-mono fg focus:border-[color:var(--accent)] focus:outline-none focus:ring-1 focus:ring-[color:var(--accent-ring)]/30"
      />
    </label>
  );
}

// GradientControl — minimal 2-stop linear/radial background-gradient editor.
// Collapsed to one "Add gradient" affordance when the element has none;
// prefills from a parseable existing gradient. Stops commit discretely
// (ColorField) and the angle applies on release — never per drag-frame, since
// every apply makes the iframe re-serialize the document.
export function GradientControl({
  value,
  accent,
  onApply,
  onClear,
}: {
  /** The element's current PURE gradient (style.bgGradient), "" when none. */
  value: string;
  /** Page accent — seeds the preset swatches. */
  accent?: string;
  onApply: (css: string) => void;
  onClear: () => void;
}) {
  const t = useTranslations("panelsProps");
  const parsed = useMemo(() => parseSimpleGradient(value), [value]);
  const [editing, setEditing] = useState(!!parsed);
  const [type, setType] = useState<"linear" | "radial">(
    parsed?.type ?? "linear",
  );
  const [angle, setAngle] = useState(parsed?.angle ?? 135);
  const [from, setFrom] = useState(parsed?.stops[0] ?? "#0f172a");
  const [to, setTo] = useState(parsed?.stops[1] ?? "#475569");

  useEffect(() => {
    if (parsed) {
      setEditing(true);
      setType(parsed.type);
      setAngle(parsed.angle);
      setFrom(parsed.stops[0]);
      setTo(parsed.stops[1]);
    } else if (!value) {
      setEditing(false);
    }
  }, [value, parsed]);

  const build = (ty: "linear" | "radial", a: number, f: string, o: string) =>
    ty === "linear"
      ? buildLinearGradient(a, [f, o])
      : buildRadialGradient([f, o]);

  const presets = useMemo(() => {
    const seed =
      accent && /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : "#6366f1";
    const look = lookFromAccent(seed);
    return [
      { from: seed, to: look.dark["--ol-bg"] ?? "#0b1020" },
      { from: look.light["--ol-bg"] ?? "#ffffff", to: seed },
      {
        from: look.dark["--ol-bg"] ?? "#0b1020",
        to: look.dark["--ol-surface"] ?? "#1f2937",
      },
      { from: "#f97316", to: "#7c3aed" },
      { from: "#0ea5e9", to: "#1e3a8a" },
      { from: "#f8fafc", to: "#e2e8f0" },
    ];
  }, [accent]);

  if (!editing) {
    return (
      <div className="flex flex-col gap-1">
        {value && !parsed && (
          <p className="text-[10px] fg-faint leading-snug">
            {t("style.gradientHint")}
          </p>
        )}
        <button
          type="button"
          onClick={() => {
            setEditing(true);
            onApply(build(type, angle, from, to));
          }}
          className="self-start inline-flex items-center gap-1.5 h-7 px-2 rounded-md border bd bg-app fg-muted hover:fg hover:bg-hover transition text-[11px]"
        >
          <span
            aria-hidden
            className="h-3.5 w-3.5 rounded-sm border bd"
            style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}
          />
          {t("style.gradientAdd")}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border bd bg-app/40 p-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-[0.14em] fg-faint font-semibold ui-small">
          {t("style.gradient")}
        </span>
        <button
          type="button"
          onClick={() => {
            setEditing(false);
            onClear();
          }}
          className="text-[10.5px] fg-faint hover:fg underline-offset-2 hover:underline transition"
        >
          {t("style.gradientRemove")}
        </button>
      </div>
      <div className="flex items-center gap-1">
        {(["linear", "radial"] as const).map((ty) => (
          <button
            key={ty}
            type="button"
            onClick={() => {
              setType(ty);
              onApply(build(ty, angle, from, to));
            }}
            className={`px-2 py-0.5 rounded-md text-[10.5px] transition border ${
              type === ty
                ? "bg-elev fg shadow-card bd"
                : "border-transparent fg-muted hover:fg hover:bg-hover"
            }`}
          >
            {ty === "linear"
              ? t("style.gradientLinear")
              : t("style.gradientRadial")}
          </button>
        ))}
      </div>
      {type === "linear" && (
        <label className="flex items-center gap-2">
          <span className="text-[10.5px] fg-faint flex-1">
            {t("style.gradientAngle")}
          </span>
          <input
            type="range"
            min={0}
            max={360}
            step={15}
            value={angle}
            aria-label={t("style.gradientAngle")}
            onChange={(e) => setAngle(Number(e.target.value))}
            onPointerUp={() => onApply(build(type, angle, from, to))}
            onKeyUp={(e) => {
              if (e.key.startsWith("Arrow"))
                onApply(build(type, angle, from, to));
            }}
            className="w-[104px] accent-[color:var(--accent)]"
          />
          <span className="w-[34px] text-right text-[10.5px] font-mono fg-muted">
            {angle}°
          </span>
        </label>
      )}
      <ColorField
        label={t("style.gradientStart")}
        value={from}
        onCommit={(v) => {
          const f = v || "#000000";
          setFrom(f);
          onApply(build(type, angle, f, to));
        }}
      />
      <ColorField
        label={t("style.gradientEnd")}
        value={to}
        onCommit={(v) => {
          const o = v || "#000000";
          setTo(o);
          onApply(build(type, angle, from, o));
        }}
      />
      <div>
        <span className="block text-[10px] uppercase tracking-[0.14em] fg-faint font-semibold mb-1 ui-small">
          {t("style.gradientPresets")}
        </span>
        <div className="flex items-center gap-1.5 flex-wrap">
          {presets.map((p, i) => (
            <button
              key={`${p.from}-${p.to}-${i}`}
              type="button"
              onClick={() => {
                setType("linear");
                setAngle(135);
                setFrom(p.from);
                setTo(p.to);
                onApply(buildLinearGradient(135, [p.from, p.to]));
              }}
              className="h-6 w-9 rounded-md border bd hover:ring-1 hover:ring-[color:var(--accent)]/60 transition"
              style={{ background: `linear-gradient(135deg, ${p.from}, ${p.to})` }}
              aria-label={`${t("style.gradientPresets")} ${i + 1}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// RadiusField — single px input for border-radius.
export function RadiusField({
  value,
  reset,
  onCommit,
}: {
  value: string;
  /** Provenance-reset affordance — an amber dot next to the label when this
   *  field's CSS prop was edited away from the design's original value. */
  reset?: ResetAffordance;
  onCommit: (value: string) => void;
}) {
  const t = useTranslations("modalsDomain");
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <label className="flex items-center gap-2">
      <span className="text-[10.5px] fg-faint flex-1">
        {t("inspector.radius")}
      </span>
      {reset && <ProvenanceReset dirty={reset.dirty} title={reset.title} onReset={reset.onReset} />}
      <input
        type="text"
        value={draft}
        placeholder={t("inspector.radiusPlaceholder")}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          let v = draft.trim();
          // A bare number is invalid CSS for border-radius — assume px.
          if (/^\d+(\.\d+)?$/.test(v)) v = `${v}px`;
          if (v !== value) onCommit(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className="w-[80px] bg-app border bd rounded-md px-2 py-1 text-[11px] font-mono fg focus:border-[color:var(--accent)] focus:outline-none focus:ring-1 focus:ring-[color:var(--accent-ring)]/30"
      />
    </label>
  );
}

// Toggle — labeled boolean switch.
export function Toggle({
  label,
  on,
  reset,
  onChange,
}: {
  label: string;
  on: boolean;
  /** Provenance-reset affordance — an amber dot next to the label when this
   *  field's CSS prop was edited away from the design's original value. */
  reset?: ResetAffordance;
  onChange: (on: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2 cursor-pointer select-none">
      <span className="flex items-center gap-1.5 flex-1">
        <span className="text-[11.5px] fg">{label}</span>
        {reset && <ProvenanceReset dirty={reset.dirty} title={reset.title} onReset={reset.onReset} />}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={() => onChange(!on)}
        className={`relative inline-flex h-4 w-7 rounded-full transition ${
          on ? "bg-[color:var(--accent)]" : "bg-zinc-300 dark:bg-zinc-700"
        }`}
      >
        <span
          className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition ${
            on ? "left-3.5" : "left-0.5"
          }`}
        />
      </button>
    </label>
  );
}

// StepRow — fila de pasos discretos (el sustituto curado de un slider).
export function StepRow({
  label,
  options,
  activeIndex,
  onPick,
  reset,
}: {
  label: string;
  options: readonly string[];
  activeIndex: number;
  onPick: (index: number) => void;
  reset?: ResetAffordance;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10.5px] fg-faint flex-1">{label}</span>
      {reset && <ProvenanceReset dirty={reset.dirty} title={reset.title} onReset={reset.onReset} />}
      <div className="flex items-center gap-0.5 rounded-md border bd bg-app p-0.5">
        {options.map((opt, i) => (
          <button
            key={opt}
            type="button"
            aria-pressed={i === activeIndex}
            onClick={() => onPick(i)}
            className={`px-1.5 py-0.5 rounded text-[10.5px] transition ${
              i === activeIndex ? "bg-elev fg shadow-card" : "fg-muted hover:fg hover:bg-hover"
            }`}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}

// SizeStepper — A− / A+ caminando la escalera tipográfica relativa al tamaño
// actual (nunca saltos absolutos: un H1 baja un peldaño, no se vuelve body).
export function SizeStepper({
  label,
  valueLabel,
  onSmaller,
  onLarger,
  reset,
}: {
  label: string;
  valueLabel: string;
  onSmaller: () => void;
  onLarger: () => void;
  reset?: ResetAffordance;
}) {
  const btn =
    "h-6 w-7 inline-flex items-center justify-center rounded border bd bg-app fg-muted hover:fg hover:bg-hover transition text-[11px]";
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10.5px] fg-faint flex-1">{label}</span>
      {reset && <ProvenanceReset dirty={reset.dirty} title={reset.title} onReset={reset.onReset} />}
      <button type="button" aria-label={`${label} −`} onClick={onSmaller} className={btn}>
        A−
      </button>
      <span className="w-9 text-center text-[10px] font-mono fg-muted">{valueLabel}</span>
      <button type="button" aria-label={`${label} +`} onClick={onLarger} className={btn}>
        A+
      </button>
    </div>
  );
}

