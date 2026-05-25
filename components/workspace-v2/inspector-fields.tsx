"use client";

import { useEffect, useState, type ReactNode } from "react";

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

// TextField — labeled input with onCommit on blur or Enter.
export function TextField({
  label,
  value,
  placeholder,
  mono,
  multiline,
  onCommit,
}: {
  label: string;
  value: string;
  placeholder?: string;
  mono?: boolean;
  multiline?: boolean;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  const cls = `w-full bg-app border bd rounded-md px-2 py-1.5 text-[12px] fg focus:border-[color:var(--accent)] focus:outline-none focus:ring-1 focus:ring-[color:var(--accent-ring)]/30 transition placeholder:fg-faint ${
    mono ? "font-mono text-[11.5px]" : ""
  }`;
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10.5px] fg-faint">{label}</span>
      {multiline ? (
        <textarea
          value={draft}
          placeholder={placeholder}
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
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className={cls}
        />
      )}
    </label>
  );
}

// ColorField — labeled native color input + hex text input.
export function ColorField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
}) {
  const safe = /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000";
  return (
    <label className="flex items-center gap-2">
      <span className="text-[10.5px] fg-faint flex-1">{label}</span>
      <input
        type="color"
        value={safe}
        onChange={(e) => onCommit(e.target.value)}
        className="h-6 w-8 rounded border bd cursor-pointer p-0"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onCommit(e.target.value)}
        placeholder="#rrggbb"
        className="w-[80px] bg-app border bd rounded-md px-2 py-1 text-[11px] font-mono fg focus:border-[color:var(--accent)] focus:outline-none"
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
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <label className="flex items-center gap-2">
      <span className="text-[10.5px] fg-faint flex-1">Radius</span>
      <input
        type="text"
        value={draft}
        placeholder="8px"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== value) onCommit(draft);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className="w-[80px] bg-app border bd rounded-md px-2 py-1 text-[11px] font-mono fg focus:border-[color:var(--accent)] focus:outline-none"
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

