// Publish-time injection of the visitor-facing chat widget. Mirrors the
// analytics-snippet pattern: a self-contained IIFE wrapped in try/catch,
// inserted right before </body>, that can never break the host page.
//
// Why Shadow DOM: the widget is injected into arbitrary user pages, so it must
// not inherit or leak styles (the collision rule from the UX research). A shadow
// root gives total CSS isolation — the host page's resets, fonts, and z-index
// wars can't reach inside, and ours can't reach out.
//
// Endpoints (both cross-origin to the main app, CORS-enabled):
//   POST <apiBase>/api/assistant/<sub>  { message, history }  -> { respuesta, intent }
//   POST <apiBase>/api/f/<sub>          FormData lead          (reuses the forms backend)

export interface AssistantWidgetConfig {
  sub: string;
  apiBase: string;
  businessName: string;
  /** Accent color (hex). Default OpenLen coral. */
  accent?: string;
  /** First bot bubble. Default derived from businessName. */
  greeting?: string;
  /** Show the "Powered by OpenLen" footer (free tier). Default true. */
  branding?: boolean;
  /** When true (the human chat module is also enabled on this page), the widget
   *  offers "Hablar con una persona" and, on escalation, hands the visitor +
   *  transcript to the human chat via window.__openlenChat instead of the plain
   *  lead form. Default false → legacy lead-capture behavior. */
  chatHandoff?: boolean;
}

const DEFAULT_ACCENT = "#ff6b5e";

