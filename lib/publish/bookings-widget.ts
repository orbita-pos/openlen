// Publish-time injection of the bookings widget. Mirrors the comments widget:
// a self-contained IIFE in a Shadow DOM (total CSS isolation), inserted at
// publish, that can never break the host page.
//
// Placement: a `data-ol-bookings-section` placeholder (dragged in from the
// Section Library) renders the widget THERE; otherwise it's appended before
// </body>. The script tag is marked `data-ol-bookings-widget` (idempotency +
// CSP — sealed like every inline runtime; this string MUST stay byte-stable).
//
// All API calls are RELATIVE (/api/bk/<sub>/* and /api/m/<sub>/*) so the
// host-only ol_member cookie stays first-party on the published host. The
// widget embeds all known UI strings and picks by <html lang> at runtime (en +
// es are full; other locales fall back to en — the booking DATA is always in
// the visitor's own time zone regardless).
//
// XSS-safe: every dynamic value renders via textContent / createElement.

import { cidExpr } from "@/lib/analytics/cid";

interface BookingsStrings {
  title: string;
  loading: string;
  noSlots: string;
  pickDate: string;
  pickTime: string;
  details: string;
  name: string;
  email: string;
  note: string;
  book: string;
  booking: string;
  confirmedTitle: string;
  confirmedBody: string;
  pendingTitle: string;
  pendingBody: string;
  manage: string;
  loginCta: string;
  sendLink: string;
  checkInbox: string;
  error: string;
  back: string;
  tzNote: string;
  duration: string; // "{n} min"
}

const EN: BookingsStrings = {
  title: "Book a time",
  loading: "Loading…",
  noSlots: "No times available right now.",
  pickDate: "Pick a day",
  pickTime: "Pick a time",
  details: "Your details",
  name: "Your name",
  email: "you@email.com",
  note: "Anything we should know? (optional)",
  book: "Book",
  booking: "Booking…",
  confirmedTitle: "You're booked!",
  confirmedBody: "We've emailed you the details.",
  pendingTitle: "Request sent",
  pendingBody: "We'll confirm by email shortly.",
  manage: "Manage booking",
  loginCta: "Log in to book",
  sendLink: "Send me a link",
  checkInbox: "Check your inbox to finish signing in.",
  error: "Something went wrong. Try again.",
  back: "Back",
  tzNote: "Times shown in your time zone",
  duration: "{n} min",
};

const ES: BookingsStrings = {
  title: "Reserva una hora",
  loading: "Cargando…",
  noSlots: "No hay horarios disponibles por ahora.",
  pickDate: "Elige un día",
  pickTime: "Elige una hora",
  details: "Tus datos",
  name: "Tu nombre",
  email: "tu@email.com",
  note: "¿Algo que debamos saber? (opcional)",
  book: "Reservar",
  booking: "Reservando…",
  confirmedTitle: "¡Reservado!",
  confirmedBody: "Te enviamos los detalles por correo.",
  pendingTitle: "Solicitud enviada",
  pendingBody: "Te confirmaremos por correo en breve.",
  manage: "Gestionar reserva",
  loginCta: "Inicia sesión para reservar",
  sendLink: "Enviarme un enlace",
  checkInbox: "Revisa tu correo para terminar de entrar.",
  error: "Algo salió mal. Inténtalo de nuevo.",
  back: "Atrás",
  tzNote: "Horarios en tu zona horaria",
  duration: "{n} min",
};

const STRINGS: Record<string, BookingsStrings> = { en: EN, es: ES };

export interface BookingsWidgetConfig {
  sub: string;
}

const WIDGET_MARKER = "data-ol-bookings-widget";
const SECTION_MARKER = "data-ol-bookings-section";
const HOST_MARKER = "data-ol-bookings-host";

