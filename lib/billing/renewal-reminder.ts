// EL RECORDATORIO DE RENOVACIÓN.
//
// La política de reembolso lo promete: un aviso «al menos 5 días hábiles antes
// de cada renovación», por la Ley Federal de Protección al Consumidor. Hasta el
// 2026-10-04 no lo mandaba nadie: Polar sólo avisa a los planes de 6 meses o más
// (medido en su documentación), y los nuestros son mensuales.
//
// Lo corre una vez al día `scripts/renewal-reminders.ts` (timer
// openlen-renewal-reminders). La fuente de verdad es POLAR, no nuestra base: se
// le pregunta cada suscripción —su próxima renovación, si va a cancelarse, el
// importe que de verdad paga esa persona—, y aquí sólo se guarda para qué
// renovación ya se mandó el aviso (`users.renewalReminderFor`).
//
// Este módulo no toca la base ni la red: el corredor recibe cada cosa por
// parámetro, y lo que conecta todo vive en el script.

import type { Plan } from "@/lib/plan";

/** Se avisa cuando faltan ESTOS días hábiles o menos. Corriendo a diario, el
 *  primer día que se cumple faltan exactamente 6: un día de margen sobre los 5
 *  que promete la política, por si una corrida se pierde. */
export const REMIND_AT_BUSINESS_DAYS = 6;

/** Lo que se lee de `GET /v1/subscriptions/{id}` de Polar. */
export interface PolarSubscription {
  id: string;
  status: string;
  /** En centavos. */
  amount: number;
  currency: string;
  recurring_interval: string;
  recurring_interval_count?: number;
  current_period_end: string;
  cancel_at_period_end: boolean;
}

function utcDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/** Días hábiles (lunes a viernes) DESPUÉS de hoy y hasta el día de `end`,
 *  incluido: de un lunes al lunes siguiente hay 5. En UTC. Los festivos no se
 *  restan: con eso el aviso llega antes, nunca después. */
