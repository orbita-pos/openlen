// Hand-rolled iCalendar (RFC 5545) for booking invites — no library. One
// VEVENT per booking. The UID is stable (the booking id) so a later UPDATE
// (reschedule) or CANCEL with a higher SEQUENCE supersedes the original in the
// attendee's calendar. Times are emitted in UTC ("Z") — unambiguous, the whole
// reason we store UTC. Pure: the caller passes `dtstamp` (no Date.now() here).

export type IcsMethod = "REQUEST" | "CANCEL";

export interface IcsEvent {
  uid: string; // the booking id (without domain — added here)
  sequence: number;
  method: IcsMethod;
  startUtc: Date;
  endUtc: Date;
  dtstamp: Date;
  summary: string;
  description?: string;
  location?: string;
  organizerName?: string;
  organizerEmail?: string;
  attendeeName?: string;
  attendeeEmail?: string;
}

const UID_DOMAIN = "bookings.openlen.com";

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** YYYYMMDDTHHMMSSZ in UTC. */
function stamp(d: Date): string {
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/** Escape a TEXT value per RFC 5545 §3.3.11 (backslash, semicolon, comma,
 *  newline). Colons are NOT escaped in TEXT. */
function esc(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Fold a content line to ≤75 octets with CRLF + single space continuation.
 *  We fold on character count (a safe over-approximation for our ASCII-leaning
 *  content; multi-byte chars only make lines shorter than the octet limit). */
function fold(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let i = 0;
  parts.push(line.slice(0, 75));
  i = 75;
  while (i < line.length) {
    parts.push(" " + line.slice(i, i + 74));
    i += 74;
  }
  return parts.join("\r\n");
}

export function buildIcs(ev: IcsEvent): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//OpenLen//Bookings//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${ev.method}`,
    "BEGIN:VEVENT",
    `UID:${esc(ev.uid)}@${UID_DOMAIN}`,
    `SEQUENCE:${Math.max(0, Math.floor(ev.sequence))}`,
    `DTSTAMP:${stamp(ev.dtstamp)}`,
    `DTSTART:${stamp(ev.startUtc)}`,
    `DTEND:${stamp(ev.endUtc)}`,
    `SUMMARY:${esc(ev.summary)}`,
  ];
  if (ev.description) lines.push(`DESCRIPTION:${esc(ev.description)}`);
  if (ev.location) lines.push(`LOCATION:${esc(ev.location)}`);
  if (ev.organizerEmail) {
    const cn = ev.organizerName ? `;CN=${esc(ev.organizerName)}` : "";
    lines.push(`ORGANIZER${cn}:mailto:${ev.organizerEmail}`);
  }
  if (ev.attendeeEmail) {
    const cn = ev.attendeeName ? `;CN=${esc(ev.attendeeName)}` : "";
    lines.push(`ATTENDEE${cn};RSVP=TRUE:mailto:${ev.attendeeEmail}`);
  }
  lines.push(`STATUS:${ev.method === "CANCEL" ? "CANCELLED" : "CONFIRMED"}`);
  lines.push("END:VEVENT", "END:VCALENDAR");

  return lines.map(fold).join("\r\n") + "\r\n";
}
