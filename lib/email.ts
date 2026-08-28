import { Resend } from "resend";

// ─────────────────────────────────────────────────────────────────────────────
// Email — Resend client with console-log fallback.
//
// Without RESEND_API_KEY (local dev), every "email" is just logged to the
// server console with the action URL — paste it into the browser to continue
// the flow. Switching to a real production sender is just adding the env var.
// ─────────────────────────────────────────────────────────────────────────────

const apiKey = process.env.RESEND_API_KEY;
const from = process.env.EMAIL_FROM ?? "OpenLen <no-reply@openlen.com>";

const client = apiKey ? new Resend(apiKey) : null;

// The dev fallback only console-logs the action URL, so without this a
// misconfigured server "succeeds" while no email is ever sent — the silent
// failure that makes password reset look broken. We deliberately don't throw
// (that would 500 only for real users → an enumeration signal); instead we
// scream in the server log so the misconfig is visible to the operator while
// the request stays anti-enumeration-safe. Returns null → caller no-ops.
function liveClientOrWarn(context: string): Resend | null {
  if (client) return client;
  if (process.env.NODE_ENV === "production") {
    // eslint-disable-next-line no-console
    console.error(
      `[email] RESEND_API_KEY is not set — ${context} was NOT sent. ` +
        "Set RESEND_API_KEY on the server and verify the sending domain in Resend.",
    );
  }
  return null;
}

/**
 * Manda, y MIRA lo que contesta.
 *
 * 🔴 EL SDK DE RESEND NO LANZA. Cuando la API rechaza —cuota agotada, dominio
 * sin verificar, destinatario inválido, límite de tasa— devuelve
 * `{ data: null, error }` y sigue como si nada. Los siete envíos de este
 * fichero hacían `await live.emails.send(...)` y tiraban el resultado, así que
 * el rechazo no dejaba rastro en ninguna parte: ni excepción que atrapar (el
 * `.catch()` de `notifyOwner` no ve nada), ni línea en el log, ni aviso al
 * dueño.
 *
 * Eso convierte el fallo más caro del producto en el más callado: un visitante
 * rellena el formulario, el dato SÍ se guarda en la base, y el aviso al dueño
 * no sale. Él no se entera de que tuvo un cliente, y nosotros tampoco de que
 * dejamos de avisarle. Medido el 2026-08-28: la cuenta contestaba
 * `x-resend-monthly-quota: 17`.
 *
 * ⚠️ LO QUE ESTA FUNCIÓN NO CAMBIA: quién LANZA. Una excepción de transporte se
 * RE-LANZA tal cual, porque los correos de `lib/notifications` viajan en un
 * trabajo que **reintenta al fallar** — tragármela convertía un reintento en
 * una pérdida, y sus pruebas lo cazaron en la primera corrida. Lo único nuevo
 * es que ahora, además, se oye.
 *
 * El `{ error }` de la API sí se queda en log y no lanza. No es indecisión: hoy
 * NADIE está preparado para esa excepción, y en el camino del visitante
 * convertir un correo no enviado en un 500 es justo lo que evita
 * `liveClientOrWarn` (un 500 sólo para correos existentes es una señal de
 * enumeración). Que el trabajo de notificaciones reintente también ante una
 * cuota agotada es una decisión aparte —y con su propio riesgo: reintentar
 * contra una cuota agotada es una tormenta—, no un efecto secundario de esto.
 */
async function enviar(
  live: Resend,
  contexto: string,
  payload: Parameters<Resend["emails"]["send"]>[0],
): Promise<boolean> {
  let r: Awaited<ReturnType<Resend["emails"]["send"]>>;
  try {
    r = await live.emails.send(payload);
  } catch (err) {
    // Se oye Y se re-lanza: el que reintenta necesita el fallo, el operador
    // necesita el motivo.
    // eslint-disable-next-line no-console
    console.error(`[email] ${contexto} reventó al enviarse → ${String(payload.to)}`, err);
    throw err;
  }
  if (r.error) {
    // eslint-disable-next-line no-console
    console.error(
      `[email] RESEND RECHAZÓ ${contexto} → ${String(payload.to)}: ` +
        `${r.error.name ?? "error"} — ${r.error.message ?? "sin mensaje"}. ` +
        "El correo NO salió. Revisa cuota y dominio verificado en Resend.",
    );
    return false;
  }
  return true;
}

