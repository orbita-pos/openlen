// The tracker snippet injected into every published OpenLen page at
// publish time. ~700 bytes minified. Self-contained IIFE wrapped in
// try/catch so a broken sendBeacon implementation can never block the
// user's actual page interaction.
//
// What it sends:
//   POST /c/<projectId> { t:"v", r:<referrer>, p:<page> }            -- pageview
//   POST /c/<projectId> { t:"c", h:<href>, l:<linkLabel>, p:<page> } -- outbound click
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

const SNIPPET_TEMPLATE = (projectId: string, page: string | null) => `<script>(function(){
var P=${JSON.stringify(projectId)},G=${JSON.stringify(page)},E="/c/"+P;
function s(d){try{d.p=G;var b=JSON.stringify(d);
if(navigator.sendBeacon)navigator.sendBeacon(E,b);
else fetch(E,{method:"POST",body:b,keepalive:true,headers:{"content-type":"application/json"}});}catch(e){}}
s({t:"v",r:document.referrer||null});
document.addEventListener("click",function(e){
var a=e.target.closest&&e.target.closest('a[href^=http]');if(!a)return;
try{if(new URL(a.href).host===location.host)return;}catch(_){return;}
s({t:"c",h:a.href,l:(a.textContent||"").trim().slice(0,80)});
},true);})();</script>`;

/** Insert the analytics snippet right before `</body>`. If the document has
 *  no body close tag (very malformed HTML), append at the end — the IIFE
 *  works wherever the browser parses it. */
export function injectAnalyticsSnippet(
  html: string,
  projectId: string,
  page: string | null = null,
): string {
  const snippet = SNIPPET_TEMPLATE(projectId, page);
  const idx = html.lastIndexOf("</body>");
  if (idx === -1) return html + snippet;
  return html.slice(0, idx) + snippet + html.slice(idx);
}
