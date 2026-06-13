// Two-sided booking emails — the visitor (in their saved zone) and, for new /
// cancelled / rescheduled bookings, the creator (in the service zone). Builds
// the .ics with the booking's current SEQUENCE so a reschedule/cancel
// supersedes the prior invite. Best-effort: an email failure never breaks the
// booking action that triggered it (the caller awaits but we swallow here).

import { sendBookingEmail } from "@/lib/email";
import { buildIcs } from "@/lib/bookings/ics";
import { manageUrl } from "@/lib/bookings/manage-token";
import { renderBookingEmail, type BookingEmailKind } from "@/lib/bookings/render";
import type { BookingRow } from "@/lib/bookings/store";

export type BookingNotifyKind = "confirmed" | "pending" | "reminder" | "cancelled" | "rescheduled";

export interface NotifyParams {
  kind: BookingNotifyKind;
  booking: BookingRow;
  serviceName: string;
  serviceDescription?: string | null;
  locationText?: string | null;
  sub: string;
  baseUrl: string;
  locale?: string | null;
  ownerEmail?: string | null;
  ownerName?: string | null;
  /** Send the creator a notice too (new / cancelled / rescheduled). */
  notifyCreator?: boolean;
}

export async function notifyBooking(p: NotifyParams): Promise<void> {
  try {
    const b = p.booking;
    const visitorTz = b.visitorTz || b.creatorTz;
    const isCancel = p.kind === "cancelled";
    const ics = buildIcs({
      uid: b.id,
      sequence: b.icsSequence,
      method: isCancel ? "CANCEL" : "REQUEST",
      startUtc: b.startUtc,
      endUtc: b.endUtc,
      dtstamp: new Date(),
      summary: p.serviceName,
      description: p.serviceDescription ?? undefined,
      location: p.locationText ?? undefined,
      organizerName: p.ownerName ?? undefined,
      organizerEmail: p.ownerEmail ?? undefined,
      attendeeName: b.guestName ?? undefined,
      attendeeEmail: b.guestEmail ?? undefined,
    });

    // ── Visitor ──
    if (b.guestEmail) {
      const mUrl =
        isCancel ? null : manageUrl({ baseUrl: p.baseUrl, sub: p.sub, projectId: b.projectId, bookingId: b.id });
      const rendered = renderBookingEmail({
        kind: p.kind as BookingEmailKind,
        locale: p.locale,
        serviceName: p.serviceName,
        serviceDescription: p.serviceDescription,
        locationText: p.locationText,
        startUtc: b.startUtc,
        endUtc: b.endUtc,
        tz: visitorTz,
        guestName: b.guestName,
        guestEmail: b.guestEmail,
        manageUrl: mUrl,
        hasIcs: true,
      });
      await sendBookingEmail({
        to: b.guestEmail,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        ics,
        icsFilename: "booking.ics",
      });
    }

    // ── Creator ──
    if (p.notifyCreator && p.ownerEmail && p.kind !== "reminder") {
      const creatorKind: BookingEmailKind =
        p.kind === "confirmed" || p.kind === "pending" ? "creatorNew" : p.kind;
      const rendered = renderBookingEmail({
        kind: creatorKind,
        locale: p.locale,
        serviceName: p.serviceName,
        serviceDescription: p.serviceDescription,
        locationText: p.locationText,
        startUtc: b.startUtc,
        endUtc: b.endUtc,
        tz: b.creatorTz,
        guestName: b.guestName,
        guestEmail: b.guestEmail,
        manageUrl: null,
        hasIcs: true,
      });
      await sendBookingEmail({
        to: p.ownerEmail,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        ics,
        icsFilename: "booking.ics",
      });
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[bookings/notify] send failed", err);
  }
}
