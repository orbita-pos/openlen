import { z } from "zod";
import {
  getBooking,
  getService,
  cancelBooking,
  recordBookingEvent,
  type BookingRow,
} from "@/lib/bookings/store";
import { manageToken, verifyManageToken } from "@/lib/bookings/manage-token";
import { notifyBooking } from "@/lib/bookings/notify";
import { html, json, loadBookingsSite, siteBaseUrl } from "../_shared";

// /api/bk/[sub]/manage?b=<bookingId>&t=<token> — the link in a booking email.
//
// GET  → a self-contained HTML page showing the booking + Reschedule / Cancel.
//        No login: the HMAC token IS the bearer credential for THIS booking.
//        No meta-CSP (mirrors not-found-page) — it's a standalone leaf page.
// POST { b, t, action: "cancel" } → cancel the booking (idempotent).
//
// Rescheduling runs client-side against the endpoints that already own it:
// GET /availability for the open slots, POST /reschedule to move. That route
// mints a NEW booking row and cancels the old one, so the link in the original
// email resolves through `rescheduledToId` to whatever the booking is now, and
// the page hands the widget a token minted for THAT id.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHAIN_MAX = 8;

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
  serviceId: string;
  token: string;
}): string {
  const canChange = !opts.cancelled && (opts.status === "confirmed" || opts.status === "pending");
  // No live service (archived) → nothing to move it to; cancelling still works.
  const canReschedule = canChange && !!opts.serviceId;
  const cfg = JSON.stringify({
    sub: opts.sub,
    b: opts.bookingId,
    t: opts.token,
    service: opts.serviceId,
    tz: opts.tz,
  }).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(opts.title)}</title>
