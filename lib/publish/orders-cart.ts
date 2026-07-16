// Publish-time cart runtime for Pedidos por WhatsApp. Mirrors the bookings/
// comments pattern: a self-contained IIFE in a Shadow DOM (total CSS
// isolation) injected before </body>, ONLY into documents that carry the
// data-ol-order-add buttons baked by collections-block. The script tag is
// marked `data-ol-orders-widget` (idempotency + CSP — its hash enters
// script-src at seal time like every publish-time inline runtime).
//
// The checkout IS WhatsApp: state lives in localStorage (origin = the
// published subdomain, so a multi-page site shares one cart), the send
// button composes the wa.me message client-side, and an optional
// fire-and-forget beacon (t:"o") records the conversion in the existing
// analytics collector. No backend, no new endpoints.
//
// XSS-safe: item data renders via textContent/createElement only; the
// embedded config is JSON.stringify'd with </ escaped so it can never
// close the script tag.

import { cidExpr } from "@/lib/analytics/cid";
import { waHref } from "./whatsapp-button";

const MARKER = "data-ol-orders-widget";
const BUTTON_MARKER = "data-ol-order-add";

export interface OrdersCartConfig {
  number: string;
  /** Analytics beacon target (/c/<projectId>). Absent → no beacon. */
  projectId?: string;
  /** Site-page slug of THIS document (null = home) — beacon attribution. */
  page?: string | null;
}

/** JSON.stringify hardened for inline-script embedding. */
function js(v: unknown): string {
  return JSON.stringify(v ?? null).replace(/</g, "\\u003c");
}

/** Inject the cart runtime before </body>. No-op when: the widget is already
 *  present (idempotent), the document has no add-buttons, or the number is
 *  unusable. */
export function injectOrdersCart(html: string, cfg: OrdersCartConfig): string {
  if (!html || html.includes(MARKER)) return html;
  if (!html.includes(BUTTON_MARKER)) return html;
  const wa = waHref(cfg.number);
  if (!wa) return html;

  const script = buildScript(wa, cfg.projectId ?? null, cfg.page ?? null);
  const idx = html.lastIndexOf("</body>");
  return idx === -1 ? html + script : html.slice(0, idx) + script + html.slice(idx);
}

