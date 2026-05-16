"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/cn";

export interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  className?: string;
}

export function Checkbox({ checked, onChange, label, className }: CheckboxProps) {
  return (
    <label
      className={cn(
        "flex items-center gap-2.5 cursor-pointer group select-none",
        className,
      )}
    >
      <span
        className={cn(
          "relative inline-flex h-4 w-4 items-center justify-center rounded-[5px] ring-1 transition",
          checked
            ? "bg-coral-500 ring-coral-500 group-hover:bg-coral-600"
            : "bg-white dark:bg-[#0a0a0a] ring-zinc-300 dark:ring-zinc-700 group-hover:ring-zinc-400",
        )}
      >
        {checked && <Check size={11} strokeWidth={3} className="text-white" />}
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="cb absolute inset-0 opacity-0 cursor-pointer"
        />
      </span>
      <span className="text-sm text-zinc-700 dark:text-zinc-300">{label}</span>
    </label>
  );
}