export interface PasswordResetEmail {
  to: string;
  name: string | null;
  resetUrl: string;
}

export async function sendPasswordResetEmail(
  input: PasswordResetEmail,
): Promise<void> {
  const live = liveClientOrWarn("password reset email");
  if (!live) {
    // Dev only: print the reset link so the flow is testable without a key.
    // In prod liveClientOrWarn() already logged the misconfig.
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.log(
        `\n  📧 [DEV] Password reset email to ${input.to}\n     ${input.resetUrl}\n     (set RESEND_API_KEY in .env.local to send real emails)\n`,
      );
    }
    return;
  }

  const html = buildPasswordResetHtml(input);
  const text = buildPasswordResetText(input);

  await enviar(live, "password reset email", {
    from,
    to: input.to,
    subject: "Reset your OpenLen password",
    html,
    text,
  });
}

export interface AbuseReportEmail {
  siteUrl: string;
  category: string;
  details: string;
  reporterEmail?: string | null;
  ip?: string | null;
}

/** Abuse report → the operator's inbox. The destination is deliberately the
 *  address already published in the Acceptable Use Policy; override via
 *  ABUSE_REPORT_EMAIL for self-hosters. CSAM / non-consensual categories get
 *  an URGENT subject so they sort to the top. */
export async function sendAbuseReportEmail(
  input: AbuseReportEmail,
): Promise<void> {
  const to =
    process.env.ABUSE_REPORT_EMAIL?.trim() || "info@jesusbr.com";
  const urgent = input.category === "csam" || input.category === "intimate";
  const subject = `${urgent ? "[URGENTE] " : ""}Reporte de abuso: ${input.category} — ${input.siteUrl.slice(0, 80)}`;

  const live = liveClientOrWarn("abuse report email");
  if (!live) {
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.log(
        `\n  📧 [DEV] Abuse report to ${to}\n     ${subject}\n     ${input.details.slice(0, 200)}\n`,
      );
    }
    // Dev fallback counts as delivered; prod misconfig already screamed.
    return;
  }

  const lines = [
    `URL reportada: ${input.siteUrl}`,
    `Categoría: ${input.category}`,
    `Reportante: ${input.reporterEmail || "(anónimo)"}`,
    `IP: ${input.ip || "—"}`,
    "",
    input.details,
  ];
  await enviar(live, "abuse report email", {
    from,
    to,
    subject,
    ...(input.reporterEmail ? { replyTo: input.reporterEmail } : {}),
    text: lines.join("\n"),
    html: `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif;background:#fafafa;margin:0;padding:32px;color:#0a0a0a;">
  <table align="center" style="max-width:520px;width:100%;background:#fff;border-radius:16px;padding:32px;border:1px solid ${urgent ? "#fca5a5" : "#e5e5e5"};">
    <tr><td>
      <h1 style="font-size:18px;margin:0 0 16px;letter-spacing:-0.02em;">${urgent ? "🚨 " : ""}Reporte de abuso</h1>
      <table style="width:100%;border-collapse:collapse;margin:0 0 20px;">
        <tr><td style="padding:5px 12px 5px 0;font-size:12px;color:#737373;white-space:nowrap;vertical-align:top;">URL</td><td style="padding:5px 0;font-size:13px;word-break:break-all;">${escape(input.siteUrl)}</td></tr>
        <tr><td style="padding:5px 12px 5px 0;font-size:12px;color:#737373;">Categoría</td><td style="padding:5px 0;font-size:13px;font-weight:600;">${escape(input.category)}</td></tr>
        <tr><td style="padding:5px 12px 5px 0;font-size:12px;color:#737373;">Reportante</td><td style="padding:5px 0;font-size:13px;">${escape(input.reporterEmail || "(anónimo)")}</td></tr>
        <tr><td style="padding:5px 12px 5px 0;font-size:12px;color:#737373;">IP</td><td style="padding:5px 0;font-size:13px;">${escape(input.ip || "—")}</td></tr>
      </table>
      <p style="font-size:13.5px;line-height:1.6;color:#374151;white-space:pre-wrap;margin:0;">${escape(input.details)}</p>
    </td></tr>
  </table>
</body></html>`,
  });
}

