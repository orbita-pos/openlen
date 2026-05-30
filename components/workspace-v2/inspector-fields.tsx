"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";

// Section — labeled card with optional icon, contains a stack of fields.
export function Section({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="border-b bd last:border-b-0 px-3 py-3">
      <div className="flex items-center gap-1.5 mb-2 text-[10px] uppercase tracking-[0.16em] fg-faint font-semibold ui-small">
        {icon}
        <span>{label}</span>
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

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
      <span className="text-[10.5px] fg-faint">{label}</span>
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
  onCommit,
}: {
  label: string;
  value: string;
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

// RadiusField — single px input for border-radius.
export function RadiusField({
  value,
  onCommit,
}: {
  value: string;
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
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2 cursor-pointer select-none">
      <span className="text-[11.5px] fg">{label}</span>
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