<style>
:root{color-scheme:light}
*{box-sizing:border-box}
[hidden]{display:none!important}
body{margin:0;font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f4f4f5;color:#18181b;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
.card{background:#fff;border:1px solid #e4e4e7;border-radius:16px;max-width:440px;width:100%;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
h1{font-size:20px;margin:0 0 4px}
.muted{color:#71717a;font-size:14px;margin:0 0 24px}
.row{display:flex;justify-content:space-between;gap:16px;padding:12px 0;border-top:1px solid #f4f4f5}
.row:first-of-type{border-top:0}
.k{color:#71717a}.v{font-weight:600;text-align:right}
.badge{display:inline-block;padding:2px 10px;border-radius:999px;font-size:13px;font-weight:600}
.b-confirmed{background:#dcfce7;color:#166534}.b-pending{background:#fef9c3;color:#854d0e}.b-cancelled{background:#fee2e2;color:#991b1b}
.actions{margin-top:24px;display:grid;gap:8px}
.btn{width:100%;padding:12px;border-radius:10px;border:1px solid transparent;font-weight:600;font-size:15px;cursor:pointer;font-family:inherit}
.btn:disabled{opacity:.5;cursor:default}
.primary{background:#18181b;color:#fff}
.primary:hover:not(:disabled){background:#3f3f46}
.danger{background:#fff;color:#ef4444;border-color:#ef4444}
.danger:hover{background:#ef4444;color:#fff}
.rs{margin-top:20px;border-top:1px solid #f4f4f5;padding-top:16px}
.rsh{font-size:16px;margin:0 0 12px}
.lbl{font-size:13px;font-weight:600;margin:0 0 8px}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px}
.chip{padding:7px 12px;border-radius:999px;border:1px solid #e4e4e7;background:#fff;color:#18181b;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer}
.chip:hover{border-color:#18181b}
.chip[aria-pressed="true"]{background:#18181b;color:#fff;border-color:#18181b}
.note{font-size:13px;color:#71717a;margin:0}
.done{margin-top:24px;text-align:center;color:#71717a;font-size:14px}
</style></head><body>
<div class="card">
<h1>${esc(opts.serviceName)}</h1>
<p class="muted">Your booking</p>
<div class="row"><span class="k">When</span><span class="v">${esc(opts.when)}</span></div>
<div class="row"><span class="k">Time zone</span><span class="v">${esc(opts.tz)}</span></div>
<div class="row"><span class="k">Status</span><span class="v"><span class="badge b-${esc(opts.status)}">${esc(opts.status)}</span></span></div>
${
  canChange
    ? `<div class="actions">
${canReschedule ? `<button type="button" class="btn primary" id="rs-open" hidden>Reschedule</button>` : ""}
<form method="post"><input type="hidden" name="b" value="${esc(opts.bookingId)}"><input type="hidden" name="t" value="${esc(opts.token)}"><input type="hidden" name="action" value="cancel"><button type="submit" class="btn danger">Cancel booking</button></form>
</div>
${
  canReschedule
    ? `<div class="rs" id="rs" hidden>
<h2 class="rsh">Reschedule</h2>
<p class="lbl">Pick a day</p><div class="chips" id="rs-days"></div>
<div id="rs-times-wrap" hidden><p class="lbl">Pick a time</p><div class="chips" id="rs-times"></div></div>
<button type="button" class="btn primary" id="rs-go" hidden>Confirm new time</button>
<p class="note" id="rs-note" role="status"></p>
</div>
<script>${rescheduleScript(cfg)}</script>`
    : ""
}`
    : opts.cancelled
      ? `<p class="done">This booking has been cancelled.</p>`
      : `<p class="done">This booking can no longer be changed.</p>`
}
</div></body></html>`;
}

function rescheduleScript(cfg: string): string {
  return `(function(){try{
var C=${cfg};
var open=document.getElementById("rs-open"),panel=document.getElementById("rs"),
days=document.getElementById("rs-days"),timesWrap=document.getElementById("rs-times-wrap"),
times=document.getElementById("rs-times"),go=document.getElementById("rs-go"),note=document.getElementById("rs-note");
var byDate={},picked=null;
function say(m){note.textContent=m}
function chip(parent,label,on){var b=document.createElement("button");b.type="button";b.className="chip";b.textContent=label;b.setAttribute("aria-pressed","false");
b.addEventListener("click",function(){var kids=parent.children;for(var i=0;i<kids.length;i++)kids[i].setAttribute("aria-pressed","false");b.setAttribute("aria-pressed","true");on()});
parent.appendChild(b);return b}
function dayLabel(ms){try{return new Date(ms).toLocaleDateString("en-GB",{weekday:"short",day:"numeric",month:"short",timeZone:C.tz})}catch(e){return new Date(ms).toDateString()}}
function showTimes(date){picked=null;go.hidden=true;times.textContent="";timesWrap.hidden=false;
(byDate[date]||[]).forEach(function(s){chip(times,s.label,function(){picked=s.start;go.hidden=false})})}
function load(){days.textContent="";times.textContent="";timesWrap.hidden=true;go.hidden=true;picked=null;say("Loading available times…");
var from=Date.now(),to=from+45*86400000;
fetch("/api/bk/"+C.sub+"/availability?service="+encodeURIComponent(C.service)+"&from="+from+"&to="+to+"&tz="+encodeURIComponent(C.tz))
.then(function(r){return r.json()}).then(function(j){
byDate={};(j.slots||[]).forEach(function(s){(byDate[s.date]=byDate[s.date]||[]).push(s)});
var dates=Object.keys(byDate).sort();
if(!dates.length){say("No other times are open right now.");return}
say("");dates.forEach(function(d){chip(days,dayLabel(byDate[d][0].start),function(){showTimes(d)})})
}).catch(function(){say("Couldn't load the available times. Try again.")})}
open.addEventListener("click",function(){open.hidden=true;panel.hidden=false;load()});
go.addEventListener("click",function(){if(picked===null)return;go.disabled=true;say("Moving your booking…");
fetch("/api/bk/"+C.sub+"/reschedule",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({b:C.b,t:C.t,newStartUtcMs:picked})})
.then(function(r){return r.json().then(function(j){return{ok:r.ok,status:r.status,j:j}},function(){return{ok:r.ok,status:r.status,j:null}})})
.then(function(res){if(res.ok){location.reload();return}
go.disabled=false;
if(res.status===409){say("That time was just taken. Pick another one.");load()}
else{say("Couldn't move your booking. Try again.")}})
.catch(function(){go.disabled=false;say("Couldn't move your booking. Try again.")})});
open.hidden=false;
}catch(e){}})();`;
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

/** A rescheduled booking lives on under a new id — walk the links so an old
 *  email still lands on the appointment the visitor actually has. */
async function followReschedules(projectId: string, from: BookingRow): Promise<BookingRow> {
  let cur = from;
  for (let i = 0; i < CHAIN_MAX && cur.rescheduledToId; i++) {
    const next = await getBooking(projectId, cur.rescheduledToId);
    if (!next) break;
    cur = next;
  }
  return cur;
}

const notFound = (sub: string) =>
  page({
    title: "Booking not found",
    serviceName: "Booking",
    when: "—",
    tz: "—",
    status: "cancelled",
    cancelled: true,
    sub,
    bookingId: "",
    serviceId: "",
    token: "",
  });

async function render(
  sub: string,
  bookingId: string,
  token: string,
  doCancel: boolean,
  baseUrl: string,
): Promise<Response> {
  const site = await loadBookingsSite(sub);
  if (!site || !bookingId || !verifyManageToken(site.projectId, bookingId, token)) {
    return html(notFound(sub), 404);
  }

  const linked = await getBooking(site.projectId, bookingId);
  if (!linked) return html(notFound(sub), 404);
  let booking = await followReschedules(site.projectId, linked);
  // Acting on the CURRENT booking needs a token for ITS id — the emailed one is
  // bound to the id the visitor started from.
  const actingToken =
    booking.id === bookingId ? token : manageToken(site.projectId, booking.id);

  if (doCancel) {
    const cancelled = await cancelBooking(site.projectId, booking.id);
    if (cancelled) {
      booking = cancelled;
      await recordBookingEvent(site.projectId, booking.id, "cancelled", "visitor");
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
      booking = (await getBooking(site.projectId, booking.id)) ?? booking;
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
      serviceId: service?.status === "active" ? booking.serviceId : "",
      token: actingToken,
    }),
    200,
  );
}