export interface LeadNotificationMeta {
  /** When the submission was recorded server-side. Used to render
   *  "Submitted 14 min ago" in the email. */
  submittedAt?: Date;
  /** 2-letter ISO country from CF-IPCountry. Shown as "from US" in the
   *  triage strip. Null when CF wasn't in front. */
  country?: string | null;
  /** "mobile" / "desktop" / "tablet" from UA parsing. */
  device?: string | null;
  /** Browser family ("safari", "chrome", "firefox"…). */
  browser?: string | null;
  /** Page the form was on (Referer header). */
  referer?: string | null;
}

export interface LeadNotificationEmail {
  to: string;
  projectTitle: string;
  fields: Record<string, string>;
  dashboardUrl: string;
  /** Extra signals for triage + personalisation. Optional — older callers
   *  still get the email, just without the meta strip. */
  meta?: LeadNotificationMeta;
  /** Set when the email is a user-initiated test send rather than a real
   *  submission. Adds a banner so the recipient knows. */
  testMode?: boolean;
}

const EMAIL_VALUE_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const EMAIL_FIELD_HINT_RE =
  /(?:^|[_-\s])(?:e[_-]?mail|email[_-]?address|correo)(?:$|[_-\s])/i;
const NAME_FIELD_HINT_RE =
  /(?:^|[_-\s])(?:name|full[_-]?name|first[_-]?name|nombre|your[_-]?name)(?:$|[_-\s])/i;

/** Find the submitter's email in the form data — first try keys that look
 *  like email fields, then fall back to any value that parses as an email.
 *  Returns null when nothing matches; the email then has no Reply-To. */
function detectSubmitterEmail(
  fields: Record<string, string>,
): string | null {
  for (const [key, value] of Object.entries(fields)) {
    if (EMAIL_FIELD_HINT_RE.test(key) && EMAIL_VALUE_RE.test(value.trim())) {
      return value.trim();
    }
  }
  for (const value of Object.values(fields)) {
    if (EMAIL_VALUE_RE.test(value.trim())) return value.trim();
  }
  return null;
}

/** Find a "name" field for subject-line personalisation. */
function detectSubmitterName(
  fields: Record<string, string>,
): string | null {
  for (const [key, value] of Object.entries(fields)) {
    const v = value.trim();
    if (NAME_FIELD_HINT_RE.test(key) && v.length > 0 && v.length <= 80) {
      return v;
    }
  }
  return null;
}

/** Format `Date` → "14 min ago" / "3 hours ago" — short hand for the
 *  triage strip. Falls back to ISO when the date is invalid. */
