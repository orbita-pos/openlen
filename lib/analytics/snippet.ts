// The tracker snippet injected into every published OpenLen page at
// publish time. ~700 bytes minified. Self-contained IIFE wrapped in
// try/catch so a broken sendBeacon implementation can never block the
// user's actual page interaction.
//
// What it sends:
//   POST /c/<projectId> { t:"v", r:<referrer>, p:<page>, cid, s:<source> } -- pageview
//   POST /c/<projectId> { t:"c", h:<href>, l:<linkLabel>, p:<page>, cid }  -- outbound click
//
// `cid` is the session visitor id (lib/analytics/cid.ts) stamped on every
// beacon so the Insights funnel can join saw → clicked → submitted → booked.
// `s` is the session's first-touch source (utm + referrer host), sent on the
// view beacon only and frozen per session, so the funnel attributes a visitor
// to one acquisition channel.
//
// `p` is the site-page slug, null on the home document. Baked at publish
// time (each document gets its own snippet copy) rather than read from
// location.pathname — deterministic, and locale variants (/es/index.html)
// correctly attribute to the document they were generated from.
//
// Why same-origin POSTs (not cross-origin to openlen.com): nginx routes
// `/c/*` on every <sub>.openlen.com to the main Next app (see
// infra/nginx/openlen.conf). Same-origin = no CORS preflight = beacon is
// fire-and-forget instant.

import { cidExpr, sourceExpr } from "@/lib/analytics/cid";
import { parseAbTag } from "@/lib/analytics/ab-tag";

// 🔴 WITHOUT AN EXPERIMENT THIS IS THE SNIPPET OF BEFORE A/B TESTING, BYTE FOR BYTE (review item 2, master 24b7a1b50;
// pinned by lib/ab/pre-ab-bytes.test.ts). The snippet is baked into every published page and a release is
// content-addressed: bytes added for a feature that is off would change every site's sha and weigh on every page.
const SNIPPET_TEMPLATE = (projectId: string, page: string | null) => `<script>(function(){
var P=${JSON.stringify(projectId)},G=${JSON.stringify(page)},E="/c/"+P;
var CID=${cidExpr()},SRC=${sourceExpr()};
function s(d){try{d.p=G;if(CID)d.cid=CID;var b=JSON.stringify(d);
if(navigator.sendBeacon)navigator.sendBeacon(E,b);
else fetch(E,{method:"POST",body:b,keepalive:true,headers:{"content-type":"application/json"}});}catch(e){}}
s({t:"v",r:document.referrer||null,s:SRC});
document.addEventListener("click",function(e){
var a=e.target.closest&&e.target.closest('a[href^=http]');if(!a)return;
try{if(new URL(a.href).host===location.host)return;}catch(_){return;}
s({t:"c",h:a.href,l:(a.textContent||"").trim().slice(0,80)});
},true);})();</script>`;

// The same snippet for a document an experiment buckets (`abTag` = `<expId>:<a|b>`, baked by publishToDir only on the
// documents the edge assigns): every beacon carries the variant (`ab`), and a click on a link or button that is not an
// outbound link is reported as a CTA click (`cta`) — what `cta_click` and `conversion_any` count.
const AB_SNIPPET_TEMPLATE = (projectId: string, page: string | null, abTag: string) => `<script>(function(){
var P=${JSON.stringify(projectId)},G=${JSON.stringify(page)},E="/c/"+P;
var CID=${cidExpr()},SRC=${sourceExpr()};
var AB=${JSON.stringify(abTag)};
function s(d){try{d.p=G;if(CID)d.cid=CID;if(AB)d.ab=AB;var b=JSON.stringify(d);
if(navigator.sendBeacon)navigator.sendBeacon(E,b);
else fetch(E,{method:"POST",body:b,keepalive:true,headers:{"content-type":"application/json"}});}catch(e){}}
s({t:"v",r:document.referrer||null,s:SRC});
document.addEventListener("click",function(e){
var t=e.target;if(!t||!t.closest)return;
var a=t.closest('a[href^=http]');
if(a){try{if(new URL(a.href).host!==location.host){s({t:"c",h:a.href,l:(a.textContent||"").trim().slice(0,80)});return;}}catch(_){}}
var cta=t.closest('a[href],button');if(!cta)return;
if(cta.tagName==="BUTTON"&&cta.type==="submit")return;
if(cta.closest('[data-ol-lang-switcher],[data-openlen-assistant],[data-openlen-chat]'))return;
s({t:"cta",h:cta.getAttribute("href")||null,l:(cta.textContent||"").trim().slice(0,80)});
},true);})();</script>`;

/** Insert the analytics snippet right before `</body>`. If the document has
 *  no body close tag (very malformed HTML), append at the end — the IIFE
 *  works wherever the browser parses it. `abTag` (an experiment's `<id>:<a|b>`)
 *  is set only for a document the experiment buckets; absent or invalid =
 *  the pre-A/B snippet. */
export function injectAnalyticsSnippet(
  html: string,
  projectId: string,
  page: string | null = null,
  abTag: string | null = null,
): string {
  const tag = parseAbTag(abTag);
  const snippet = tag ? AB_SNIPPET_TEMPLATE(projectId, page, tag) : SNIPPET_TEMPLATE(projectId, page);
  const idx = html.lastIndexOf("</body>");
  if (idx === -1) return html + snippet;
  return html.slice(0, idx) + snippet + html.slice(idx);
}