function widgetScript(cfg: BookingsWidgetConfig): string {
  const C = JSON.stringify({ sub: cfg.sub, S: STRINGS }).replace(/</g, "\\u003c");

  return `<script ${WIDGET_MARKER}>(function(){try{
var C=${C};
var L=(document.documentElement.lang||"en").slice(0,2).toLowerCase();
var T=C.S[L]||C.S.en;
var host=document.querySelector("[${HOST_MARKER}]");
if(!host||host.shadowRoot)return;
var TZ;try{TZ=Intl.DateTimeFormat().resolvedOptions().timeZone}catch(e){TZ=""}
var R=host.attachShadow({mode:"open"});
var api=function(u,o){return fetch("/api/bk/"+C.sub+u,o||{})};
R.innerHTML='<style>'
+':host{all:initial;display:block}'
+'*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}'
+'.w{max-width:560px;margin:32px auto;padding:0 16px;color:#1a1a1a}'
+'.h{font-size:20px;font-weight:700;margin:0 0 4px}'
+'.tz{font-size:12px;color:#9a9aa0;margin:0 0 16px}'
+'.svc{border:1px solid #e4e4e7;border-radius:12px;padding:14px;margin-bottom:8px;cursor:pointer;background:#fff;width:100%;text-align:left;display:block}'
+'.svc:hover{border-color:#16181d}.svc:focus-visible{outline:2px solid #16181d}'
+'.svc .n{font-weight:600;font-size:15px}'
+'.svc .d{font-size:13px;color:#71717a;margin-top:2px}'
+'.svc .m{font-size:12px;color:#9a9aa0;margin-top:6px}'
+'.lbl{font-size:13px;font-weight:600;margin:16px 0 8px}'
+'.grid{display:flex;flex-wrap:wrap;gap:8px}'
+'.chip{min-height:40px;padding:0 14px;border:1px solid #d8d8dc;border-radius:10px;background:#fff;font-size:13.5px;font-weight:600;cursor:pointer}'
+'.chip:hover{border-color:#16181d}.chip:focus-visible{outline:2px solid #16181d}'
+'.chip[aria-pressed="true"]{background:#16181d;color:#fff;border-color:#16181d}'
+'.f input,.f textarea{width:100%;min-height:42px;border:1px solid #d8d8dc;border-radius:10px;padding:10px 12px;font-size:14px;margin-top:8px;font-family:inherit}'
+'.f textarea{min-height:72px;resize:vertical}'
+'.f input:focus,.f textarea:focus{outline:2px solid #16181d;border-color:#16181d}'
+'.pri{min-height:44px;margin-top:12px;padding:0 20px;border:0;border-radius:10px;background:#16181d;color:#fff;font-weight:600;font-size:14px;cursor:pointer}'
+'.pri:disabled{opacity:.5;cursor:default}'
+'.lnk{background:none;border:0;color:#6b7280;font-size:13px;cursor:pointer;padding:8px 0;text-decoration:underline}'
+'.msg{font-size:13px;color:#6b7280;margin-top:10px}'
+'.ok{text-align:center;padding:24px 0}.ok .t{font-size:18px;font-weight:700}.ok .b{font-size:14px;color:#71717a;margin-top:6px}'
+'.mlink{display:inline-block;margin-top:14px;font-size:13px;color:#16181d}'
+'</style><div class="w" role="group"><div class="h"></div><div class="tz"></div><div class="body" aria-live="polite"></div></div>';
var hEl=R.querySelector(".h"),tzEl=R.querySelector(".tz"),body=R.querySelector(".body");
hEl.textContent=T.title;tzEl.textContent=T.tzNote+(TZ?" ("+TZ+")":"");
var state={requireLogin:false,services:[],service:null,slots:[],byDate:{},date:null,slot:null,member:false,memberName:null};

function clear(){while(body.firstChild)body.removeChild(body.firstChild)}
function setMsg(text){var m=document.createElement("div");m.className="msg";m.setAttribute("role","status");m.textContent=text;body.appendChild(m)}
function dayLabel(ms){try{return new Date(ms).toLocaleDateString(L==="es"?"es-MX":"en-GB",{weekday:"long",day:"numeric",month:"long",timeZone:TZ||undefined})}catch(e){return""}}

function loadServices(){clear();setMsg(T.loading);
api("/services").then(function(r){return r.json()}).then(function(j){
state.requireLogin=!!j.requireLogin;state.services=j.services||[];
if(!state.services.length){clear();setMsg(T.noSlots);return}
if(state.services.length===1){chooseService(state.services[0])}else{renderServices()}
}).catch(function(){clear();setMsg(T.error)})}

function renderServices(){clear();
state.services.forEach(function(s){var b=document.createElement("button");b.type="button";b.className="svc";
var n=document.createElement("div");n.className="n";n.textContent=s.name;b.appendChild(n);
if(s.description){var d=document.createElement("div");d.className="d";d.textContent=s.description;b.appendChild(d)}
var meta=[T.duration.replace("{n}",String(s.durationMin))];if(s.priceDisplay)meta.push(s.priceDisplay);if(s.locationText)meta.push(s.locationText);
var m=document.createElement("div");m.className="m";m.textContent=meta.join(" · ");b.appendChild(m);
b.addEventListener("click",function(){chooseService(s)});body.appendChild(b)})}

function chooseService(s){state.service=s;loadAvailability()}

function loadAvailability(){clear();setMsg(T.loading);
var from=Date.now(),to=from+60*86400000;
api("/availability?service="+encodeURIComponent(state.service.id)+"&from="+from+"&to="+to+"&tz="+encodeURIComponent(TZ)).then(function(r){return r.json()}).then(function(j){
state.slots=j.slots||[];state.byDate={};
state.slots.forEach(function(sl){(state.byDate[sl.date]=state.byDate[sl.date]||[]).push(sl)});
renderDates()}).catch(function(){clear();setMsg(T.error)})}

function renderDates(){clear();
if(state.services.length>1){var back=document.createElement("button");back.type="button";back.className="lnk";back.textContent="‹ "+T.back;back.addEventListener("click",renderServices);body.appendChild(back)}
var dates=Object.keys(state.byDate).sort();
if(!dates.length){setMsg(T.noSlots);return}
var lbl=document.createElement("div");lbl.className="lbl";lbl.textContent=T.pickDate;body.appendChild(lbl);
var grid=document.createElement("div");grid.className="grid";body.appendChild(grid);
dates.forEach(function(d){var first=state.byDate[d][0];var c=document.createElement("button");c.type="button";c.className="chip";c.textContent=dayLabel(first.start);
c.setAttribute("aria-pressed",state.date===d?"true":"false");
c.addEventListener("click",function(){state.date=d;state.slot=null;renderDates();renderTimes()});grid.appendChild(c)});
if(state.date)renderTimes()}

function renderTimes(){var old=R.querySelector(".times");if(old)old.parentNode.removeChild(old);
var wrap=document.createElement("div");wrap.className="times";
var lbl=document.createElement("div");lbl.className="lbl";lbl.textContent=T.pickTime;wrap.appendChild(lbl);
var grid=document.createElement("div");grid.className="grid";wrap.appendChild(grid);
(state.byDate[state.date]||[]).forEach(function(sl){var c=document.createElement("button");c.type="button";c.className="chip";c.textContent=sl.label;
c.setAttribute("aria-pressed",state.slot&&state.slot.start===sl.start?"true":"false");
c.addEventListener("click",function(){state.slot=sl;renderForm()});grid.appendChild(c)});
body.appendChild(wrap)}

function renderForm(){var old=R.querySelector(".form-wrap");if(old)old.parentNode.removeChild(old);
var wrap=document.createElement("div");wrap.className="form-wrap";
if(state.requireLogin&&!state.member){renderLogin(wrap);body.appendChild(wrap);wrap.scrollIntoView({block:"nearest"});return}
var lbl=document.createElement("div");lbl.className="lbl";lbl.textContent=T.details;wrap.appendChild(lbl);
var f=document.createElement("div");f.className="f";wrap.appendChild(f);
var nameI,emailI;
if(!state.member){nameI=document.createElement("input");nameI.type="text";nameI.placeholder=T.name;nameI.setAttribute("aria-label",T.name);f.appendChild(nameI);
emailI=document.createElement("input");emailI.type="email";emailI.placeholder=T.email;emailI.setAttribute("aria-label",T.email);f.appendChild(emailI)}
var noteI=document.createElement("textarea");noteI.placeholder=T.note;noteI.maxLength=1000;noteI.setAttribute("aria-label",T.note);f.appendChild(noteI);
var btn=document.createElement("button");btn.type="button";btn.className="pri";btn.textContent=T.book;wrap.appendChild(btn);
btn.addEventListener("click",function(){
var payload={id:(crypto.randomUUID?crypto.randomUUID():String(Date.now())+Math.random()),serviceId:state.service.id,startUtcMs:state.slot.start,visitorTz:TZ};
var __ci=${cidExpr()};if(__ci)payload.cid=__ci;
if(!state.member){var em=(emailI.value||"").trim();if(!em){emailI.focus();return}payload.email=em;payload.name=(nameI.value||"").trim()}
var nt=(noteI.value||"").trim();if(nt)payload.note=nt;
btn.disabled=true;btn.textContent=T.booking;
api("/book",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify(payload)})
.then(function(r){return r.json().then(function(j){return{ok:r.ok,j:j}})})
.then(function(res){if(!res.ok){btn.disabled=false;btn.textContent=T.book;
if(res.j&&res.j.error==="slot_unavailable"){setMsg(T.error);loadAvailability()}else if(res.j&&res.j.error==="auth"){state.member=false;state.requireLogin=true;renderForm()}else{setMsg(T.error)}return}
done(res.j)}).catch(function(){btn.disabled=false;btn.textContent=T.book;setMsg(T.error)})});
body.appendChild(wrap);wrap.scrollIntoView({block:"nearest"})}

function renderLogin(wrap){var lbl=document.createElement("div");lbl.className="lbl";lbl.textContent=T.loginCta;wrap.appendChild(lbl);
var f=document.createElement("div");f.className="f";wrap.appendChild(f);
var inp=document.createElement("input");inp.type="email";inp.placeholder=T.email;inp.setAttribute("aria-label",T.email);f.appendChild(inp);
var btn=document.createElement("button");btn.type="button";btn.className="pri";btn.textContent=T.sendLink;wrap.appendChild(btn);
btn.addEventListener("click",function(){var em=(inp.value||"").trim();if(!em){inp.focus();return}btn.disabled=true;
fetch("/api/m/"+C.sub+"/auth/request",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:em})})
.then(function(){f.innerHTML="";btn.style.display="none";setMsgIn(wrap,T.checkInbox)}).catch(function(){btn.disabled=false;setMsgIn(wrap,T.error)})})}

function setMsgIn(parent,text){var m=document.createElement("div");m.className="msg";m.setAttribute("role","status");m.textContent=text;parent.appendChild(m)}

function done(j){clear();var ok=document.createElement("div");ok.className="ok";
var t=document.createElement("div");t.className="t";t.textContent=j.status==="confirmed"?T.confirmedTitle:T.pendingTitle;
var b=document.createElement("div");b.className="b";b.textContent=j.status==="confirmed"?T.confirmedBody:T.pendingBody;
ok.appendChild(t);ok.appendChild(b);
if(j.bookingId&&j.manageToken){var a=document.createElement("a");a.className="mlink";a.href="/api/bk/"+C.sub+"/manage?b="+encodeURIComponent(j.bookingId)+"&t="+encodeURIComponent(j.manageToken);a.textContent=T.manage;ok.appendChild(a)}
body.appendChild(ok)}

api("/me",{credentials:"same-origin"}).then(function(r){return r.json()}).then(function(j){if(j&&j.member){state.member=true;state.memberName=j.name}}).catch(function(){}).then(loadServices);
}catch(e){}})();</script>`;
}

/** Inject the bookings widget. Idempotent. Renders in the
 *  data-ol-bookings-section placeholder if present, else appends before
 *  </body>. The same baked widget is copied into translated locale variants —
 *  it picks its UI language from <html lang> at runtime. */
export function bakeBookings(html: string, cfg: BookingsWidgetConfig): string {
  if (html.includes(WIDGET_MARKER)) return html;
  const block = `<div ${HOST_MARKER}></div>${widgetScript(cfg)}`;

  const markerRe = new RegExp(
    `<(section|div)([^>]*\\b${SECTION_MARKER}\\b[^>]*)>[\\s\\S]*?<\\/\\1>`,
    "i",
  );
  if (markerRe.test(html)) {
    return html.replace(markerRe, (_m, tag, attrs) => `<${tag}${attrs}>${block}</${tag}>`);
  }

  const idx = html.lastIndexOf("</body>");
  return idx === -1 ? html + block : html.slice(0, idx) + block + html.slice(idx);
}
