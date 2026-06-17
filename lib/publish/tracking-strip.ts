// Publish-time URL self-cleaner. Strips marketing/tracking query params
// (fbclid, gclid, utm_*, igshid, …) from the address bar on load via
// history.replaceState, so a link shared on Instagram/Facebook — which append
// ?fbclid=… — and any link a visitor then copies from the address bar stay
// clean. Purely cosmetic + privacy-friendly: no content or navigation change.
//
// Ordering: runs inside bakeDocument AFTER sanitize and BEFORE the CSP seal —
// like the analytics/motion injectors — so the seal hashes this inline script
// into script-src and it's allowed to execute. history.replaceState makes no
// network request, so the sealed connect-src never applies.
//
// The same baked snippet is copied into locale variants / site pages; it reads
// nothing page-specific, so one byte-stable string is correct everywhere. The
// marker attribute also gates idempotency (a re-bake won't double-inject).

const MARKER = "data-ol-noparams";

// Whitelist-DELETE: only these click-tracking / campaign params are removed
// (utm_* matched by prefix). Every OTHER segment of the query is kept BYTE-FOR-
// BYTE — we splice location.search by '&' and re-join the survivors verbatim
// rather than round-tripping through URLSearchParams.toString(), which would
// re-encode the whole query (%20→+, unicode → %XX, ';' → %3B, a value-less
// key gains '='). That byte-preservation matters because the rewrite fires on
// exactly the marketing-sourced traffic the feature targets (a page reached via
// ?fbclid), so a ?redirect=/?next= value or a signed param must survive intact.
// The key is decoded only for the match test; the survivor segment is never
// touched. replaceState fires only when a tracked param was actually present.
const SNIPPET = `<script ${MARKER}>(function(){try{
var s=location.search;if(s.length<2)return;
var T=['fbclid','gclid','dclid','gbraid','wbraid','msclkid','igshid','igsh','mc_cid','mc_eid','twclid','yclid','ttclid','_hsenc','_hsmi','mkt_tok','vero_id','oly_anon_id','oly_enc_id','wickedid','rb_clickid','s_cid','epik','qclid','sccid'];
var keep=[],hit=false;
s.slice(1).split('&').forEach(function(seg){if(!seg)return;
var i=seg.indexOf('='),rk=i<0?seg:seg.slice(0,i),k;
try{k=decodeURIComponent(rk.replace(/\\+/g,' '))}catch(e){k=rk}
if(k.indexOf('utm_')===0||T.indexOf(k)>-1){hit=true}else{keep.push(seg)}});
if(!hit)return;
var q=keep.join('&');
history.replaceState(null,'',location.pathname+(q?'?'+q:'')+location.hash);
}catch(e){}})();</script>`;

/** Inject the URL tracking-param cleaner just before `</body>`. Idempotent:
 *  a page that already carries the marker is returned unchanged. When there's
 *  no `</body>` (malformed fragment), the script is appended — the IIFE runs
 *  wherever the browser parses it. */
export function injectTrackingStrip(html: string): string {
  if (html.includes(MARKER)) return html;
  const idx = html.lastIndexOf("</body>");
  if (idx === -1) return html + SNIPPET;
  return html.slice(0, idx) + SNIPPET + html.slice(idx);
}