function widgetScript(cfg: Required<AssistantWidgetConfig>): string {
  // Config is JSON-injected; everything else is static runtime JS. Kept terse
  // (single IIFE) so the gzipped payload stays small.
  const C = JSON.stringify({
    sub: cfg.sub,
    api: cfg.apiBase,
    name: cfg.businessName,
    accent: cfg.accent,
    greeting: cfg.greeting,
    branding: cfg.branding,
    handoff: cfg.chatHandoff,
  });

  return `<script>(function(){try{
var C=${C};
var host=document.createElement("div");host.setAttribute("aria-live","polite");
document.body.appendChild(host);
var R=host.attachShadow({mode:"open"});
var ACC=C.accent;
R.innerHTML=
'<style>'
+':host{all:initial}'
+'*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}'
+'.btn{position:fixed;right:18px;bottom:18px;width:56px;height:56px;border-radius:50%;border:0;background:'+ACC+';color:#fff;cursor:pointer;box-shadow:0 6px 22px rgba(0,0,0,.22);z-index:2147483646;display:flex;align-items:center;justify-content:center;padding:0}'
+'.btn svg{width:26px;height:26px}'
+'.btn:focus-visible{outline:3px solid #000;outline-offset:2px}'
+'.panel{position:fixed;right:18px;bottom:84px;width:360px;max-width:calc(100vw - 24px);height:520px;max-height:calc(100vh - 110px);background:#fff;border-radius:16px;box-shadow:0 12px 48px rgba(0,0,0,.28);z-index:2147483647;display:none;flex-direction:column;overflow:hidden}'
+'.panel.open{display:flex}'
+'.hd{background:'+ACC+';color:#fff;padding:14px 16px;font-weight:600;display:flex;justify-content:space-between;align-items:center}'
+'.hd button{background:transparent;border:0;color:#fff;font-size:22px;cursor:pointer;line-height:1;padding:4px;border-radius:6px}'
+'.log{flex:1;overflow-y:auto;padding:14px;background:#f7f7f8}'
+'.row{display:flex;margin:6px 0}'
+'.row.u{justify-content:flex-end}'
+'.bub{max-width:80%;padding:9px 12px;border-radius:14px;font-size:14px;line-height:1.4;white-space:pre-wrap;word-wrap:break-word}'
+'.row.b .bub{background:#fff;color:#1a1a1a;border:1px solid #e8e8ea;border-bottom-left-radius:4px}'
+'.row.u .bub{background:'+ACC+';color:#fff;border-bottom-right-radius:4px}'
+'.dots .bub{color:#888}'
+'.ft{border-top:1px solid #ececef;padding:10px;background:#fff}'
+'.ip{display:flex;gap:8px}'
+'.ip input{flex:1;min-height:44px;border:1px solid #d8d8dc;border-radius:10px;padding:0 12px;font-size:14px}'
+'.ip input:focus{outline:2px solid '+ACC+';border-color:'+ACC+'}'
+'.ip button{min-width:44px;min-height:44px;border:0;border-radius:10px;background:'+ACC+';color:#fff;cursor:pointer;font-weight:600}'
+'.ip button:disabled{opacity:.5;cursor:default}'
+'.lead{padding:10px 0 2px;display:flex;flex-direction:column;gap:8px}'
+'.lead input{min-height:44px;border:1px solid #d8d8dc;border-radius:10px;padding:0 12px;font-size:14px}'
+'.lead button{min-height:44px;border:0;border-radius:10px;background:'+ACC+';color:#fff;font-weight:600;cursor:pointer}'
+'.talk{width:100%;margin-top:8px;min-height:40px;border:1px solid '+ACC+';background:transparent;color:'+ACC+';font-weight:600;font-size:13px;cursor:pointer;border-radius:10px}'
+'.talk:hover{background:'+ACC+';color:#fff}'
+'.dis{font-size:11px;color:#9a9aa0;text-align:center;padding:6px 10px 2px}'
+'.pb{font-size:11px;color:#b3b3b9;text-align:center;padding:2px 0 8px}'
+'.pb a{color:#9a9aa0;text-decoration:none}'
+'@media(max-width:480px){.panel{right:8px;left:8px;width:auto;bottom:78px;height:auto;top:64px;max-height:none}}'
+'</style>'
+'<button class="btn" aria-label="Abrir chat de ayuda" aria-expanded="false">'
+'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.9-.9L3 21l1.9-5.6A8.5 8.5 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z"/></svg>'
+'</button>'
+'<div class="panel" role="dialog" aria-label="Chat de ayuda">'
+'<div class="hd"><span></span><button class="x" aria-label="Cerrar chat">&times;</button></div>'
+'<div class="log" role="log" aria-live="polite"></div>'
+'<div class="ft"><form class="ip"><input type="text" autocomplete="off" placeholder="Escribe tu pregunta…" aria-label="Tu mensaje" maxlength="500"/><button type="submit" aria-label="Enviar">→</button></form>'
+(C.handoff?'<button type="button" class="talk">Hablar con una persona</button>':'')
+'<div class="dis">El asistente puede equivocarse. Verifica datos importantes.</div>'
+(C.branding?'<div class="pb">con <a href="https://openlen.com" target="_blank" rel="noopener">OpenLen</a></div>':'')
+'</div></div>';

var btn=R.querySelector(".btn"),panel=R.querySelector(".panel"),log=R.querySelector(".log"),
form=R.querySelector(".ip"),input=R.querySelector(".ip input"),send=R.querySelector(".ip button"),
xb=R.querySelector(".x"),talk=R.querySelector(".talk");
R.querySelector(".hd span").textContent=C.name;
var history=[],busy=false,opened=false,leadShown=false;

function scroll(){log.scrollTop=log.scrollHeight}
function bubble(role,text){var r=document.createElement("div");r.className="row "+(role==="user"?"u":"b");
var b=document.createElement("div");b.className="bub";b.textContent=text;r.appendChild(b);log.appendChild(r);scroll();return r}
function dots(){var r=document.createElement("div");r.className="row b dots";var b=document.createElement("div");
b.className="bub";b.textContent="…";r.appendChild(b);log.appendChild(r);scroll();return r}

function leadForm(){if(leadShown)return;leadShown=true;
var wrap=document.createElement("form");wrap.className="lead";
wrap.innerHTML='<input name="nombre" placeholder="Tu nombre" aria-label="Tu nombre" autocomplete="name"/>'
+'<input name="email" type="email" required placeholder="Tu correo" aria-label="Tu correo" autocomplete="email"/>'
+'<button type="submit">Enviar mis datos</button>';
wrap.addEventListener("submit",function(e){e.preventDefault();
var fd=new FormData();fd.append("nombre",wrap.nombre.value||"");fd.append("email",wrap.email.value||"");
fd.append("mensaje","[Asistente] "+history.slice(-6).map(function(h){return h.role+": "+h.content}).join(" | ").slice(0,900));
fetch(C.api+"/api/f/"+C.sub,{method:"POST",body:fd,headers:{accept:"application/json"}}).catch(function(){});
wrap.remove();bubble("bot","¡Gracias! Te contactaremos pronto. 🙌");});
log.appendChild(wrap);scroll();wrap.querySelector('input[name=email]').focus()}

// Escalate to a human. With the chat module enabled (C.handoff) this creates a
// real human conversation seeded with the transcript and opens the chat widget;
// otherwise it falls back to the legacy lead-capture form.
function escalate(){if(C.handoff)handoffForm();else leadForm()}
function handoffForm(){if(leadShown)return;leadShown=true;
var wrap=document.createElement("form");wrap.className="lead";
wrap.innerHTML='<input name="nombre" placeholder="Tu nombre" aria-label="Tu nombre" autocomplete="name" required/>'
+'<input name="email" type="email" placeholder="Tu correo (opcional)" aria-label="Tu correo" autocomplete="email"/>'
+'<button type="submit">Conectar con una persona</button>';
var submitting=false;
wrap.addEventListener("submit",function(e){e.preventDefault();if(submitting)return;
var nm=(wrap.nombre.value||"").trim();if(!nm){wrap.nombre.focus();return}
submitting=true;
var tr=history.slice(-12).map(function(h){return (h.role==="user"?"Visitante":"Asistente")+": "+h.content}).join("\\n").slice(0,3500);
var sb=wrap.querySelector("button");sb.disabled=true;
fetch("/api/chat/"+C.sub+"/handoff",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json",accept:"application/json"},body:JSON.stringify({name:nm,email:(wrap.email.value||"").trim()||undefined,transcript:tr})})
.then(function(r){return r.ok?r.json():Promise.reject(r.status)})
.then(function(j){wrap.remove();
if(window.__openlenChat&&window.__openlenChat.openConversation&&j&&j.conversation){close();window.__openlenChat.openConversation(j.conversation.id)}
else{bubble("bot","¡Listo! Un miembro del equipo te escribirá pronto por aquí. 🙌")}})
.catch(function(){submitting=false;sb.disabled=false;leadShown=false;bubble("bot","No pude conectar con una persona ahora. Intenta de nuevo.")});});
log.appendChild(wrap);scroll();wrap.querySelector('input[name=nombre]').focus()}

function ask(text){if(busy)return;busy=true;send.disabled=true;
history.push({role:"user",content:text});bubble("user",text);
var d=dots();
fetch(C.api+"/api/assistant/"+C.sub,{method:"POST",headers:{"content-type":"application/json",accept:"application/json"},
body:JSON.stringify({message:text,history:history.slice(0,-1)})})
.then(function(r){return r.ok?r.json():Promise.reject(r.status)})
.then(function(j){d.remove();var a=(j&&j.respuesta)||"Lo siento, no pude responder ahora.";
history.push({role:"assistant",content:a});bubble("bot",a);
if(j&&(j.intent==="lead"||j.intent==="handoff"))escalate();})
.catch(function(){d.remove();bubble("bot","Hubo un problema. Intenta de nuevo en un momento.")})
.then(function(){busy=false;send.disabled=false;input.focus()})}

function open(){panel.classList.add("open");btn.setAttribute("aria-expanded","true");
if(!opened){opened=true;bubble("bot",C.greeting)}input.focus()}
function close(){panel.classList.remove("open");btn.setAttribute("aria-expanded","false");btn.focus()}
btn.addEventListener("click",function(){panel.classList.contains("open")?close():open()});
xb.addEventListener("click",close);
form.addEventListener("submit",function(e){e.preventDefault();var v=input.value.trim();if(!v)return;input.value="";ask(v)});
if(talk)talk.addEventListener("click",function(){escalate()});
host.addEventListener("keydown",function(e){if(e.key==="Escape"&&panel.classList.contains("open"))close()});
}catch(e){}})();</script>`;
}

const MARKER = "data-openlen-assistant";

/** Inject the widget IIFE before </body>. Idempotent (skips if already
 *  present). Greeting defaults from the business name. */
export function bakeAssistantWidget(
  html: string,
  cfg: AssistantWidgetConfig,
): string {
  if (html.includes(MARKER)) return html;
  const full: Required<AssistantWidgetConfig> = {
    ...cfg,
    accent: cfg.accent || DEFAULT_ACCENT,
    greeting:
      cfg.greeting ||
      `¡Hola! 👋 Soy el asistente de ${cfg.businessName}. ¿En qué te ayudo?`,
    branding: cfg.branding ?? true,
    chatHandoff: cfg.chatHandoff ?? false,
  };
  const tag = widgetScript(full).replace("<script>", `<script ${MARKER}>`);
  const idx = html.lastIndexOf("</body>");
  return idx === -1 ? html + tag : html.slice(0, idx) + tag + html.slice(idx);
}
