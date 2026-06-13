// Broadcast email rendering — pure, no Resend import (so it's unit-testable
// without the SDK). Builds the per-recipient html + text, including the
// mandatory compliance footer (sender identity, why-you-got-this, postal
// address, unsubscribe link). lib/email.ts owns only the actual send.

import { broadcastFooterStringsFor } from "@/lib/broadcast/email-strings";

export interface BroadcastEmailItem {
  to: string;
  subject: string;
  html: string;
  text: string;
  unsubUrl: string;
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const POSTAL_PLACEHOLDER = "OpenLen — México";

/** CAN-SPAM requires a physical postal address in every marketing email.
 *  OpenLen is the sender of record on the shared domain, so its operating-
 *  entity address (set via env) satisfies it. */
export function broadcastPostalAddress(): string {
  return process.env.BROADCAST_POSTAL_ADDRESS?.trim() || POSTAL_PLACEHOLDER;
}

/** True when a REAL postal address is configured. In production a campaign
 *  must NOT go out on the placeholder (it would violate CAN-SPAM), so the
 *  send route refuses until BROADCAST_POSTAL_ADDRESS is set. In dev the
 *  placeholder is fine for testing. */
export function isBroadcastPostalConfigured(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  const v = process.env.BROADCAST_POSTAL_ADDRESS?.trim();
  return !!v && v !== POSTAL_PLACEHOLDER;
}

/** Minimal, XSS-safe Markdown → HTML for broadcast bodies. Escapes first,
 *  then applies a tiny allowlist: links (http/https only), bold, italic,
 *  paragraphs (blank line) + line breaks. No raw HTML ever survives. */
export function renderBroadcastBody(markdown: string): string {
  let html = escape(markdown);
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_m, text, url) => `<a href="${url}" style="color:#2563eb;">${text}</a>`,
  );
  html = html
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(?<![*\w])\*([^*\n]+)\*(?![*\w])/g, "<em>$1</em>");
  return html
    .split(/\n{2,}/)
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#1f2937;">${p.replace(/\n/g, "<br>")}</p>`,
    )
    .join("");
}

/** Build ONE recipient's broadcast email (html + text), with the mandatory
 *  footer. The unsubscribe link is non-negotiable — a test asserts every
 *  rendered email contains it. */
export function buildBroadcastEmail(params: {
  subject: string;
  bodyMarkdown: string;
  siteTitle: string;
  locale?: string | null;
  unsubUrl: string;
}): { html: string; text: string } {
  const t = broadcastFooterStringsFor(params.locale);
  const site = params.siteTitle.trim() || "this site";
  const postal = broadcastPostalAddress();
  const bodyHtml = renderBroadcastBody(params.bodyMarkdown);

  const html = `<!doctype html>
<html>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif;background:#fafafa;margin:0;padding:32px;color:#0a0a0a;">
  <table align="center" style="max-width:560px;width:100%;background:#fff;border-radius:16px;padding:32px;border:1px solid #e5e5e5;">
    <tr><td>
      <h1 style="font-size:21px;margin:0 0 20px;letter-spacing:-0.02em;">${escape(params.subject)}</h1>
      ${bodyHtml}
      <hr style="border:none;border-top:1px solid #ececec;margin:28px 0 16px;">
      <p style="font-size:11.5px;line-height:1.6;color:#9ca3af;margin:0;">
        ${escape(t.why.replace("{site}", site))}<br>
        ${escape(t.sentVia.replace("{site}", site))} ${escape(postal)}<br>
        <a href="${escape(params.unsubUrl)}" style="color:#6b7280;">${escape(t.unsubscribe)}</a>
      </p>
    </td></tr>
  </table>
</body>
</html>`;

  const text = [
    params.subject,
    "",
    params.bodyMarkdown,
    "",
    "—",
    t.why.replace("{site}", site),
    `${t.sentVia.replace("{site}", site)} ${postal}`,
    `${t.unsubscribe}: ${params.unsubUrl}`,
  ].join("\n");

  return { html, text };
}