function formatRelative(d: Date): string {
  const ms = Date.now() - d.getTime();
  if (!Number.isFinite(ms) || ms < 0) return d.toISOString();
  const s = Math.floor(ms / 1000);
  if (s < 30) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const days = Math.floor(h / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** Build the small "Submitted X · from Y · device Z" triage strip. Empty
 *  string when no meta is available, in which case the email omits it. */
function buildMetaStrip(meta: LeadNotificationMeta | undefined): string[] {
  if (!meta) return [];
  const parts: string[] = [];
  if (meta.submittedAt) parts.push(`Submitted ${formatRelative(meta.submittedAt)}`);
  if (meta.country) parts.push(`from ${meta.country}`);
  const dev =
    meta.device && meta.browser
      ? `${meta.device} · ${meta.browser}`
      : meta.device ?? meta.browser ?? null;
  if (dev) parts.push(dev);
  return parts;
}

/** Notify a project owner that their published page captured a new lead.
 *  In test mode, the subject is prefixed with "[TEST]" and a banner is
 *  rendered above the lead body so the recipient doesn't mistake it for
 *  a real submission. */
export async function sendLeadNotificationEmail(
  input: LeadNotificationEmail,
): Promise<void> {
  const submitter = detectSubmitterEmail(input.fields);
  const submitterName = detectSubmitterName(input.fields);
  const metaParts = buildMetaStrip(input.meta);

  // Subject preference: "[TEST] " > "from <name> <email>" > "from <email>"
  // > "from <name>" > generic. Inbox-scannable, single-line.
  const subjectCore = input.testMode
    ? `[TEST] Lead notification — ${input.projectTitle}`
    : submitter && submitterName
      ? `New lead from ${submitterName} <${submitter}>`
      : submitter
        ? `New lead from ${submitter}`
        : submitterName
          ? `New lead from ${submitterName} — ${input.projectTitle}`
          : `New lead — ${input.projectTitle}`;

  // Plain-text fallback (some clients render only this).
  const textLines = [
    input.testMode
      ? `This is a TEST email — no real submission was captured. Once a visitor submits the form, the real notification will look like this.`
      : `You captured a new submission on "${input.projectTitle}":`,
    "",
    ...Object.entries(input.fields).map(([k, v]) => `${k}: ${v}`),
    "",
    ...(metaParts.length > 0 ? [metaParts.join(" · "), ""] : []),
    `See all leads: ${input.dashboardUrl}`,
  ];

  if (!client) {
    // eslint-disable-next-line no-console
    console.log(
      `\n  📧 [DEV] ${subjectCore}\n     → ${input.to}\n     ${textLines.join("\n     ")}\n     ${submitter ? `(reply-to: ${submitter})` : "(no reply-to detected)"}\n`,
    );
    return;
  }

  await enviar(client, "lead notification email", {
    from,
    to: input.to,
    // Threading hint to Gmail/Outlook: the Reply button reaches the
    // submitter directly. Falls back to no Reply-To when the form had no
    // email field — Reply then goes to the OpenLen no-reply, which we
    // surface as text in the body so the owner sees who to reach out to.
    ...(submitter ? { replyTo: submitter } : {}),
    subject: subjectCore,
    text: textLines.join("\n"),
    html: buildLeadHtml({ ...input, submitter, metaParts }),
  });
}

function buildLeadHtml({
  projectTitle,
  fields,
  dashboardUrl,
  testMode,
  submitter,
  metaParts,
}: LeadNotificationEmail & {
  submitter: string | null;
  metaParts: string[];
}): string {
  const rows = Object.entries(fields)
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 12px 6px 0;font-size:12px;color:#737373;vertical-align:top;white-space:nowrap;">${escape(
          k,
        )}</td><td style="padding:6px 0;font-size:13px;color:#0a0a0a;">${escape(
          v,
        )}</td></tr>`,
    )
    .join("");

  const testBanner = testMode
    ? `<div style="margin:0 0 20px; padding:10px 14px; background:#FFF7ED; border:1px solid #FED7AA; border-radius:8px; font-size:12px; color:#9A3412; line-height:1.5;">
        <strong>Test email.</strong> No real submission was captured — this is what your inbox will look like when a visitor submits.
      </div>`
    : "";

  const metaStrip =
    metaParts.length > 0
      ? `<div style="margin:0 0 18px; font-size:11.5px; color:#737373; letter-spacing:0.01em;">
          ${escape(metaParts.join(" · "))}
        </div>`
      : "";

  const replyHint = submitter
    ? `<p style="margin:18px 0 0; font-size:11.5px; color:#737373; line-height:1.55;">
        Hit Reply to respond directly to <strong style="color:#525252;">${escape(submitter)}</strong>.
      </p>`
    : `<p style="margin:18px 0 0; font-size:11.5px; color:#a3a3a3; line-height:1.55;">
        This form didn't capture an email field, so Reply will go to the OpenLen no-reply address. Add an email input to the form to enable direct replies.
      </p>`;

  return `<!doctype html>
<html>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; background:#fafafa; margin:0; padding:32px; color:#0a0a0a;">
  <table align="center" style="max-width:480px; width:100%; background:#fff; border-radius:16px; padding:32px; border:1px solid #e5e5e5;">
    <tr><td>
      <div style="display:flex; align-items:center; gap:8px; margin-bottom:24px;">
        <span style="display:inline-block; width:24px; height:24px; background:#FF5A36; border-radius:6px; color:#fff; font-weight:700; text-align:center; line-height:24px; font-size:15px;">O</span>
        <span style="font-weight:600; font-size:14px;">OpenLen</span>
      </div>
      ${testBanner}
      <h1 style="font-size:20px; margin:0 0 4px; letter-spacing:-0.02em;">New lead</h1>
      <p style="font-size:14px; line-height:1.5; color:#525252; margin:0 0 14px;">
        Someone submitted a form on <strong>${escape(projectTitle)}</strong>.
      </p>
      ${metaStrip}
      <table style="width:100%; border-collapse:collapse; margin:0 0 24px;">${rows}</table>
      <p style="margin:0;">
        <a href="${escape(dashboardUrl)}" style="display:inline-block; background:#FF5A36; color:#fff; padding:11px 18px; border-radius:8px; text-decoration:none; font-weight:500; font-size:14px;">See all leads</a>
      </p>
      ${replyHint}
    </td></tr>
  </table>
</body>
</html>`;
}

function buildPasswordResetText({ name, resetUrl }: PasswordResetEmail): string {
  const greeting = name ? `Hi ${name},` : "Hi,";
  return [
    greeting,
    "",
    "Click the link below to reset your OpenLen password. The link expires in 1 hour.",
    "",
    resetUrl,
    "",
    "If you didn't request this, ignore this email — your password won't change.",
    "",
    "— OpenLen",
  ].join("\n");
}

function buildPasswordResetHtml({ name, resetUrl }: PasswordResetEmail): string {
  const greeting = name ? `Hi ${escape(name)},` : "Hi,";
  return `<!doctype html>
<html>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; background:#fafafa; margin:0; padding:32px; color:#0a0a0a;">
  <table align="center" style="max-width:480px; width:100%; background:#fff; border-radius:16px; padding:32px; border:1px solid #e5e5e5;">
    <tr><td>
      <div style="display:flex; align-items:center; gap:8px; margin-bottom:24px;">
        <span style="display:inline-block; width:24px; height:24px; background:#FF5A36; border-radius:6px; color:#fff; font-weight:700; text-align:center; line-height:24px; font-size:15px;">O</span>
        <span style="font-weight:600; font-size:14px;">OpenLen</span>
      </div>
      <h1 style="font-size:22px; margin:0 0 12px; letter-spacing:-0.02em;">Reset your password</h1>
      <p style="font-size:14px; line-height:1.5; color:#525252; margin:0 0 24px;">
        ${greeting} click the button below to set a new password. The link expires in 1 hour.
      </p>
      <p style="margin:0 0 24px;">
        <a href="${escape(resetUrl)}" style="display:inline-block; background:#FF5A36; color:#fff; padding:11px 18px; border-radius:8px; text-decoration:none; font-weight:500; font-size:14px;">Reset password</a>
      </p>
      <p style="font-size:12px; color:#737373; margin:0 0 8px;">Or paste this link into your browser:</p>
      <p style="font-size:12px; color:#525252; word-break:break-all; margin:0 0 24px;">${escape(resetUrl)}</p>
      <p style="font-size:12px; color:#a3a3a3; margin:0;">If you didn't request this, ignore this email — your password won't change.</p>
    </td></tr>
  </table>
</body>
</html>`;
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── Agent invite — magic-link for non-registered emails ─────────────────────

export interface AgentInviteEmail {
  to: string;
  projectTitle: string;
  acceptUrl: string;
  locale?: string | null;
}

/** Magic-link invite email sent to a non-OpenLen-user who was invited as a
 *  chat agent. Dev fallback prints the URL; prod misconfig screams in the log. */
export async function sendAgentInviteEmail(
  input: AgentInviteEmail,
): Promise<void> {
  const live = liveClientOrWarn("agent invite email");
  if (!live) {
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.log(
        `\n  📧 [DEV] Agent invite email to ${input.to} (${input.projectTitle})\n     ${input.acceptUrl}\n     (set RESEND_API_KEY in .env.local to send real emails)\n`,
      );
    }
    return;
  }

  const title = input.projectTitle.trim() || "a site";
  await enviar(live, "agent invite email", {
    from,
    to: input.to,
    subject: `You're invited to help with chat on ${title}`,
    html: buildAgentInviteHtml(input, title),
    text: [
      `You've been invited to help manage chat on "${title}".`,
      "",
      "Click the link below to accept. You'll need to create a free OpenLen account first if you don't have one — the link stays valid for 7 days.",
      "",
      input.acceptUrl,
      "",
      "If you weren't expecting this invitation, you can ignore this email.",
    ].join("\n"),
  });
}

