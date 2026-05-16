"use client";

import { cn } from "@/lib/cn";
import type { BooleanFormField } from "@/lib/zod-to-form";

export interface BooleanFieldProps {
  field: BooleanFormField;
  value: boolean;
  onChange: (value: boolean) => void;
}

export function BooleanField({ field, value, onChange }: BooleanFieldProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-label={field.label}
      onClick={() => onChange(!value)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-coral-500 focus:ring-offset-1",
        value
          ? "bg-coral-500"
          : "bg-zinc-200 dark:bg-zinc-800",
      )}
    >
      <span
        className={cn(
          "inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform",
          value ? "translate-x-5" : "translate-x-1",
        )}
      />
    </button>
  );
}
