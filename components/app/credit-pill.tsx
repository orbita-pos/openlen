"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Coins, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  CENTICREDITOS_POR_CREDITO,
  CREDIT_BALANCE_CHANGED_EVENT,
  formatCredits,
} from "@/lib/credits-client";

// ─────────────────────────────────────────────────────────────────────────────
// Credit pill — the signed-in user's AI credit balance, fetched from
// /api/usage. Renders nothing when signed out (the fetch 401s) or while
// loading; warns at 3 and turns red at zero. Safe to drop into any header — it self-gates
// on the auth check, so it never shows on /login etc.
//
// Fetches on mount and again when an in-workspace AI turn announces that its
// metered debit finished. /api/generate hard-redirects, so its next mount is
// already fresh.
// ─────────────────────────────────────────────────────────────────────────────

export function CreditPill() {
  const t = useTranslations("projects");
  const locale = useLocale();
  const [credits, setCredits] = useState<{
    balance: number;
    allotment: number;
    refillsAt: string | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let requestSequence = 0;
    const refresh = () => {
      const request = ++requestSequence;
      void fetch("/api/usage")
        .then((r) => (r.ok ? r.json() : null))
        .then(
          (
            d: {
              credits?: {
                balance: number;
                allotment: number;
                refillsAt: string | null;
              };
            } | null,
          ) => {
            if (!cancelled && request === requestSequence && d?.credits) {
              setCredits(d.credits);
            }
          },
        )
        .catch(() => {});
    };
    refresh();
    window.addEventListener(CREDIT_BALANCE_CHANGED_EVENT, refresh);
    return () => {
      cancelled = true;
      window.removeEventListener(CREDIT_BALANCE_CHANGED_EVENT, refresh);
    };
  }, []);

  if (!credits) return null;
  // El saldo llega en CENTICRÉDITOS (ver lib/credits.ts). Se enseña en
  // créditos con dos decimales, y los umbrales se escriben en créditos para que
  // se lean: «quedan menos de 3» era 3 y ahora es 3 * 100.
  const saldo = formatCredits(credits.balance);
  const empty = credits.balance <= 0;
  const low = !empty && credits.balance <= 3 * CENTICREDITOS_POR_CREDITO;
  const state = empty ? "empty" : low ? "low" : "normal";
  const className = cn(
    "inline-flex shrink-0 items-center gap-1.5 h-8 px-2 sm:px-2.5 rounded-md text-[12px] font-medium ring-1 ring-inset tabular-nums",
    empty
      ? "bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 ring-red-200 dark:ring-red-500/30"
      : low
        ? "bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-200 ring-amber-200 dark:ring-amber-500/30"
      : "bg-zinc-50 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 ring-zinc-200 dark:ring-zinc-800",
  );
  const baseTooltip = t("creditPill.tooltip", {
    balance: saldo,
    allotment: formatCredits(credits.allotment),
  });
  const refillDate = credits.refillsAt ? new Date(credits.refillsAt) : null;
  const refillLabel =
    refillDate && Number.isFinite(refillDate.getTime())
      ? t("creditPill.refillsAt", {
          date: new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(refillDate),
        })
      : null;
  const tooltip = refillLabel ? `${baseTooltip}. ${refillLabel}` : baseTooltip;
  const accessibleLabel = `${tooltip}${low ? `. ${t("creditPill.low")}` : ""}${
    empty ? `. ${t("creditPill.empty")}` : ""
  }`;
  const inner = (
    <>
      {low || empty ? (
        <TriangleAlert size={13} aria-hidden="true" />
      ) : (
        <Coins size={13} className="text-coral-500" aria-hidden="true" />
      )}
      {low ? (
        <>
          <span data-credit-mobile="true" className="sm:hidden">
            {saldo}
          </span>
          <span data-credit-desktop="true" className="hidden sm:inline">
            {saldo} · {t("creditPill.low")}
          </span>
        </>
      ) : empty ? (
        <>
          <span data-credit-mobile="true" className="sm:hidden">
            0 · Pro
          </span>
          <span data-credit-desktop="true" className="hidden sm:inline">
            {t("creditPill.empty")} · Pro
          </span>
        </>
      ) : (
        <span>{saldo}</span>
      )}
    </>
  );
  // Out of credits → the pill becomes the upgrade entry point (Polar checkout).
  if (empty) {
    return (
      <a
        href={`/api/billing/checkout?locale=${locale}`}
        title={tooltip}
        aria-label={accessibleLabel}
        data-credit-state={state}
        className={cn(className, "hover:opacity-90 transition-opacity")}
      >
        {inner}
      </a>
    );
  }
  return (
    <span
      title={tooltip}
      aria-label={accessibleLabel}
      data-credit-state={state}
      className={className}
    >
      {inner}
    </span>
  );
}
