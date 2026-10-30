// LEN WATCH'S SNIPPET (spec local 2026-10-30-len-watch, §5.1): baked into every published document
// at publish time, it tells OpenLen when what the visitor sees stayed BLANK — the app never painted.
// A page that shows something with an error underneath is a partial failure and is left alone.
//
// What it sends, once per page load:
//   POST /c/<projectId> { t:"f", m:<first startup error>, f:<its script>, l, c, p:<page slug> }
//
// The cause it keeps is the FIRST of: an uncaught error or rejection, or a script/stylesheet that
// failed to load (the usual blank page after a deploy: a bundle that isn't there). A broken image
// isn't a cause and doesn't take the slot.
//
// It goes FIRST in <head> so it hears the errors of the scripts after it; it is an IIFE in a
// try/catch, so it can never break or slow the page. It does nothing in an automated browser
// (`navigator.webdriver`): OpenLen's own check opens the page in one, and so do bots.

/** Blank = an app root with nothing in it, or (with no root) a body with no text and no media.
 *  The SAME predicate runs in the visitor's browser and in ours (lib/len-watch/check.ts). */
export const BLANK_CHECK_JS = `function(){var r=document.getElementById("root");
if(r)return r.children.length===0&&!(r.textContent||"").trim();
var b=document.body;if(!b)return true;
if((b.innerText||b.textContent||"").trim().length>0)return false;
return !b.querySelector("img,svg,canvas,video,iframe,picture");}`;

/** How long after `load` the page gets to paint before it counts as blank. */
export const WATCH_SETTLE_MS = 5_000;
/** If `load` never comes (a resource that hangs), the check runs this long after the snippet. */
export const WATCH_FALLBACK_MS = 20_000;

const MARK = "data-ol-watch";

const SNIPPET_TEMPLATE = (projectId: string, page: string | null) => `<script ${MARK}>(function(){try{
if(navigator.webdriver)return;
var P=${JSON.stringify(projectId)},G=${JSON.stringify(page)},E="/c/"+P,F=null,D=false,B=${BLANK_CHECK_JS};
function u(s){return String(s).replace(/(https?:\\/\\/[^\\s?#]+)[?#]\\S*/g,"$1");}
function k(m,f,l,c){if(F||!m)return;F={m:u(m).slice(0,300),f:f?String(f).split(/[?#]/)[0]:null,l:typeof l==="number"?l:null,c:typeof c==="number"?c:null};}
addEventListener("error",function(e){if(e)k(e.message,e.filename,e.lineno,e.colno);});
addEventListener("error",function(e){var t=e&&e.target,s=t&&(t.tagName==="SCRIPT"?t.src:t.tagName==="LINK"&&t.rel==="stylesheet"?t.href:"");if(s)k("failed to load "+s,s,null,null);},true);
addEventListener("unhandledrejection",function(e){var r=e&&e.reason;k(r&&r.message?r.message:r==null?null:String(r));});
function check(){if(D)return;D=true;try{if(!B())return;var d=F||{m:null,f:null,l:null,c:null};
var b=JSON.stringify({t:"f",m:d.m,f:d.f,l:d.l,c:d.c,p:G});
if(navigator.sendBeacon)navigator.sendBeacon(E,b);
else fetch(E,{method:"POST",body:b,keepalive:true,headers:{"content-type":"application/json"}});}catch(_){}}
function arm(){setTimeout(check,${WATCH_SETTLE_MS});}
if(document.readyState==="complete")arm();else addEventListener("load",arm);
setTimeout(check,${WATCH_FALLBACK_MS});
}catch(_){}})();</script>`;

/** Puts the snippet right after the opening <head> tag; with no <head>, before </body>; with
 *  neither, at the end. A document that already carries it comes back unchanged. */
export function injectWatchSnippet(html: string, projectId: string, page: string | null): string {
  if (html.includes(`<script ${MARK}>`)) return html;
  const snippet = SNIPPET_TEMPLATE(projectId, page);
  const head = /<head(?:\s[^>]*)?>/i.exec(html);
  if (head) {
    const at = head.index + head[0].length;
    return html.slice(0, at) + snippet + html.slice(at);
  }
  const body = html.lastIndexOf("</body>");
  if (body !== -1) return html.slice(0, body) + snippet + html.slice(body);
  return html + snippet;
}
