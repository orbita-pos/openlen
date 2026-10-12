// lib/functions/quota-messages.ts — LO QUE DICEN LOS AVISOS DE LAS EDGE FUNCTIONS
// (spec local 2026-10-11, Partes 5 y 6). Puro: lo usan el push, el correo y las
// pruebas. El push va sin prosa (el servidor no sabe el idioma de quien lo lee,
// como el aviso de Len); el correo al dueño, en inglés como el del chat; el del
// operador, en español (es Jesús, como el de abuso).

export interface QuotaAlert {
  readonly projectId: string;
  readonly projectTitle: string | null;
  readonly percent: 80 | 100;
  readonly calls: number;
  readonly limit: number;
}

/** La vista Base de datos del proyecto, donde están sus funciones. */
export function quotaUrl(projectId: string): string {
  return `/new?project=${encodeURIComponent(projectId)}&view=database`;
}

export function quotaPush(a: QuotaAlert): { title: string; body: string; url: string } {
  const titulo = a.projectTitle?.trim();
  return {
    title: titulo ? `Edge Functions · ${titulo}` : "Edge Functions",
    body: `${a.percent}% · ${a.calls} / ${a.limit}`,
    url: quotaUrl(a.projectId),
  };
}

export function quotaEmail(a: QuotaAlert & { readonly siteUrl: string }): { subject: string; text: string } {
  const nombre = a.projectTitle?.trim() || "your project";
  const subject =
    a.percent === 100 ? `Your Edge Functions reached this month's limit — ${nombre}` : `Your Edge Functions used 80% of this month's calls — ${nombre}`;
  const luego =
    a.percent === 100
      ? "Until the month ends, new calls get a 429 error. A bigger plan raises the limit."
      : `When they reach ${a.limit}, new calls get a 429 error until the month ends. A bigger plan raises the limit.`;
  const text = [
    "Hi,",
    "",
    `The Edge Functions of "${nombre}" have made ${a.calls} of the ${a.limit} calls your plan includes this month (${a.percent}%).`,
    luego,
    "",
    `See them in your project: ${a.siteUrl}${quotaUrl(a.projectId)}`,
  ].join("\n");
  return { subject, text };
}

export function poolAlertEmail(a: {
  readonly pool: "free" | "paid";
  readonly month: string;
  readonly spentNanoUsd: number;
  readonly capNanoUsd: number;
}): { subject: string; text: string } {
  const usd = (n: number) => `$${(n / 1e9).toFixed(4)}`;
  const pct = a.capNanoUsd > 0 ? Math.floor((a.spentNanoUsd / a.capNanoUsd) * 100) : 100;
  const bolsa = a.pool === "free" ? "gratis" : "de pago";
  const variable = a.pool === "free" ? "OPENLEN_FUNCTIONS_CAP_FREE_USD" : "OPENLEN_FUNCTIONS_CAP_PAID_USD";
  return {
    subject: `[Edge Functions] La bolsa ${bolsa} va por el ${pct} % (${a.month})`,
    text: [
      `Gastado en ${a.month}: ${usd(a.spentNanoUsd)} de ${usd(a.capNanoUsd)} (${pct} %), a precio de lista.`,
      "Al 100 % las llamadas de esa bolsa contestan 429 hasta que acabe el mes.",
      `Para subir el tope: ${variable} en /etc/openlen/openlen.env y reiniciar la app (infra/FUNCTIONS_RUNBOOK.md).`,
    ].join("\n"),
  };
}
