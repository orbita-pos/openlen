// lib/app-ai/cap-messages.ts — WHAT THE AI ALERTS SAY (spec local 2026-10-15,
// 4.5 and 4.6). Pure and LIGHT on purpose: the notifications drain is a cron
// bundle that imports it (a heavy import there once broke `cron:bundle`). The
// push carries no prose (the server doesn't know the reader's language, like
// Len's), the owner's email is in English like the Edge Functions one, and the
// operator's is in Spanish (it goes to Jesús).

import { CENTICREDITOS_POR_CREDITO, USD_PER_CREDIT, formatCredits } from "@/lib/credits-client";

export interface CapAlert {
  readonly projectId: string;
  readonly projectTitle: string | null;
  readonly percent: 80 | 100;
  readonly spent: number;
  readonly cap: number;
}

/** The project's Database view, where the AI tab is. */
export function capUrl(projectId: string): string {
  return `/new?project=${encodeURIComponent(projectId)}&view=database`;
}

export function capPush(a: CapAlert): { title: string; body: string; url: string } {
  const title = a.projectTitle?.trim();
  return {
    title: title ? `AI · ${title}` : "AI",
    body: `${a.percent}% · ${formatCredits(a.spent)} / ${formatCredits(a.cap)}`,
    url: capUrl(a.projectId),
  };
}

export function capEmail(a: CapAlert & { readonly siteUrl: string }): { subject: string; text: string } {
  const subject = a.percent === 100 ? "Your apps reached this month's AI limit" : "Your apps used 80% of this month's AI limit";
  const then =
    a.percent === 100
      ? "Until the month ends, your apps' AI calls get a 402 error, and the apps keep working without AI."
      : "When they reach it, your apps' AI calls get a 402 error until the month ends, and the apps keep working without AI.";
  const text = [
    "Hi,",
    "",
    `Your apps have used ${formatCredits(a.spent)} of the ${formatCredits(a.cap)} credits you let them spend on AI this month (${a.percent}%).`,
    then,
    "You can change the limit in the AI tab of your project's Database view, or move to a bigger plan.",
    "",
    `See it in your project: ${a.siteUrl}${capUrl(a.projectId)}`,
  ].join("\n");
  return { subject, text };
}

export function freePoolAlertEmail(a: { readonly day: string; readonly spent: number; readonly cap: number }): { subject: string; text: string } {
  const usd = (centicredits: number) => `$${((centicredits / CENTICREDITOS_POR_CREDITO) * USD_PER_CREDIT).toFixed(4)}`;
  const pct = a.cap > 0 ? Math.floor((a.spent / a.cap) * 100) : 100;
  return {
    subject: `[IA de las apps] El tope diario del plan gratis va por el ${pct} % (${a.day})`,
    text: [
      `Gastado el ${a.day} por las apps de las cuentas gratis: ${usd(a.spent)} de ${usd(a.cap)} (${pct} %).`,
      "Al 100 % sus llamadas contestan 503 (app_ai_busy) hasta el día siguiente (UTC); las de pago siguen.",
      "Para subir el tope: OPENLEN_APP_AI_FREE_DAILY_USD en /etc/openlen/openlen.env y reiniciar la app (infra/FUNCTIONS_RUNBOOK.md §7).",
    ].join("\n"),
  };
}
