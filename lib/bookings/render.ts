// Pure rendering of booking emails — subject + HTML + text, no Resend, no
// Date.now(). Mirrors lib/broadcast/render.ts (testable, side-effect-free). The
// .ics is built separately (lib/bookings/ics.ts) and attached by the sender.

import { bookingEmailStringsFor, type BookingEmailStrings } from "@/lib/bookings/email-strings";

export type BookingEmailKind =
  | "confirmed"
  | "pending"
  | "reminder"
  | "cancelled"
  | "rescheduled"
  | "creatorNew";

export interface RenderBookingParams {
  kind: BookingEmailKind;
  locale?: string | null;
  serviceName: string;
  serviceDescription?: string | null;
  locationText?: string | null;
  startUtc: Date;
  endUtc: Date;
  tz: string; // recipient display zone
  guestName?: string | null;
  guestEmail?: string | null;
  manageUrl?: string | null; // visitor emails only
  hasIcs?: boolean;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function formatWhen(start: Date, tz: string, locale?: string | null): string {
  const loc = (locale ?? "en").slice(0, 2).toLowerCase() === "es" ? "es-MX" : "en-GB";
  try {
    return new Intl.DateTimeFormat(loc, {
      timeZone: tz,
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(start);
  } catch {
    return start.toISOString();
  }
}

function pick(kind: BookingEmailKind, t: BookingEmailStrings): { subject: string; heading: string; note?: string } {
  switch (kind) {
    case "confirmed":
      return { subject: t.confirmedSubject, heading: t.confirmedHeading };
    case "pending":
      return { subject: t.pendingSubject, heading: t.pendingHeading, note: t.pendingNote };
    case "reminder":
      return { subject: t.reminderSubject, heading: t.reminderHeading };
    case "cancelled":
      return { subject: t.cancelledSubject, heading: t.cancelledHeading };
    case "rescheduled":
      return { subject: t.rescheduledSubject, heading: t.rescheduledHeading };
    case "creatorNew":
      return { subject: t.creatorNewSubject, heading: t.creatorNewHeading };
  }
}

export function renderBookingEmail(p: RenderBookingParams): RenderedEmail {
  const t = bookingEmailStringsFor(p.locale);
  const { subject: subjTpl, heading, note } = pick(p.kind, t);
  const service = p.serviceName.trim() || "Booking";
  const subject = subjTpl.replace("{service}", service);
  const when = `${formatWhen(p.startUtc, p.tz, p.locale)} (${p.tz})`;
  const isCancelled = p.kind === "cancelled";
  const showManage = !!p.manageUrl && !isCancelled;

  const rows: Array<[string, string]> = [[t.whenLabel, when]];
  if (p.locationText) rows.push([t.whereLabel, p.locationText]);
  if (p.kind === "creatorNew" && (p.guestName || p.guestEmail)) {
    rows.push([t.whoLabel, [p.guestName, p.guestEmail].filter(Boolean).join(" · ")]);
  }

  const rowsHtml = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:10px 0;border-top:1px solid #f0f0f0;color:#737373;font-size:13px;">${esc(k)}</td><td style="padding:10px 0;border-top:1px solid #f0f0f0;text-align:right;font-weight:600;font-size:14px;">${esc(v)}</td></tr>`,
    )
    .join("");

  const manageHtml = showManage
    ? `<p style="margin:24px 0 8px;"><a href="${esc(p.manageUrl!)}" style="display:inline-block;background:#16181d;color:#fff;padding:11px 18px;border-radius:8px;text-decoration:none;font-weight:500;font-size:14px;">${esc(t.manageCta)}</a></p>
       <p style="font-size:12px;color:#737373;margin:0 0 16px;">${esc(t.manageHint)}</p>`
    : "";

  const noteHtml = note ? `<p style="font-size:14px;color:#525252;margin:0 0 16px;">${esc(note)}</p>` : "";
  const icsHtml = p.hasIcs && !isCancelled ? `<p style="font-size:12px;color:#a3a3a3;margin:8px 0 0;">${esc(t.icsNote)}</p>` : "";
  const descHtml = p.serviceDescription
    ? `<p style="font-size:14px;color:#525252;margin:0 0 16px;">${esc(p.serviceDescription)}</p>`
    : "";

  const html = `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif;background:#fafafa;margin:0;padding:32px;color:#0a0a0a;">
<table align="center" style="max-width:480px;width:100%;background:#fff;border-radius:16px;padding:32px;border:1px solid #e5e5e5;">
<tr><td>
<h1 style="font-size:20px;margin:0 0 4px;letter-spacing:-0.02em;">${esc(heading)}</h1>
<p style="font-size:14px;color:#737373;margin:0 0 20px;">${esc(service)}</p>
${descHtml}
<table style="width:100%;border-collapse:collapse;margin:0 0 8px;">${rowsHtml}</table>
${noteHtml}
${manageHtml}
${icsHtml}
<p style="font-size:12px;color:#a3a3a3;margin:20px 0 0;">${esc(t.ignore)}</p>
</td></tr></table></body></html>`;

  const textLines = [
    heading,
    service,
    "",
    ...(p.serviceDescription ? [p.serviceDescription, ""] : []),
    ...rows.map(([k, v]) => `${k}: ${v}`),
    ...(note ? ["", note] : []),
    ...(showManage ? ["", t.manageCta + ": " + p.manageUrl] : []),
  ];
  return { subject, html, text: textLines.join("\n") };
}
