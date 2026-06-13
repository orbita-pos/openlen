// Publish-time injection of the members-only comments widget. Mirrors the
// assistant-widget pattern: a self-contained IIFE in a Shadow DOM (total CSS
// isolation), inserted at publish, that can never break the host page.
//
// Placement: if the page carries a `data-ol-comments-section` placeholder
// (dragged in from the Section Library), the widget renders THERE in place;
// otherwise it's appended before </body>. Either way the script tag is marked
// `data-ol-comments-widget` (idempotency + CSP — sealed like every other
// inline runtime; this string MUST stay byte-stable so its hash holds).
//
// The thread is fetched live from /api/cm/<sub>/* (no-store, CF-excluded), so
// a new comment shows on reload without republishing. ol_member is HttpOnly →
// JS can't read it → the widget asks the server (/me) who's logged in.
//
// XSS: every author name + body renders via textContent / createElement —
// never innerHTML. Bodies are stored plain-text server-side.

interface CommentsStrings {
  title: string;
  empty: string;
  placeholder: string;
  post: string;
  posting: string;
  awaiting: string;
  loginCta: string;
  emailPlaceholder: string;
  sendLink: string;
  checkInbox: string;
  error: string;
}

const STRINGS: Record<string, CommentsStrings> = {
  en: { title: "Comments", empty: "No comments yet. Be the first.", placeholder: "Write a comment…", post: "Post", posting: "Posting…", awaiting: "Sent — awaiting approval.", loginCta: "Log in to comment", emailPlaceholder: "you@email.com", sendLink: "Send me a link", checkInbox: "Check your inbox to finish signing in.", error: "Something went wrong. Try again." },
  es: { title: "Comentarios", empty: "Aún no hay comentarios. Sé el primero.", placeholder: "Escribe un comentario…", post: "Publicar", posting: "Publicando…", awaiting: "Enviado — pendiente de aprobación.", loginCta: "Inicia sesión para comentar", emailPlaceholder: "tu@email.com", sendLink: "Enviarme un enlace", checkInbox: "Revisa tu correo para terminar de entrar.", error: "Algo salió mal. Inténtalo de nuevo." },
  pt: { title: "Comentários", empty: "Ainda não há comentários. Seja o primeiro.", placeholder: "Escreva um comentário…", post: "Publicar", posting: "Publicando…", awaiting: "Enviado — aguardando aprovação.", loginCta: "Entre para comentar", emailPlaceholder: "voce@email.com", sendLink: "Enviar um link", checkInbox: "Confira sua caixa de entrada para entrar.", error: "Algo deu errado. Tente de novo." },
  fr: { title: "Commentaires", empty: "Aucun commentaire. Soyez le premier.", placeholder: "Écrire un commentaire…", post: "Publier", posting: "Publication…", awaiting: "Envoyé — en attente de validation.", loginCta: "Connectez-vous pour commenter", emailPlaceholder: "vous@email.com", sendLink: "M'envoyer un lien", checkInbox: "Vérifiez votre boîte mail pour vous connecter.", error: "Une erreur s'est produite. Réessayez." },
  de: { title: "Kommentare", empty: "Noch keine Kommentare. Sei der Erste.", placeholder: "Kommentar schreiben…", post: "Senden", posting: "Senden…", awaiting: "Gesendet — wartet auf Freigabe.", loginCta: "Zum Kommentieren anmelden", emailPlaceholder: "du@email.com", sendLink: "Link senden", checkInbox: "Sieh in dein Postfach, um dich anzumelden.", error: "Etwas ist schiefgelaufen. Versuch es erneut." },
  it: { title: "Commenti", empty: "Ancora nessun commento. Sii il primo.", placeholder: "Scrivi un commento…", post: "Pubblica", posting: "Pubblicazione…", awaiting: "Inviato — in attesa di approvazione.", loginCta: "Accedi per commentare", emailPlaceholder: "tu@email.com", sendLink: "Inviami un link", checkInbox: "Controlla la tua casella per accedere.", error: "Qualcosa è andato storto. Riprova." },
  ja: { title: "コメント", empty: "まだコメントはありません。最初の一人になりましょう。", placeholder: "コメントを書く…", post: "投稿", posting: "投稿中…", awaiting: "送信しました — 承認待ちです。", loginCta: "ログインしてコメント", emailPlaceholder: "you@email.com", sendLink: "リンクを送る", checkInbox: "受信箱を確認してログインを完了してください。", error: "問題が発生しました。もう一度お試しください。" },
  ko: { title: "댓글", empty: "아직 댓글이 없습니다. 첫 댓글을 남겨보세요.", placeholder: "댓글 작성…", post: "게시", posting: "게시 중…", awaiting: "전송됨 — 승인 대기 중입니다.", loginCta: "로그인하고 댓글", emailPlaceholder: "you@email.com", sendLink: "링크 보내기", checkInbox: "받은편지함을 확인해 로그인을 완료하세요.", error: "문제가 발생했습니다. 다시 시도하세요." },
  zh: { title: "评论", empty: "还没有评论，来抢沙发吧。", placeholder: "写下评论…", post: "发布", posting: "发布中…", awaiting: "已发送 — 等待审核。", loginCta: "登录后评论", emailPlaceholder: "you@email.com", sendLink: "给我发链接", checkInbox: "请查收邮箱以完成登录。", error: "出了点问题，请重试。" },
  nl: { title: "Reacties", empty: "Nog geen reacties. Wees de eerste.", placeholder: "Schrijf een reactie…", post: "Plaatsen", posting: "Plaatsen…", awaiting: "Verzonden — wacht op goedkeuring.", loginCta: "Log in om te reageren", emailPlaceholder: "jij@email.com", sendLink: "Stuur mij een link", checkInbox: "Check je inbox om in te loggen.", error: "Er ging iets mis. Probeer opnieuw." },
};

