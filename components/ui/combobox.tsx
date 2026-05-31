"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/cn";

export interface ComboboxProps {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  emptyLabel?: string;
  buttonPlaceholder?: string;
  className?: string;
}

export function Combobox({
  value,
  onChange,
  options,
  placeholder = "Search…",
  emptyLabel = "No match. We'll still figure it out.",
  buttonPlaceholder = "Pick an industry…",
  className,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const filtered = useMemo(
    () => options.filter((o) => o.toLowerCase().includes(query.toLowerCase())),
    [options, query],
  );

  return (
    <div className={cn("relative", className)} ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-between w-full h-9 px-3 text-sm rounded-lg bg-white dark:bg-[#0a0a0a] ring-1 ring-zinc-200 dark:ring-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-coral-500 transition"
      >
        <span
          className={value ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-500 dark:text-zinc-400"}
        >
          {value || buttonPlaceholder}
        </span>
        <ChevronDown size={14} className="text-zinc-500 dark:text-zinc-400" />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full rounded-lg ring-1 ring-zinc-200 dark:ring-zinc-800 bg-white dark:bg-[#0a0a0a] shadow-lg overflow-hidden">
          <div className="flex items-center gap-2 px-2.5 border-b border-zinc-100 dark:border-zinc-900">
            <Search size={13} className="text-zinc-500 dark:text-zinc-400" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={placeholder}
              className="w-full h-9 bg-transparent text-sm focus:outline-none placeholder:text-zinc-400"
            />
          </div>
          <div className="max-h-56 overflow-y-auto p-1 nice-scroll">
            {filtered.length === 0 && (
              <div className="px-2.5 py-3 text-xs text-zinc-500 dark:text-zinc-400 text-center">
                {emptyLabel}
              </div>
            )}
            {filtered.map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => {
                  onChange(o);
                  setOpen(false);
                  setQuery("");
                }}
                className={cn(
                  "flex items-center justify-between w-full text-left px-2.5 py-1.5 rounded-md text-sm transition-colors",
                  o === value
                    ? "bg-coral-50 text-coral-700 dark:bg-coral-500/10 dark:text-coral-300"
                    : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900",
                )}
              >
                <span>{o}</span>
                {o === value && <Check size={14} />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
