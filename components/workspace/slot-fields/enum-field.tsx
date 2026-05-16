"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import type { EnumFormField } from "@/lib/zod-to-form";

export interface EnumFieldProps {
  field: EnumFormField;
  value: string;
  onChange: (value: string) => void;
}

// Compact select tuned to match the 32px height of the other slot inputs.
// Reuses the visual language of components/ui/select.tsx but at the smaller
// scale the dense sidebar form needs — wrapping `<Select>` with className
// overrides would leak design decisions out of one component.
export function EnumField({ field, value, onChange }: EnumFieldProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-between w-full h-8 px-2.5 text-[13px] rounded-md bg-white dark:bg-[#0a0a0a] ring-1 ring-zinc-200 dark:ring-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-coral-500 transition"
      >
        <span
          className={cn(
            value
              ? "text-zinc-900 dark:text-zinc-100"
              : "text-zinc-400 dark:text-zinc-600",
          )}
        >
          {value || field.label}
        </span>
        <ChevronDown size={12} className="text-zinc-400 shrink-0" />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full max-h-60 overflow-auto rounded-md ring-1 ring-zinc-200 dark:ring-zinc-800 bg-white dark:bg-[#0a0a0a] shadow-lg p-1 nice-scroll">
          {field.options.map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => {
                onChange(o);
                setOpen(false);
              }}
              className={cn(
                "flex items-center justify-between w-full text-left px-2 py-1 rounded text-[13px] transition-colors",
                o === value
                  ? "bg-coral-50 text-coral-700 dark:bg-coral-500/10 dark:text-coral-300"
                  : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900",
              )}
            >
              <span>{o}</span>
              {o === value && <Check size={12} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