function buildAgentInviteHtml(input: AgentInviteEmail, title: string): string {
  return `<!doctype html>
<html>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; background:#fafafa; margin:0; padding:32px; color:#0a0a0a;">
  <table align="center" style="max-width:480px; width:100%; background:#fff; border-radius:16px; padding:32px; border:1px solid #e5e5e5;">
    <tr><td>
      <div style="display:flex; align-items:center; gap:8px; margin-bottom:24px;">
        <span style="display:inline-block; width:24px; height:24px; background:#FF5A36; border-radius:6px; color:#fff; font-weight:700; text-align:center; line-height:24px; font-size:15px;">O</span>
        <span style="font-weight:600; font-size:14px;">OpenLen</span>
      </div>
      <h1 style="font-size:20px; margin:0 0 12px; letter-spacing:-0.02em;">You're invited</h1>
      <p style="font-size:14px; line-height:1.5; color:#525252; margin:0 0 24px;">
        You've been invited to help manage chat on <strong>${escape(title)}</strong>. Accept below — you'll create a free account if you don't have one yet.
      </p>
      <p style="margin:0 0 24px;">
        <a href="${escape(input.acceptUrl)}" style="display:inline-block; background:#FF5A36; color:#fff; padding:11px 18px; border-radius:8px; text-decoration:none; font-weight:500; font-size:14px;">Accept invitation</a>
      </p>
      <p style="font-size:12px; color:#737373; margin:0 0 8px;">Or paste this link into your browser:</p>
      <p style="font-size:12px; color:#525252; word-break:break-all; margin:0 0 24px;">${escape(input.acceptUrl)}</p>
      <p style="font-size:12px; color:#a3a3a3; margin:0;">This link expires in 7 days. If you weren't expecting this invitation, you can ignore this email.</p>
    </td></tr>
  </table>
</body>
</html>`;
}

