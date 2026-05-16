"use client";

import type { NumberFormField } from "@/lib/zod-to-form";

export interface NumberFieldProps {
  field: NumberFormField;
  value: number;
  onChange: (value: number) => void;
}

export function NumberField({ field, value, onChange }: NumberFieldProps) {
  return (
    <input
      type="number"
      value={Number.isFinite(value) ? value : ""}
      min={field.min}
      max={field.max}
      step={field.integer ? 1 : "any"}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === "") return;
        const parsed = field.integer ? parseInt(raw, 10) : parseFloat(raw);
        if (Number.isFinite(parsed)) onChange(parsed);
      }}
      placeholder={field.label}
      className="block w-full h-8 px-2.5 text-[13px] rounded-md bg-white dark:bg-[#0a0a0a] ring-1 ring-zinc-200 dark:ring-zinc-800 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-coral-500 transition-shadow"
    />
  );
}
