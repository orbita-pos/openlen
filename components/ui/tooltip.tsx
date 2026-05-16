import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface TooltipProps {
  children: ReactNode;
  label: ReactNode;
  side?: "top" | "bottom";
  className?: string;
}

export function Tooltip({
  children,
  label,
  side = "top",
  className,
}: TooltipProps) {
  return (
    <span className={cn("relative inline-flex group", className)}>
      {children}
      <span
        className={cn(
          "pointer-events-none absolute z-40 whitespace-nowrap rounded-md bg-zinc-900 dark:bg-zinc-800 px-2 py-1 text-[11px] text-white opacity-0 transition group-hover:opacity-100",
          side === "top"
            ? "left-1/2 -translate-x-1/2 bottom-full mb-1.5"
            : "left-1/2 -translate-x-1/2 top-full mt-1.5",
        )}
      >
        {label}
      </span>
    </span>
  );
}
