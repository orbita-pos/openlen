import type { ReactNode } from "react";

export interface FieldProps {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
}

export function Field({ label, hint, htmlFor, children }: FieldProps) {
  return (
    <label htmlFor={htmlFor} className="block">
      <div className="flex items-end justify-between mb-2">
        <span className="text-[13px] font-medium text-zinc-900 dark:text-zinc-100">
          {label}
        </span>
        {hint && <span className="text-[11px] text-zinc-500 dark:text-zinc-400">{hint}</span>}
      </div>
      {children}
    </label>
  );
}
