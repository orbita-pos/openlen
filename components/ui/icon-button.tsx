"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Tooltip } from "./tooltip";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  children: ReactNode;
  active?: boolean;
  side?: "top" | "bottom";
}

export function IconButton({
  label,
  children,
  active = false,
  side = "bottom",
  className,
  type,
  ...rest
}: IconButtonProps) {
  return (
    <Tooltip label={label} side={side}>
      <button
        type={type ?? "button"}
        className={cn(
          "inline-flex h-7 w-7 items-center justify-center rounded-md transition disabled:opacity-50 disabled:cursor-not-allowed",
          active
            ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
            : "text-zinc-500 enabled:hover:text-zinc-900 enabled:hover:bg-zinc-100 dark:text-zinc-400 dark:enabled:hover:text-zinc-100 dark:enabled:hover:bg-zinc-900",
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    </Tooltip>
  );
}
