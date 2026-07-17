import type { Target } from "./logic";

export const TARGET_LABEL: Record<Target, string> = {
  app: "Aplicación",
  pages: "Páginas publicadas",
  api: "API y datos",
};

export function buildAlert(
  kind: "went_down" | "recovered",
  target: Target,
  now: number,
  downSince: number,
): { subject: string; text: string } {
  const label = TARGET_LABEL[target];
  if (kind === "went_down") {
    return {
      subject: `🔴 OpenLen: ${label} caído`,
      text:
        `${label} lleva 2 checks consecutivos fallando ` +
        `(detectado ${new Date(now).toISOString()}).\n\n` +
        `https://status.openlen.com`,
    };
  }
  const durMin = Math.max(1, Math.round((now - downSince) / 60_000));
  return {
    subject: `🟢 OpenLen: ${label} recuperado (${durMin} min caído)`,
    text:
      `${label} respondió bien otra vez. Duración de la caída: ~${durMin} min.\n\n` +
      `https://status.openlen.com`,
  };
}

export interface EmailEnv {
  RESEND_API_KEY: string;
  ALERT_FROM: string;
  ALERT_EMAIL: string;
}

// Best-effort: un fallo de Resend se loguea y no rompe el run — el estado en
// D1 es la verdad; la alerta es solo el aviso.
export async function sendAlert(
  kind: "went_down" | "recovered",
  target: Target,
  env: EmailEnv,
  now: number,
  downSince: number,
): Promise<void> {
  const { subject, text } = buildAlert(kind, target, now, downSince);
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ from: env.ALERT_FROM, to: env.ALERT_EMAIL, subject, text }),
    });
    if (!res.ok) console.error("resend alert failed", res.status, await res.text());
  } catch (err) {
    console.error("resend alert error", err);
  }
}
