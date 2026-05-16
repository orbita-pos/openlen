import type { ReactNode } from "react";

export function Card({
  children,
  title,
  subtitle,
  kicker,
}: {
  children: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  kicker?: ReactNode;
}) {
  return (
    <div className="lift">
      <div className="rounded-2xl bg-white dark:bg-zinc-950 ring-1 ring-zinc-200 dark:ring-zinc-800 card-glow p-7 sm:p-8">
        {kicker && (
          <div className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-coral-50 dark:bg-coral-500/10 text-coral-700 dark:text-coral-300 ring-1 ring-inset ring-coral-200 dark:ring-coral-500/30 px-2 py-0.5 text-[11px] font-medium">
            {kicker}
          </div>
        )}
        <h1 className="text-[26px] sm:text-[28px] font-semibold tracking-tight leading-[1.05]">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1.5 text-[14px] text-zinc-500 dark:text-zinc-500 leading-relaxed">
            {subtitle}
          </p>
        )}
        <div className="mt-6 space-y-4">{children}</div>
      </div>
    </div>
  );
}