export interface CommentsWidgetConfig {
  sub: string;
  apiBase: string;
  /** Page slug this thread belongs to (null = home). */
  page: string | null;
  locale?: string | null;
}

const WIDGET_MARKER = "data-ol-comments-widget";
const SECTION_MARKER = "data-ol-comments-section";

function widgetScript(cfg: CommentsWidgetConfig): string {
  const t = (cfg.locale && STRINGS[cfg.locale]) || STRINGS.en;
  const C = JSON.stringify({
    sub: cfg.sub,
    api: cfg.apiBase,
    slug: cfg.page,
    t,
  }).replace(/</g, "\\u003c");

  return `<script ${WIDGET_MARKER}>(function(){try{
var C=${C},T=C.t;
var host=document.querySelector("[data-ol-comments-host]");
if(!host||host.shadowRoot)return;
var R=host.attachShadow({mode:"open"});
var q=function(u,o){return fetch(C.api+"/api/cm/"+C.sub+u,o||{})};
R.innerHTML='<style>'
+':host{all:initial;display:block}'
+'*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}'
+'.w{max-width:680px;margin:32px auto;padding:0 16px;color:#1a1a1a}'
+'.h{font-size:18px;font-weight:700;margin:0 0 16px}'
+'.li{padding:12px 0;border-top:1px solid #ececef}'
+'.nm{font-weight:600;font-size:13.5px}'
+'.dt{color:#9a9aa0;font-size:11.5px;margin-left:8px}'
+'.bd{font-size:14px;line-height:1.5;margin-top:4px;white-space:pre-wrap;word-wrap:break-word}'
+'.em{color:#9a9aa0;font-size:13.5px;padding:12px 0}'
+'.cp{margin-top:16px}'
+'.cp textarea{width:100%;min-height:80px;border:1px solid #d8d8dc;border-radius:10px;padding:10px 12px;font-size:14px;resize:vertical}'
+'.cp textarea:focus{outline:2px solid #1a1a1a;border-color:#1a1a1a}'
+'.cp button{margin-top:8px;min-height:40px;padding:0 18px;border:0;border-radius:10px;background:#16181d;color:#fff;font-weight:600;font-size:13.5px;cursor:pointer}'
+'.cp button:disabled{opacity:.5;cursor:default}'
+'.lg button{min-height:40px;padding:0 16px;border:1px solid #d8d8dc;border-radius:10px;background:#fff;font-weight:600;font-size:13.5px;cursor:pointer}'
+'.lg input{width:100%;min-height:40px;border:1px solid #d8d8dc;border-radius:10px;padding:0 12px;font-size:14px;margin-top:8px}'
+'.msg{font-size:12.5px;color:#6b7280;margin-top:8px}'
+'</style><div class="w"><div class="h"></div><div class="ls"></div><div class="ft"></div></div>';
var hEl=R.querySelector(".h"),ls=R.querySelector(".ls"),ft=R.querySelector(".ft");
hEl.textContent=T.title;
function fmt(d){try{return new Date(d).toLocaleDateString()}catch(e){return""}}
function render(list){ls.innerHTML="";if(!list||!list.length){var e=document.createElement("div");e.className="em";e.textContent=T.empty;ls.appendChild(e);return}
list.forEach(function(c){var li=document.createElement("div");li.className="li";
var nm=document.createElement("span");nm.className="nm";nm.textContent=c.authorName||"—";
var dt=document.createElement("span");dt.className="dt";dt.textContent=fmt(c.createdAt);
var hd=document.createElement("div");hd.appendChild(nm);hd.appendChild(dt);
var bd=document.createElement("div");bd.className="bd";bd.textContent=c.body;
li.appendChild(hd);li.appendChild(bd);ls.appendChild(li)})}
function msg(parent,text){var m=document.createElement("div");m.className="msg";m.textContent=text;parent.appendChild(m)}
function composer(){ft.innerHTML="";var box=document.createElement("div");box.className="cp";
var ta=document.createElement("textarea");ta.placeholder=T.placeholder;ta.maxLength=2000;
var btn=document.createElement("button");btn.type="button";btn.textContent=T.post;
box.appendChild(ta);box.appendChild(btn);ft.appendChild(box);
btn.addEventListener("click",function(){var v=ta.value.trim();if(!v)return;btn.disabled=true;btn.textContent=T.posting;
q("/comments",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({slug:C.slug,body:v})})
.then(function(r){return r.ok?r.json():Promise.reject(r.status)})
.then(function(j){ta.value="";btn.disabled=false;btn.textContent=T.post;
if(j.status==="visible"){load()}else{msg(box,T.awaiting)}})
.catch(function(s){btn.disabled=false;btn.textContent=T.post;if(s===401){login()}else{msg(box,T.error)}})})}
function login(){ft.innerHTML="";var box=document.createElement("div");box.className="lg";
var btn=document.createElement("button");btn.type="button";btn.textContent=T.loginCta;box.appendChild(btn);ft.appendChild(box);
btn.addEventListener("click",function(){box.innerHTML="";var inp=document.createElement("input");inp.type="email";inp.placeholder=T.emailPlaceholder;
var sb=document.createElement("button");sb.type="button";sb.textContent=T.sendLink;sb.style.marginTop="8px";
box.appendChild(inp);box.appendChild(sb);inp.focus();
sb.addEventListener("click",function(){var em=inp.value.trim();if(!em)return;sb.disabled=true;
fetch(C.api+"/api/m/"+C.sub+"/auth/request",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:em,slug:C.slug})})
.then(function(){box.innerHTML="";msg(box,T.checkInbox)}).catch(function(){sb.disabled=false;msg(box,T.error)})})})}
function load(){q("/comments?slug="+(C.slug||"")).then(function(r){return r.json()}).then(function(j){render(j.comments)}).catch(function(){})}
load();
q("/me",{credentials:"same-origin"}).then(function(r){return r.json()}).then(function(j){j&&j.member?composer():login()}).catch(login);
}catch(e){}})();</script>`;
}

/** Inject the comments widget. Idempotent (skips if the widget script is
 *  already present). Renders in the data-ol-comments-section placeholder if
 *  the creator placed one, else appends before </body>. */
export function bakeComments(html: string, cfg: CommentsWidgetConfig): string {
  if (html.includes(WIDGET_MARKER)) return html;
  const block = `<div data-ol-comments-host></div>${widgetScript(cfg)}`;

  // Placement: replace the placeholder element's CONTENT in place. Matches a
  // <section|div> carrying the section marker (the Section-Library block).
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