export function businessDaysUntil(now: Date, end: Date): number {
  const DAY = 86_400_000;
  let count = 0;
  for (let t = utcDay(now) + DAY; t <= utcDay(end); t += DAY) {
    const dow = new Date(t).getUTCDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

export function shouldRemind(opts: { now: Date; sub: PolarSubscription; sentFor: Date | null }): boolean {
  const { now, sub, sentFor } = opts;
  if (sub.status !== "active" || sub.cancel_at_period_end) return false;
  // De 6 meses en adelante avisa Polar: un segundo correo sería ruido.
  const months =
    sub.recurring_interval === "month"
      ? (sub.recurring_interval_count ?? 1)
      : sub.recurring_interval === "year"
        ? 12
        : 0;
  if (months === 0 || months >= 6) return false;
  const end = new Date(sub.current_period_end);
  if (!(end.getTime() > now.getTime())) return false;
  if (sentFor && sentFor.getTime() === end.getTime()) return false;
  return businessDaysUntil(now, end) <= REMIND_AT_BUSINESS_DAYS;
}

function money(amount: number, currency: string): string {
  const n = (amount / 100).toFixed(2);
  return currency.toLowerCase() === "usd" ? `US$${n}` : `${n} ${currency.toUpperCase()}`;
}

function escape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** En español y en inglés en el mismo correo: no guardamos el idioma de cada
 *  persona, y las páginas legales que lo prometen están en esos dos. */
export function buildRenewalReminderEmail(opts: {
  plan: Exclude<Plan, "free">;
  amount: number;
  currency: string;
  renewsAt: Date;
  manageUrl: string;
}): { subject: string; text: string; html: string } {
  const plan = opts.plan === "ultra" ? "Ultra" : opts.plan === "max" ? "Max" : "Pro";
  const amount = money(opts.amount, opts.currency);
  const fmt = (locale: string) =>
    new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(opts.renewsAt);
  const es = fmt("es-MX");
  const en = fmt("en-US");
  const url = opts.manageUrl;

  const text = [
    `Tu plan ${plan} de OpenLen se renueva el ${es} por ${amount}.`,
    `No tienes que hacer nada para seguir. Si no quieres renovar, cancela antes de esa fecha, sin costo: ${url}`,
    "",
    `Your OpenLen ${plan} plan renews on ${en} for ${amount}.`,
    `You don't need to do anything to keep it. If you don't want to renew, cancel before that date at no cost: ${url}`,
  ].join("\n");

  const p = (s: string) => `<p style="font-size:14px; line-height:1.5; color:#525252; margin:0 0 12px;">${s}</p>`;
  const html = `<!doctype html>
<html>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; background:#fafafa; margin:0; padding:32px; color:#0a0a0a;">
  <table align="center" style="max-width:480px; width:100%; background:#fff; border-radius:16px; padding:32px; border:1px solid #e5e5e5;">
    <tr><td>
      <div style="margin-bottom:24px;"><span style="font-weight:600; font-size:14px;">OpenLen</span></div>
      <h1 style="font-size:20px; margin:0 0 12px; letter-spacing:-0.02em;">Tu plan ${plan} se renueva el ${escape(es)}</h1>
      ${p(`Se cobrarán <strong>${escape(amount)}</strong>. No tienes que hacer nada para seguir. Si no quieres renovar, cancela antes de esa fecha, sin costo.`)}
      <p style="margin:0 0 24px;"><a href="${escape(url)}" style="display:inline-block; background:#FF5A36; color:#fff; padding:11px 18px; border-radius:8px; text-decoration:none; font-weight:500; font-size:14px;">Gestionar suscripción</a></p>
      <hr style="border:none; border-top:1px solid #e5e5e5; margin:0 0 24px;">
      <h2 style="font-size:16px; margin:0 0 12px;">Your ${plan} plan renews on ${escape(en)}</h2>
      ${p(`You'll be charged <strong>${escape(amount)}</strong>. You don't need to do anything to keep it. If you don't want to renew, cancel before that date at no cost: <a href="${escape(url)}">Manage subscription</a>.`)}
      <p style="font-size:12px; color:#525252; word-break:break-all; margin:12px 0 0;">${escape(url)}</p>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject: `Tu plan ${plan} de OpenLen se renueva el ${es} · Your plan renews on ${en}`, text, html };
}

export interface PaidUser {
  id: string;
  email: string;
  plan: Exclude<Plan, "free">;
  subscriptionId: string;
  sentFor: Date | null;
}

/** Una pasada. Cada persona va aparte: un fallo de Polar o del correo con una
 *  no para a las demás. Si el correo no sale, no se apunta y mañana se
 *  reintenta. */
export async function runRenewalReminders(deps: {
  now: Date;
  manageUrl: string;
  listPaidUsers: () => Promise<PaidUser[]>;
  fetchSubscription: (id: string) => Promise<PolarSubscription>;
  send: (mail: { to: string; subject: string; text: string; html: string }) => Promise<boolean>;
  markSent: (userId: string, periodEnd: Date) => Promise<void>;
}): Promise<{ checked: number; sent: number; failed: number }> {
  const users = await deps.listPaidUsers();
  let sent = 0;
  let failed = 0;
  for (const u of users) {
    try {
      const sub = await deps.fetchSubscription(u.subscriptionId);
      if (!shouldRemind({ now: deps.now, sub, sentFor: u.sentFor })) continue;
      const renewsAt = new Date(sub.current_period_end);
      const mail = buildRenewalReminderEmail({
        plan: u.plan,
        amount: sub.amount,
        currency: sub.currency,
        renewsAt,
        manageUrl: deps.manageUrl,
      });
      if (!(await deps.send({ to: u.email, ...mail }))) continue;
      await deps.markSent(u.id, renewsAt);
      sent++;
    } catch (err) {
      failed++;
      console.error("[renewal-reminders] falló con", u.id, err);
    }
  }
  return { checked: users.length, sent, failed };
}
