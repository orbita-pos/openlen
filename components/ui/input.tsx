import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type = "text", ...rest }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        "block w-full h-9 px-3 text-sm rounded-lg bg-white dark:bg-[#0a0a0a] ring-1 ring-zinc-200 dark:ring-zinc-800 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-coral-500 transition-shadow",
        className,
      )}
      {...rest}
    />
  ),
);
Input.displayName = "Input";