// ─── Chat — offline-owner notification ───────────────────────────────────────

export async function sendChatNotificationEmail(input: {
  to: string;
  ownerName: string | null;
  senderName: string;
  messageBody: string;
  deskUrl: string;
  projectTitle: string;
}): Promise<void> {
  const preview = input.messageBody.slice(0, 200);

  const live = liveClientOrWarn("chat notification email");
  if (!live) {
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.log(`[DEV] chat notification to ${input.to}: ${preview}`);
    }
    return;
  }

  const greeting = input.ownerName ? `Hi ${input.ownerName},` : "Hi,";
  const text = [
    greeting,
    "",
    `${input.senderName} sent you a message on "${input.projectTitle}":`,
    "",
    preview,
    "",
    `Reply in your inbox: ${input.deskUrl}`,
  ].join("\n");

  await enviar(live, "chat notification email", {
    from,
    to: input.to,
    subject: `New message on ${input.projectTitle}`,
    text,
    html: buildChatNotificationHtml({ ...input, preview }),
  });
}

// ─── Live Sheet — owner notification when a connected Google Sheet breaks ────

export async function sendLiveSheetBrokenEmail(input: {
  to: string;
  projectTitle: string;
  missingCount: number;
  editorUrl: string;
}): Promise<void> {
  const summary =
    input.missingCount > 0
      ? `${input.missingCount} datos de tu Sheet ya no se encuentran`
      : "Tu página conservó el último valor mientras tanto";

  const live = liveClientOrWarn("live sheet broken email");
  if (!live) {
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.log(`[DEV] live sheet broken notice to ${input.to}: ${input.projectTitle} — ${summary}`);
    }
    return;
  }

  const text = [
    "Hi,",
    "",
    `Tu Google Sheet conectado a "${input.projectTitle}" dejó de leerse.`,
    "",
    summary,
    "",
    `Revisa tu página: ${input.editorUrl}`,
  ].join("\n");

  await enviar(live, "live sheet broken email", {
    from,
    to: input.to,
    subject: `Tu Sheet dejó de leerse — ${input.projectTitle}`,
    text,
    html: buildLiveSheetBrokenHtml({ ...input, summary }),
  });
}

