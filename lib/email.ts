import { Resend } from "resend";

// ─────────────────────────────────────────────────────────────────────────────
// Email — Resend client with console-log fallback.
//
// Without RESEND_API_KEY (e.g. local dev), every "email" is just logged to
// the server console with the action URL — paste it into the browser to
// continue the flow. Switching to a real production sender is just adding
// the env var.
// ─────────────────────────────────────────────────────────────────────────────

const apiKey = process.env.RESEND_API_KEY;
const from = process.env.EMAIL_FROM ?? "OpenLen <no-reply@openlen.com>";

const client = apiKey ? new Resend(apiKey) : null;

export interface PasswordResetEmail {
  to: string;
  name: string | null;
  resetUrl: string;
}

export async function sendPasswordResetEmail(
  input: PasswordResetEmail,
): Promise<void> {
  if (!client) {
    // eslint-disable-next-line no-console
    console.log(
      `\n  📧 [DEV] Password reset email to ${input.to}\n     ${input.resetUrl}\n     (set RESEND_API_KEY in .env.local to send real emails)\n`,
    );
    return;
  }

  const html = buildPasswordResetHtml(input);
  const text = buildPasswordResetText(input);

  await client.emails.send({
    from,
    to: input.to,
    subject: "Reset your OpenLen password",
    html,
    text,
  });
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
        <span style="display:inline-block; width:24px; height:24px; background:#FF5A36; border-radius:6px; color:#fff; font-weight:700; text-align:center; line-height:24px; font-size:13px;">い</span>
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
