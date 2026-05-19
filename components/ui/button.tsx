"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "ghost" | "outline" | "dark" | "soft";
export type ButtonSize = "xs" | "sm" | "md" | "lg" | "xl";

const SIZES: Record<ButtonSize, string> = {
  xs: "h-7 px-2 text-xs",
  sm: "h-8 px-3 text-sm",
  md: "h-9 px-3.5 text-sm",
  lg: "h-10 px-4 text-sm",
  xl: "h-11 px-5 text-[15px]",
};

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-coral-700 text-white hover:bg-coral-800 active:bg-coral-900 btn-coral-shadow",
  ghost:
    "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900",
  outline:
    "bg-white text-zinc-900 ring-1 ring-zinc-200 hover:bg-zinc-50 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800 dark:hover:bg-zinc-900",
  dark:
    "bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200",
  soft:
    "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", size = "md", className, children, type, ...rest }, ref) => (
    <button
      ref={ref}
      type={type ?? "button"}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-coral-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-950 disabled:opacity-60 disabled:pointer-events-none",
        SIZES[size],
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  ),
);
Button.displayName = "Button";
