import { z } from "zod";
import { getBooking, getService, cancelBooking, recordBookingEvent } from "@/lib/bookings/store";
import { verifyManageToken } from "@/lib/bookings/manage-token";
import { notifyBooking } from "@/lib/bookings/notify";
import { html, json, loadBookingsSite, siteBaseUrl } from "../_shared";

// /api/bk/[sub]/manage?b=<bookingId>&t=<token> — the link in a booking email.
//
// GET  → a self-contained HTML page showing the booking + a Cancel button.
//        No login: the HMAC token IS the bearer credential for THIS booking.
//        No meta-CSP (mirrors not-found-page) — it's a standalone leaf page.
// POST { b, t, action: "cancel" } → cancel the booking (idempotent).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmt(d: Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d);
  } catch {
    return d.toISOString();
  }
}

function page(opts: {
  title: string;
  serviceName: string;
  when: string;
  tz: string;
  status: string;
  cancelled: boolean;
  sub: string;
  bookingId: string;
  token: string;
}): string {
  const canCancel = !opts.cancelled && (opts.status === "confirmed" || opts.status === "pending");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(opts.title)}</title>
<style>
:root{color-scheme:light}
*{box-sizing:border-box}
body{margin:0;font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f4f4f5;color:#18181b;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
.card{background:#fff;border:1px solid #e4e4e7;border-radius:16px;max-width:440px;width:100%;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
h1{font-size:20px;margin:0 0 4px}
.muted{color:#71717a;font-size:14px;margin:0 0 24px}
.row{display:flex;justify-content:space-between;gap:16px;padding:12px 0;border-top:1px solid #f4f4f5}
.row:first-of-type{border-top:0}
.k{color:#71717a}.v{font-weight:600;text-align:right}
.badge{display:inline-block;padding:2px 10px;border-radius:999px;font-size:13px;font-weight:600}
.b-confirmed{background:#dcfce7;color:#166534}.b-pending{background:#fef9c3;color:#854d0e}.b-cancelled{background:#fee2e2;color:#991b1b}
button{margin-top:24px;width:100%;padding:12px;border-radius:10px;border:1px solid #ef4444;background:#fff;color:#ef4444;font-weight:600;font-size:15px;cursor:pointer}
button:hover{background:#ef4444;color:#fff}
.done{margin-top:24px;text-align:center;color:#71717a;font-size:14px}
</style></head><body>
<div class="card">
<h1>${esc(opts.serviceName)}</h1>
<p class="muted">Your booking</p>
<div class="row"><span class="k">When</span><span class="v">${esc(opts.when)}</span></div>
<div class="row"><span class="k">Time zone</span><span class="v">${esc(opts.tz)}</span></div>
<div class="row"><span class="k">Status</span><span class="v"><span class="badge b-${esc(opts.status)}">${esc(opts.status)}</span></span></div>
${
  canCancel
    ? `<form method="post"><input type="hidden" name="b" value="${esc(opts.bookingId)}"><input type="hidden" name="t" value="${esc(opts.token)}"><input type="hidden" name="action" value="cancel"><button type="submit">Cancel booking</button></form>`
    : opts.cancelled
      ? `<p class="done">This booking has been cancelled.</p>`
      : `<p class="done">This booking can no longer be changed.</p>`
}
</div></body></html>`;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ sub: string }> },
): Promise<Response> {
  const { sub } = await params;
  const url = new URL(req.url);
  const b = url.searchParams.get("b") || "";
  const t = url.searchParams.get("t") || "";
  return render(sub, b, t, false, siteBaseUrl(req));
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ sub: string }> },
): Promise<Response> {
  const { sub } = await params;
  // Accept both form-encoded (the HTML button) and JSON (programmatic).
  const ct = req.headers.get("content-type") || "";
  let b = "";
  let t = "";
  let action = "";
  if (ct.includes("application/json")) {
    const parsed = z
      .object({ b: z.string(), t: z.string(), action: z.string() })
      .safeParse(await req.json().catch(() => null));
    if (!parsed.success) return json({ error: "invalid_body" }, 400);
    ({ b, t, action } = parsed.data);
  } else {
    const form = await req.formData().catch(() => null);
    b = String(form?.get("b") ?? "");
    t = String(form?.get("t") ?? "");
    action = String(form?.get("action") ?? "");
  }
  if (action !== "cancel") return json({ error: "bad_action" }, 400);
  return render(sub, b, t, true, siteBaseUrl(req));
}

async function render(
  sub: string,
  bookingId: string,
  token: string,
  doCancel: boolean,
  baseUrl: string,
): Promise<Response> {
  const site = await loadBookingsSite(sub);
  if (!site || !bookingId || !verifyManageToken(site.projectId, bookingId, token)) {
    return html(
      page({
        title: "Booking not found",
        serviceName: "Booking",
        when: "—",
        tz: "—",
        status: "cancelled",
        cancelled: true,
        sub,
        bookingId: "",
        token: "",
      }),
      404,
    );
  }

  let booking = await getBooking(site.projectId, bookingId);
  if (!booking) return html(page({ title: "Booking not found", serviceName: "Booking", when: "—", tz: "—", status: "cancelled", cancelled: true, sub, bookingId: "", token: "" }), 404);

  if (doCancel) {
    const cancelled = await cancelBooking(site.projectId, bookingId);
    if (cancelled) {
      booking = cancelled;
      await recordBookingEvent(site.projectId, bookingId, "cancelled", "visitor");
      const svc = await getService(site.projectId, booking.serviceId);
      await notifyBooking({
        kind: "cancelled",
        booking,
        serviceName: svc?.name ?? "Booking",
        serviceDescription: svc?.description,
        locationText: svc?.locationText,
        sub: site.subdomain,
        baseUrl,
        locale: site.locale,
        ownerEmail: site.ownerEmail,
        ownerName: site.ownerName,
        notifyCreator: true,
      });
    } else {
      booking = (await getBooking(site.projectId, bookingId)) ?? booking;
    }
  }

  const service = await getService(site.projectId, booking.serviceId);
  const tz = booking.visitorTz || booking.creatorTz;
  return html(
    page({
      title: service?.name ?? "Booking",
      serviceName: service?.name ?? "Booking",
      when: fmt(booking.startUtc, tz),
      tz,
      status: booking.status,
      cancelled: booking.status === "cancelled",
      sub,
      bookingId: booking.id,
      token,
    }),
    200,
  );
}
