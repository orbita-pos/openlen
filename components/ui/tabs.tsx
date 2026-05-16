"use client";

import type { ComponentType } from "react";
import { cn } from "@/lib/cn";

export interface TabOption<V extends string> {
  value: V;
  label: string;
  icon?: ComponentType<{ size?: number; className?: string }>;
}

export interface TabsProps<V extends string> {
  value: V;
  onChange: (value: V) => void;
  options: TabOption<V>[];
  hideLabelsBelow?: "sm" | "md" | "lg" | "xl" | "none";
  className?: string;
}

export function Tabs<V extends string>({
  value,
  onChange,
  options,
  hideLabelsBelow = "sm",
  className,
}: TabsProps<V>) {
  const labelClass =
    hideLabelsBelow === "none" ? "" : `hidden ${hideLabelsBelow}:inline`;
  return (
    <div
      className={cn(
        "inline-flex items-center gap-0.5 rounded-lg bg-zinc-100 dark:bg-zinc-900 p-0.5",
        className,
      )}
    >
      {options.map((o) => {
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              "relative inline-flex items-center gap-1.5 h-7 px-2 sm:px-2.5 rounded-md text-xs font-medium transition",
              value === o.value
                ? "bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 shadow-sm"
                : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100",
            )}
          >
            {Icon && <Icon size={13} />}
            <span className={labelClass}>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
