import { Resend } from "resend";
import {
  memberEmailStringsFor,
  type MemberEmailStrings,
} from "@/lib/members/email-strings";

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

  await live.emails.send({
    from,
    to: input.to,
    subject: "Reset your OpenLen password",
    html,
    text,
  });
}

export interface MemberLoginEmail {
  to: string;
  /** The published SITE's title — this email speaks for the site, not for
   *  OpenLen (members are the site's visitors, not our users). */
  siteTitle: string;
  loginUrl: string;
  /** Site language — picks the copy from lib/members/email-strings. */
  locale?: string | null;
}

/** Magic-link login email for the members module. Mirrors the password-reset
 *  posture: dev fallback prints the URL, prod misconfig screams in the log. */
export async function sendMemberLoginEmail(
  input: MemberLoginEmail,
): Promise<void> {
  const live = liveClientOrWarn("member login email");
  if (!live) {
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.log(
        `\n  📧 [DEV] Member login email to ${input.to} (${input.siteTitle})\n     ${input.loginUrl}\n     (set RESEND_API_KEY in .env.local to send real emails)\n`,
      );
    }
    return;
  }

  const t = memberEmailStringsFor(input.locale);
  const site = input.siteTitle.trim() || "your site";
  await live.emails.send({
    from,
    to: input.to,
    subject: t.subject.replace("{site}", site),
    html: buildMemberLoginHtml(input, t, site),
    text: [
      t.heading.replace("{site}", site),
      "",
      t.body,
      "",
      input.loginUrl,
      "",
      t.ignore,
    ].join("\n"),
  });
}

function buildMemberLoginHtml(
  input: MemberLoginEmail,
  t: MemberEmailStrings,
  site: string,
): string {
  // Neutral palette — the site's email in spirit, so no OpenLen orange.
  return `<!doctype html>
<html>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; background:#fafafa; margin:0; padding:32px; color:#0a0a0a;">
  <table align="center" style="max-width:480px; width:100%; background:#fff; border-radius:16px; padding:32px; border:1px solid #e5e5e5;">
    <tr><td>
      <h1 style="font-size:20px; margin:0 0 12px; letter-spacing:-0.02em;">${escape(
        t.heading.replace("{site}", site),
      )}</h1>
      <p style="font-size:14px; line-height:1.5; color:#525252; margin:0 0 24px;">${escape(t.body)}</p>
      <p style="margin:0 0 24px;">
        <a href="${escape(input.loginUrl)}" style="display:inline-block; background:#16181d; color:#fff; padding:11px 18px; border-radius:8px; text-decoration:none; font-weight:500; font-size:14px;">${escape(t.button)}</a>
      </p>
      <p style="font-size:12px; color:#737373; margin:0 0 8px;">${escape(t.linkHint)}</p>
      <p style="font-size:12px; color:#525252; word-break:break-all; margin:0 0 24px;">${escape(input.loginUrl)}</p>
      <p style="font-size:12px; color:#a3a3a3; margin:0;">${escape(t.ignore)}</p>
    </td></tr>
  </table>
</body>
</html>`;
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

  await client.emails.send({
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