function buildScript(waBase: string, projectId: string | null, page: string | null): string {
  const beacon = projectId
    ? `try{var lbl=items.reduce(function(a,i){return a+i.qty},0)+" items · "+(tc!=null?fmt(tc):"s/total");
var bd=JSON.stringify({t:"o",l:lbl,p:${js(page)},cid:CID});
if(navigator.sendBeacon)navigator.sendBeacon("/c/"+${js(projectId)},bd);
else fetch("/c/"+${js(projectId)},{method:"POST",body:bd,keepalive:true,headers:{"content-type":"application/json"}});}catch(e){}`
    : "";

  return `<script ${MARKER}>(function(){try{
var WA=${js(waBase)},CID=${cidExpr()},K="ol:cart",TTL=86400000;
var LANG=((document.documentElement.getAttribute("lang")||"es").slice(0,2)==="en");
var T=LANG?{items:" items",order:"Order on WhatsApp",title:"Your order",note:"Anything else? e.g. no onions",total:"Total: ",tbd:"Total: to be confirmed",head:"Hi! I'd like to place an order:",noteLbl:"Note: ",close:"Close"}
:{items:" productos",order:"Pedir por WhatsApp",title:"Tu pedido",note:"¿Algo más? ej. sin cebolla",total:"Total: ",tbd:"Total: a confirmar",head:"Hola! Quiero hacer un pedido:",noteLbl:"Nota: ",close:"Cerrar"};
var mem=[];
function load(){try{var r=JSON.parse(localStorage.getItem(K)||"null");if(!r||!r.items||(Date.now()-(r.updatedAt||0))>TTL)return[];return r.items}catch(e){return mem}}
function save(it){mem=it;try{localStorage.setItem(K,JSON.stringify({items:it,updatedAt:Date.now()}))}catch(e){}}
var items=load();
function fmt(c){var s=(c/100).toFixed(2).replace(/\\.00$/,""),p=s.split(".");p[0]=p[0].replace(/\\B(?=(\\d{3})+(?!\\d))/g,",");return "$"+p.join(".")}
function totalCents(){var t=0;for(var i=0;i<items.length;i++){if(items[i].cents==null)return null;t+=items[i].cents*items[i].qty}return t}
var host=document.createElement("div");host.setAttribute("data-ol-orders-host","");document.body.appendChild(host);
var root=host.attachShadow({mode:"open"});
var st=document.createElement("style");st.textContent=".bar{position:fixed;left:50%;transform:translateX(-50%);bottom:16px;z-index:2147482000;display:none;align-items:center;gap:12px;background:#16181d;color:#fff;border-radius:999px;padding:10px 10px 10px 18px;box-shadow:0 8px 30px rgba(0,0,0,.35);font:600 14px/1 system-ui,sans-serif;max-width:92vw}.bar.on{display:flex}.bar button{cursor:pointer;border:0;border-radius:999px;padding:10px 16px;background:#25D366;color:#fff;font:700 13.5px/1 system-ui,sans-serif;white-space:nowrap}.panel{position:fixed;left:50%;transform:translateX(-50%);bottom:76px;z-index:2147482001;display:none;flex-direction:column;gap:10px;width:min(360px,92vw);max-height:60vh;overflow:auto;background:#fff;color:#16181d;border-radius:18px;padding:16px;box-shadow:0 12px 40px rgba(0,0,0,.3);font:400 14px/1.4 system-ui,sans-serif}.panel.on{display:flex}.panel h4{margin:0;font-size:15px;font-weight:800}.row{display:flex;align-items:center;gap:8px}.row .t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.row button{cursor:pointer;border:1.5px solid #e2e2e6;background:#fff;border-radius:50%;width:28px;height:28px;font-weight:700;display:inline-flex;align-items:center;justify-content:center}.row button:hover{border-color:#16181d}.row .q{min-width:16px;text-align:center;font-weight:700}.panel textarea{border:1px solid #e2e2e6;border-radius:14px;padding:10px 12px;font:inherit;resize:vertical;min-height:44px}.panel .tot{font-weight:800}.panel .send{cursor:pointer;border:0;border-radius:999px;padding:13px;background:#25D366;color:#fff;font:700 14px/1 system-ui,sans-serif;box-shadow:0 2px 10px rgba(37,211,102,.35)}";
root.appendChild(st);
var bar=document.createElement("div");bar.className="bar";
var barTxt=document.createElement("span");bar.appendChild(barTxt);
var barBtn=document.createElement("button");barBtn.type="button";barBtn.textContent=T.order;bar.appendChild(barBtn);
var panel=document.createElement("div");panel.className="panel";
root.appendChild(panel);root.appendChild(bar);
var noteVal="";
function message(){var L=[T.head];items.forEach(function(i){var line="\\u2022 "+i.qty+"\\u00d7 "+i.title;if(i.cents!=null)line+=" \\u2014 "+fmt(i.cents*i.qty);else if(i.price)line+=" \\u2014 "+i.price;L.push(line)});var tc=totalCents();L.push(tc!=null?T.total+fmt(tc):T.tbd);if(noteVal)L.push(T.noteLbl+noteVal);return L.join("\\n")}
function render(){var n=items.reduce(function(a,i){return a+i.qty},0);
if(!n){bar.classList.remove("on");panel.classList.remove("on");save(items);return}
var tc=totalCents();barTxt.textContent="\\ud83d\\uded2 "+n+T.items+(tc!=null?" \\u00b7 "+fmt(tc):"");bar.classList.add("on");
panel.textContent="";var h=document.createElement("h4");h.textContent=T.title;panel.appendChild(h);
items.forEach(function(i,idx){var r=document.createElement("div");r.className="row";
var t=document.createElement("span");t.className="t";t.textContent=i.title+(i.cents!=null?" ("+fmt(i.cents)+")":i.price?" ("+i.price+")":"");r.appendChild(t);
var m=document.createElement("button");m.type="button";m.textContent="\\u2212";m.addEventListener("click",function(){i.qty--;if(i.qty<=0)items.splice(idx,1);save(items);render();if(items.length)panel.classList.add("on")});r.appendChild(m);
var q=document.createElement("span");q.className="q";q.textContent=String(i.qty);r.appendChild(q);
var p=document.createElement("button");p.type="button";p.textContent="+";p.addEventListener("click",function(){i.qty++;save(items);render();panel.classList.add("on")});r.appendChild(p);
panel.appendChild(r)});
var ta=document.createElement("textarea");ta.placeholder=T.note;ta.value=noteVal;ta.addEventListener("input",function(){noteVal=ta.value.slice(0,300)});panel.appendChild(ta);
var tot=document.createElement("div");tot.className="tot";tot.textContent=tc!=null?T.total+fmt(tc):T.tbd;panel.appendChild(tot);
var send=document.createElement("button");send.type="button";send.className="send";send.textContent=T.order;send.addEventListener("click",doSend);panel.appendChild(send);
save(items)}
function doSend(){if(!items.length)return;var tc=totalCents();var msg=message();
${beacon}
window.open(WA+"?text="+encodeURIComponent(msg),"_blank","noopener");
items=[];noteVal="";save(items);render()}
barTxt.addEventListener("click",function(){panel.classList.toggle("on")});
barBtn.addEventListener("click",doSend);
document.addEventListener("click",function(e){var b=e.target&&e.target.closest&&e.target.closest("[data-ol-order-add]");if(!b)return;
var c=b.getAttribute("data-ol-order-cents");
var id=b.getAttribute("data-ol-order-id")||"";
var found=null;for(var i=0;i<items.length;i++)if(items[i].id===id)found=items[i];
if(found)found.qty++;
else items.push({id:id,title:b.getAttribute("data-ol-order-title")||"",price:b.getAttribute("data-ol-order-price")||"",cents:(c&&/^\\d+$/.test(c))?parseInt(c,10):null,qty:1});
save(items);render()},true);
render();
}catch(e){}})();</script>`;
}
