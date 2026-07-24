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
//
// UI language: every locale ships in the script and the widget picks one at
// RUNTIME from <html lang> (same posture as chat-widget) — one bake is copied
// verbatim into the translated locale variants, so a build-time pick would
// freeze the root language onto all of them.

interface AssistantStrings {
  open: string;
  dialog: string;
  close: string;
  ask: string;
  yourMessage: string;
  send: string;
  talk: string;
  disclaimer: string;
  poweredBy: string;
  /** {name} = business name. */
  greeting: string;
  yourName: string;
  yourEmail: string;
  yourEmailOpt: string;
  sendData: string;
  thanks: string;
  connect: string;
  handoffOk: string;
  handoffErr: string;
  noAnswer: string;
  error: string;
}

const STRINGS: Record<string, AssistantStrings> = {
  en: { open: "Open help chat", dialog: "Help chat", close: "Close chat", ask: "Type your question…", yourMessage: "Your message", send: "Send", talk: "Talk to a person", disclaimer: "The assistant can make mistakes. Check important details.", poweredBy: "with", greeting: "Hi! 👋 I’m {name}’s assistant. How can I help?", yourName: "Your name", yourEmail: "Your email", yourEmailOpt: "Your email (optional)", sendData: "Send my details", thanks: "Thanks! We’ll be in touch soon. 🙌", connect: "Connect with a person", handoffOk: "Done! Someone from the team will write to you here soon. 🙌", handoffErr: "I couldn’t reach a person right now. Please try again.", noAnswer: "Sorry, I couldn’t answer right now.", error: "Something went wrong. Try again in a moment." },
  es: { open: "Abrir chat de ayuda", dialog: "Chat de ayuda", close: "Cerrar chat", ask: "Escribe tu pregunta…", yourMessage: "Tu mensaje", send: "Enviar", talk: "Hablar con una persona", disclaimer: "El asistente puede equivocarse. Verifica datos importantes.", poweredBy: "con", greeting: "¡Hola! 👋 Soy el asistente de {name}. ¿En qué te ayudo?", yourName: "Tu nombre", yourEmail: "Tu correo", yourEmailOpt: "Tu correo (opcional)", sendData: "Enviar mis datos", thanks: "¡Gracias! Te contactaremos pronto. 🙌", connect: "Conectar con una persona", handoffOk: "¡Listo! Un miembro del equipo te escribirá pronto por aquí. 🙌", handoffErr: "No pude conectar con una persona ahora. Intenta de nuevo.", noAnswer: "Lo siento, no pude responder ahora.", error: "Hubo un problema. Intenta de nuevo en un momento." },
  pt: { open: "Abrir chat de ajuda", dialog: "Chat de ajuda", close: "Fechar chat", ask: "Escreva sua pergunta…", yourMessage: "Sua mensagem", send: "Enviar", talk: "Falar com uma pessoa", disclaimer: "O assistente pode errar. Confira dados importantes.", poweredBy: "com", greeting: "Olá! 👋 Sou o assistente de {name}. Como posso ajudar?", yourName: "Seu nome", yourEmail: "Seu e-mail", yourEmailOpt: "Seu e-mail (opcional)", sendData: "Enviar meus dados", thanks: "Obrigado! Entraremos em contato em breve. 🙌", connect: "Falar com uma pessoa", handoffOk: "Pronto! Alguém da equipe vai te escrever por aqui em breve. 🙌", handoffErr: "Não consegui falar com uma pessoa agora. Tente de novo.", noAnswer: "Desculpe, não consegui responder agora.", error: "Houve um problema. Tente de novo em instantes." },
  fr: { open: "Ouvrir le chat d’aide", dialog: "Chat d’aide", close: "Fermer le chat", ask: "Écrivez votre question…", yourMessage: "Votre message", send: "Envoyer", talk: "Parler à une personne", disclaimer: "L’assistant peut se tromper. Vérifiez les informations importantes.", poweredBy: "avec", greeting: "Bonjour ! 👋 Je suis l’assistant de {name}. Comment puis-je vous aider ?", yourName: "Votre nom", yourEmail: "Votre e-mail", yourEmailOpt: "Votre e-mail (facultatif)", sendData: "Envoyer mes coordonnées", thanks: "Merci ! Nous vous recontacterons bientôt. 🙌", connect: "Être mis en relation", handoffOk: "C’est fait ! Un membre de l’équipe vous écrira ici très vite. 🙌", handoffErr: "Je n’ai pas pu joindre une personne. Réessayez.", noAnswer: "Désolé, je n’ai pas pu répondre.", error: "Un problème est survenu. Réessayez dans un instant." },
  de: { open: "Hilfe-Chat öffnen", dialog: "Hilfe-Chat", close: "Chat schließen", ask: "Schreib deine Frage…", yourMessage: "Deine Nachricht", send: "Senden", talk: "Mit einer Person sprechen", disclaimer: "Der Assistent kann sich irren. Wichtige Angaben bitte prüfen.", poweredBy: "mit", greeting: "Hallo! 👋 Ich bin der Assistent von {name}. Wie kann ich helfen?", yourName: "Dein Name", yourEmail: "Deine E-Mail", yourEmailOpt: "Deine E-Mail (optional)", sendData: "Daten senden", thanks: "Danke! Wir melden uns bald. 🙌", connect: "Mit einer Person verbinden", handoffOk: "Fertig! Jemand aus dem Team schreibt dir hier bald. 🙌", handoffErr: "Ich konnte gerade niemanden erreichen. Versuch es noch einmal.", noAnswer: "Entschuldigung, ich konnte gerade nicht antworten.", error: "Etwas ist schiefgelaufen. Versuch es gleich noch einmal." },
  it: { open: "Apri la chat di aiuto", dialog: "Chat di aiuto", close: "Chiudi la chat", ask: "Scrivi la tua domanda…", yourMessage: "Il tuo messaggio", send: "Invia", talk: "Parla con una persona", disclaimer: "L’assistente può sbagliare. Verifica i dati importanti.", poweredBy: "con", greeting: "Ciao! 👋 Sono l’assistente di {name}. Come posso aiutarti?", yourName: "Il tuo nome", yourEmail: "La tua email", yourEmailOpt: "La tua email (facoltativa)", sendData: "Invia i miei dati", thanks: "Grazie! Ti contatteremo presto. 🙌", connect: "Contatta una persona", handoffOk: "Fatto! Qualcuno del team ti scriverà qui a breve. 🙌", handoffErr: "Non sono riuscito a contattare una persona ora. Riprova.", noAnswer: "Mi dispiace, non sono riuscito a rispondere.", error: "Si è verificato un problema. Riprova tra un momento." },
  ja: { open: "ヘルプチャットを開く", dialog: "ヘルプチャット", close: "チャットを閉じる", ask: "質問を入力…", yourMessage: "メッセージ", send: "送信", talk: "担当者と話す", disclaimer: "アシスタントは間違えることがあります。重要な情報はご確認ください。", poweredBy: "提供:", greeting: "こんにちは！👋 {name} のアシスタントです。ご用件をどうぞ。", yourName: "お名前", yourEmail: "メールアドレス", yourEmailOpt: "メールアドレス（任意）", sendData: "送信する", thanks: "ありがとうございます！近日中にご連絡します。🙌", connect: "担当者につなぐ", handoffOk: "完了しました！担当者がこちらにご連絡します。🙌", handoffErr: "今は担当者につなげませんでした。もう一度お試しください。", noAnswer: "申し訳ありません、今はお答えできませんでした。", error: "問題が発生しました。しばらくしてからお試しください。" },
  ko: { open: "도움말 채팅 열기", dialog: "도움말 채팅", close: "채팅 닫기", ask: "질문을 입력하세요…", yourMessage: "메시지", send: "보내기", talk: "상담원과 대화", disclaimer: "어시스턴트가 틀릴 수 있습니다. 중요한 정보는 확인해 주세요.", poweredBy: "제공:", greeting: "안녕하세요! 👋 {name}의 어시스턴트입니다. 무엇을 도와드릴까요?", yourName: "이름", yourEmail: "이메일", yourEmailOpt: "이메일 (선택)", sendData: "내 정보 보내기", thanks: "감사합니다! 곧 연락드리겠습니다. 🙌", connect: "상담원 연결", handoffOk: "완료되었습니다! 팀원이 곧 여기로 메시지를 보낼 거예요. 🙌", handoffErr: "지금은 상담원과 연결할 수 없습니다. 다시 시도해 주세요.", noAnswer: "죄송합니다. 지금은 답변할 수 없습니다.", error: "문제가 발생했습니다. 잠시 후 다시 시도해 주세요." },
  zh: { open: "打开帮助聊天", dialog: "帮助聊天", close: "关闭聊天", ask: "输入你的问题…", yourMessage: "你的消息", send: "发送", talk: "与真人沟通", disclaimer: "助手可能会出错，重要信息请核实。", poweredBy: "由", greeting: "你好！👋 我是 {name} 的助手，有什么可以帮你？", yourName: "你的姓名", yourEmail: "你的邮箱", yourEmailOpt: "你的邮箱（可选）", sendData: "发送我的信息", thanks: "谢谢！我们会尽快与你联系。🙌", connect: "转接真人", handoffOk: "好了！团队成员会很快在这里给你留言。🙌", handoffErr: "现在无法转接真人，请再试一次。", noAnswer: "抱歉，我现在无法回答。", error: "出了点问题，请稍后再试。" },
  nl: { open: "Helpchat openen", dialog: "Helpchat", close: "Chat sluiten", ask: "Stel je vraag…", yourMessage: "Je bericht", send: "Versturen", talk: "Met een persoon praten", disclaimer: "De assistent kan fouten maken. Controleer belangrijke gegevens.", poweredBy: "met", greeting: "Hoi! 👋 Ik ben de assistent van {name}. Waarmee kan ik helpen?", yourName: "Je naam", yourEmail: "Je e-mail", yourEmailOpt: "Je e-mail (optioneel)", sendData: "Mijn gegevens versturen", thanks: "Bedankt! We nemen snel contact op. 🙌", connect: "Verbinden met een persoon", handoffOk: "Klaar! Iemand van het team schrijft je hier binnenkort. 🙌", handoffErr: "Ik kon nu niemand bereiken. Probeer het opnieuw.", noAnswer: "Sorry, ik kon nu geen antwoord geven.", error: "Er ging iets mis. Probeer het zo opnieuw." },
};