function buildLiveSheetBrokenHtml(input: {
  projectTitle: string;
  editorUrl: string;
  summary: string;
}): string {
  return `<!doctype html>
<html>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; background:#fafafa; margin:0; padding:32px; color:#0a0a0a;">
  <table align="center" style="max-width:480px; width:100%; background:#fff; border-radius:16px; padding:32px; border:1px solid #e5e5e5;">
    <tr><td>
      <div style="display:flex; align-items:center; gap:8px; margin-bottom:24px;">
        <span style="display:inline-block; width:24px; height:24px; background:#FF5A36; border-radius:6px; color:#fff; font-weight:700; text-align:center; line-height:24px; font-size:15px;">O</span>
        <span style="font-weight:600; font-size:14px;">OpenLen</span>
      </div>
      <h1 style="font-size:20px; margin:0 0 4px; letter-spacing:-0.02em;">Tu Sheet dejó de leerse</h1>
      <p style="font-size:14px; line-height:1.5; color:#525252; margin:0 0 14px;">
        Tu Google Sheet conectado a <strong>${escape(input.projectTitle)}</strong> dejó de leerse.
      </p>
      <blockquote style="margin:0 0 24px; padding:12px 16px; background:#f5f5f5; border-left:3px solid #e5e5e5; border-radius:0 8px 8px 0; font-size:13.5px; color:#374151; line-height:1.6;">${escape(input.summary)}</blockquote>
      <p style="margin:0;">
        <a href="${escape(input.editorUrl)}" style="display:inline-block; background:#FF5A36; color:#fff; padding:11px 18px; border-radius:8px; text-decoration:none; font-weight:500; font-size:14px;">Revisar mi página</a>
      </p>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildChatNotificationHtml(input: {
  ownerName: string | null;
  senderName: string;
  preview: string;
  deskUrl: string;
  projectTitle: string;
}): string {
  const greeting = input.ownerName ? `Hi ${escape(input.ownerName)},` : "Hi,";
  return `<!doctype html>
<html>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; background:#fafafa; margin:0; padding:32px; color:#0a0a0a;">
  <table align="center" style="max-width:480px; width:100%; background:#fff; border-radius:16px; padding:32px; border:1px solid #e5e5e5;">
    <tr><td>
      <div style="display:flex; align-items:center; gap:8px; margin-bottom:24px;">
        <span style="display:inline-block; width:24px; height:24px; background:#FF5A36; border-radius:6px; color:#fff; font-weight:700; text-align:center; line-height:24px; font-size:15px;">O</span>
        <span style="font-weight:600; font-size:14px;">OpenLen</span>
      </div>
      <h1 style="font-size:20px; margin:0 0 4px; letter-spacing:-0.02em;">New message</h1>
      <p style="font-size:14px; line-height:1.5; color:#525252; margin:0 0 14px;">${greeting} <strong>${escape(input.senderName)}</strong> sent you a message on <strong>${escape(input.projectTitle)}</strong>.</p>
      <blockquote style="margin:0 0 24px; padding:12px 16px; background:#f5f5f5; border-left:3px solid #e5e5e5; border-radius:0 8px 8px 0; font-size:13.5px; color:#374151; line-height:1.6; white-space:pre-wrap;">${escape(input.preview)}</blockquote>
      <p style="margin:0;">
        <a href="${escape(input.deskUrl)}" style="display:inline-block; background:#FF5A36; color:#fff; padding:11px 18px; border-radius:8px; text-decoration:none; font-weight:500; font-size:14px;">Open inbox</a>
      </p>
    </td></tr>
  </table>
</body>
</html>`;
}

// ─── Bookings — confirmation / reminder / cancellation, optional .ics ────────

export interface BookingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Hand-rolled VCALENDAR (lib/bookings/ics.ts) — attached as text/calendar. */
  ics?: string | null;
  icsFilename?: string;
}

/** Low-level booking send. Same dev-fallback posture as the other senders:
 *  no RESEND_API_KEY → console-log (dev) / scream (prod), never throw. The .ics
 *  rides as a base64 attachment so the recipient's client offers add-to-calendar. */
export async function sendBookingEmail(input: BookingEmail): Promise<void> {
  const live = liveClientOrWarn("booking email");
  if (!live) {
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.log(
        `\n  📧 [DEV] Booking email to ${input.to}\n     ${input.subject}\n     ${input.ics ? "(+ .ics attached)" : ""}\n`,
      );
    }
    return;
  }
  await enviar(live, "booking email", {
    from,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
    ...(input.ics
      ? {
          attachments: [
            {
              filename: input.icsFilename ?? "invite.ics",
              content: Buffer.from(input.ics, "utf8").toString("base64"),
              contentType: "text/calendar; method=REQUEST; charset=utf-8",
            },
          ],
        }
      : {}),
  });
}
