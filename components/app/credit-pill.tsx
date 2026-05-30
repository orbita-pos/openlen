"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Coins } from "lucide-react";
import { cn } from "@/lib/cn";

// ─────────────────────────────────────────────────────────────────────────────
// Credit pill — the signed-in user's AI credit balance, fetched from
// /api/usage. Renders nothing when signed out (the fetch 401s) or while
// loading; turns red at zero. Safe to drop into any header — it self-gates
// on the auth check, so it never shows on /login etc.
//
// Fetches once on mount. The generation flow hard-redirects on completion,
// so the balance is fresh after a generate; a chat edit (no reload) leaves
// it stale until the next navigation.
// ─────────────────────────────────────────────────────────────────────────────

export function CreditPill() {
  const t = useTranslations("projects");
  const locale = useLocale();
  const [credits, setCredits] = useState<{
    balance: number;
    allotment: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/usage")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { credits?: { balance: number; allotment: number } } | null) => {
        if (!cancelled && d?.credits) setCredits(d.credits);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!credits) return null;
  const empty = credits.balance <= 0;
  const className = cn(
    "hidden sm:inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-[12px] font-medium ring-1 ring-inset tabular-nums",
    empty
      ? "bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 ring-red-200 dark:ring-red-500/30"
      : "bg-zinc-50 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 ring-zinc-200 dark:ring-zinc-800",
  );
  const tooltip = t("creditPill.tooltip", {
    balance: credits.balance,
    allotment: credits.allotment,
  });
  const inner = (
    <>
      <Coins size={13} className={empty ? "text-red-500" : "text-coral-500"} />
      {credits.balance}
    </>
  );
  // Out of credits → the pill becomes the upgrade entry point (Polar checkout).
  if (empty) {
    return (
      <a
        href={`/api/billing/checkout?locale=${locale}`}
        title={tooltip}
        className={cn(className, "hover:opacity-90 transition-opacity")}
      >
        {inner}
      </a>
    );
  }
  return (
    <span title={tooltip} className={className}>
      {inner}
    </span>
  );
}