export interface AssistantWidgetConfig {
  sub: string;
  apiBase: string;
  businessName: string;
  /** Accent color (hex). Default OpenLen coral. */
  accent?: string;
  /** First bot bubble. Default derived from businessName, in the page language. */
  greeting?: string;
  /** Show the "Powered by OpenLen" footer (free tier). Default true. */
  branding?: boolean;
  /** When true (the human chat module is also enabled on this page), the widget
   *  offers "Hablar con una persona" and, on escalation, hands the visitor +
   *  transcript to the human chat via window.__openlenChat instead of the plain
   *  lead form. Default false → legacy lead-capture behavior. */
  chatHandoff?: boolean;
}

// Coral OpenLen — mismo default e higiene que chat-widget (guard hex antes de
// interpolar al CSS; review e56321c).
const DEFAULT_ACCENT = "#FF5A36";

function widgetScript(cfg: AssistantWidgetConfig): string {
  // Config is JSON-injected; everything else is static runtime JS. Kept terse
  // (single IIFE) so the gzipped payload stays small. Escaping "<" keeps
  // anything inside the JSON (a business name, a locale string) from closing
  // the <script> element.
  const C = JSON.stringify({
    sub: cfg.sub,
    api: cfg.apiBase,
    name: cfg.businessName,
    accent: /^#[0-9a-fA-F]{3,8}$/.test(cfg.accent ?? "") ? cfg.accent : DEFAULT_ACCENT,
    greeting: cfg.greeting || null,
    branding: cfg.branding ?? true,
    handoff: cfg.chatHandoff ?? false,
    S: STRINGS,
  }).replace(/</g, "\\u003c");

  return `<script>(function(){try{
var C=${C};
var T=C.S[(document.documentElement.lang||"en").slice(0,2).toLowerCase()]||C.S.en;
var GREET=C.greeting||T.greeting.split("{name}").join(C.name||"");
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
+'.panel{position:fixed;right:18px;bottom:84px;width:360px;max-width:calc(100vw - 24px);height:520px;max-height:calc(100vh - 110px);background:#fff;border-radius:18px;box-shadow:0 16px 56px rgba(0,0,0,.24);z-index:2147483647;display:none;flex-direction:column;overflow:hidden}'
+'.panel.open{display:flex}'
+'.hd{background:'+ACC+';background:color-mix(in srgb,'+ACC+' 76%,#170a05);color:#fff;padding:10px 14px;font-weight:600;display:flex;align-items:center;gap:11px}'
+'.hd .ava{width:38px;height:38px;border-radius:50%;background:rgba(255,255,255,.22);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:16px;flex:none}'
+'.hd span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:15px}'
+'.hd button{background:transparent;border:0;color:#fff;font-size:22px;cursor:pointer;line-height:1;padding:4px;border-radius:6px;opacity:.9}'
+'.log{flex:1;overflow-y:auto;padding:12px 14px;background:#f4ede8;background:radial-gradient(circle at 20% 30%,color-mix(in srgb,'+ACC+' 6%,transparent) 0 14px,transparent 15px),radial-gradient(circle at 70% 60%,color-mix(in srgb,'+ACC+' 6%,transparent) 0 10px,transparent 11px),#f4ede8}'
+'.row{display:flex;margin:5px 0}'
+'.row.u{justify-content:flex-end}'
+'.bub{max-width:80%;padding:8px 11px;border-radius:10px;font-size:14px;line-height:1.4;white-space:pre-wrap;word-wrap:break-word;box-shadow:0 1px 1px rgba(0,0,0,.08)}'
+'.row.b .bub{background:#fff;color:#1a1a1a;border-top-left-radius:2px}'
+'.row.u .bub{background:#ffe9e2;background:color-mix(in srgb,'+ACC+' 14%,#fff);color:#221b17;border-top-right-radius:2px}'
+'.dots .bub{color:#888}'
+'.ft{padding:8px 10px;background:#f4ede8}'
+'.ip{display:flex;gap:8px;align-items:center}'
+'.ip input{flex:1;min-height:44px;border:0;border-radius:999px;padding:0 18px;font-size:14px;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.08)}'
+'.ip input:focus{outline:2px solid '+ACC+'}'
+'.ip button{width:44px;min-width:44px;height:44px;border:0;border-radius:50%;background:'+ACC+';color:#fff;cursor:pointer;font-weight:600;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.2)}'
+'.ip button:disabled{opacity:.5;cursor:default}'
+'.lead{padding:10px 0 2px;display:flex;flex-direction:column;gap:8px}'
+'.lead input{min-height:44px;border:1px solid #e2e6e4;border-radius:999px;padding:0 16px;font-size:14px;background:#fff}'
+'.lead input:focus{outline:2px solid '+ACC+'}'
+'.lead button{min-height:46px;border:0;border-radius:999px;background:'+ACC+';color:#fff;font-weight:700;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.16)}'
+'.talk{width:100%;margin-top:8px;min-height:42px;border:1.5px solid '+ACC+';background:transparent;color:'+ACC+';font-weight:700;font-size:13px;cursor:pointer;border-radius:999px}'
+'.talk:hover{background:'+ACC+';color:#fff}'
+'.dis{font-size:11px;color:#9a9aa0;text-align:center;padding:6px 10px 2px}'
+'.pb{font-size:11px;color:#b3b3b9;text-align:center;padding:2px 0 8px}'
+'.pb a{color:#9a9aa0;text-decoration:none}'
+'@media(max-width:480px){.panel{right:8px;left:8px;width:auto;bottom:78px;height:auto;top:64px;max-height:none}}'
+'</style>'
+'<button class="btn" aria-expanded="false">'
+'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.9-.9L3 21l1.9-5.6A8.5 8.5 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z"/></svg>'
+'</button>'
+'<div class="panel" role="dialog">'
+'<div class="hd"><div class="ava"></div><span></span><button class="x">&times;</button></div>'
+'<div class="log" role="log" aria-live="polite"></div>'
+'<div class="ft"><form class="ip"><input type="text" autocomplete="off" maxlength="500"/><button type="submit">→</button></form>'
+(C.handoff?'<button type="button" class="talk"></button>':'')
+'<div class="dis"></div>'
+(C.branding?'<div class="pb"><span></span> <a href="https://openlen.com" target="_blank" rel="noopener">OpenLen</a></div>':'')
+'</div></div>';

var btn=R.querySelector(".btn"),panel=R.querySelector(".panel"),log=R.querySelector(".log"),
form=R.querySelector(".ip"),input=R.querySelector(".ip input"),send=R.querySelector(".ip button"),
xb=R.querySelector(".x"),talk=R.querySelector(".talk");
// Locale text is assigned, never interpolated into the markup string — no
// escaping to get wrong.
function field(e,t){e.placeholder=t;e.setAttribute("aria-label",t)}
btn.setAttribute("aria-label",T.open);
panel.setAttribute("aria-label",T.dialog);
xb.setAttribute("aria-label",T.close);
input.placeholder=T.ask;input.setAttribute("aria-label",T.yourMessage);
send.setAttribute("aria-label",T.send);
R.querySelector(".dis").textContent=T.disclaimer;
if(talk)talk.textContent=T.talk;
var pbs=R.querySelector(".pb span");if(pbs)pbs.textContent=T.poweredBy;
R.querySelector(".hd span").textContent=C.name;
R.querySelector(".hd .ava").textContent=(C.name||"A").charAt(0).toUpperCase();
var history=[],busy=false,opened=false,leadShown=false;

function scroll(){log.scrollTop=log.scrollHeight}
function bubble(role,text){var r=document.createElement("div");r.className="row "+(role==="user"?"u":"b");
var b=document.createElement("div");b.className="bub";b.textContent=text;r.appendChild(b);log.appendChild(r);scroll();return r}
function dots(){var r=document.createElement("div");r.className="row b dots";var b=document.createElement("div");
b.className="bub";b.textContent="…";r.appendChild(b);log.appendChild(r);scroll();return r}

function leadForm(){if(leadShown)return;leadShown=true;
var wrap=document.createElement("form");wrap.className="lead";
wrap.innerHTML='<input name="nombre" autocomplete="name"/>'
+'<input name="email" type="email" required autocomplete="email"/>'
+'<button type="submit"></button>';
field(wrap.nombre,T.yourName);field(wrap.email,T.yourEmail);
wrap.querySelector("button").textContent=T.sendData;
wrap.addEventListener("submit",function(e){e.preventDefault();
var fd=new FormData();fd.append("nombre",wrap.nombre.value||"");fd.append("email",wrap.email.value||"");
fd.append("mensaje","[Asistente] "+history.slice(-6).map(function(h){return h.role+": "+h.content}).join(" | ").slice(0,900));
fetch(C.api+"/api/f/"+C.sub,{method:"POST",body:fd,headers:{accept:"application/json"}}).catch(function(){});
wrap.remove();bubble("bot",T.thanks);});
log.appendChild(wrap);scroll();wrap.querySelector('input[name=email]').focus()}

// Escalate to a human. With the chat module enabled (C.handoff) this creates a
// real human conversation seeded with the transcript and opens the chat widget;
// otherwise it falls back to the legacy lead-capture form.
function escalate(){if(C.handoff)handoffForm();else leadForm()}
function handoffForm(){if(leadShown)return;leadShown=true;
var wrap=document.createElement("form");wrap.className="lead";
wrap.innerHTML='<input name="nombre" autocomplete="name" required/>'
+'<input name="email" type="email" autocomplete="email"/>'
+'<button type="submit"></button>';
field(wrap.nombre,T.yourName);field(wrap.email,T.yourEmailOpt);
wrap.querySelector("button").textContent=T.connect;
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
else{bubble("bot",T.handoffOk)}})
.catch(function(){submitting=false;sb.disabled=false;leadShown=false;bubble("bot",T.handoffErr)});});
log.appendChild(wrap);scroll();wrap.querySelector('input[name=nombre]').focus()}

function ask(text){if(busy)return;busy=true;send.disabled=true;
history.push({role:"user",content:text});bubble("user",text);
var d=dots();
fetch(C.api+"/api/assistant/"+C.sub,{method:"POST",headers:{"content-type":"application/json",accept:"application/json"},
body:JSON.stringify({message:text,history:history.slice(0,-1)})})
.then(function(r){return r.ok?r.json():Promise.reject(r.status)})
.then(function(j){d.remove();var a=(j&&j.respuesta)||T.noAnswer;
history.push({role:"assistant",content:a});bubble("bot",a);
if(j&&(j.intent==="lead"||j.intent==="handoff"))escalate();})
.catch(function(){d.remove();bubble("bot",T.error)})
.then(function(){busy=false;send.disabled=false;input.focus()})}

function open(){panel.classList.add("open");btn.setAttribute("aria-expanded","true");
if(!opened){opened=true;bubble("bot",GREET)}input.focus()}
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
 *  present). With no configured greeting the widget builds one from the business
 *  name at runtime, in the page language. */
export function bakeAssistantWidget(
  html: string,
  cfg: AssistantWidgetConfig,
): string {
  if (html.includes(MARKER)) return html;
  const tag = widgetScript(cfg).replace("<script>", `<script ${MARKER}>`);
  const idx = html.lastIndexOf("</body>");
  return idx === -1 ? html + tag : html.slice(0, idx) + tag + html.slice(idx);
}
