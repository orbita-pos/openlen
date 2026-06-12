// The members gate stub — the static document published AT a gated page's
// public path. Contains ZERO protected bytes: a neutral, site-branded login
// card plus a small script that (a) tries the protected fetch with the
// member cookie and swaps the document in on 200, or (b) shows the
// magic-link form on 401.
//
// Three deliberate absences, all load-bearing:
//   - NO CSP meta. A document's CSP persists across document.open(), and a
//     meta policy parsed during write() is ADDITIVE — sealing the stub would
//     block every sealed inline script of the swapped-in protected page.
//     The stub has no user content, so going unsealed is safe (same posture
//     as lib/publish/not-found-page.ts).
//   - NO analytics snippet. The protected document carries its own — the
//     gate would double-count every member visit.
//   - NO next-intl. This runs on the publish path; strings are constants
//     for the 10 PUBLISH_LOCALES, picked by the page's own language.
//
// Visual: the not-found-page glass-card family, de-branded — neutral palette
// so it sits in front of any site without clashing; the site's own title +
// optional logo are the branding.

import { PUBLISH_LOCALES } from "@/lib/publish/publish-locales";

export interface GateStubParams {
  /** The site's subdomain — bakes the /api/m/<sub> base into the script. */
  sub: string;
  /** The gated page's slug. */
  slug: string;
  /** Site title shown on the card (user content — escaped). */
  projectTitle: string;
  /** Page language; unknown/absent falls back to "en". */
  locale?: string | null;
  /** Site logo URL (user content — escaped). Absent → a neutral lock mark. */
  logoUrl?: string | null;
}

export interface GateStrings {
  enter: string;
  tag: string;
  checking: string;
  intro: string;
  emailPlaceholder: string;
  sendLink: string;
  checkInbox: string;
  linkInvalid: string;
  tooMany: string;
  error: string;
}

const STRINGS: Record<string, GateStrings> = {
  en: {
    enter: "Continue",
    tag: "Members only",
    checking: "Checking access…",
    intro: "This page is for members. Enter your email and we'll send you a sign-in link.",
    emailPlaceholder: "you@email.com",
    sendLink: "Send me the link",
    checkInbox: "Done — check your inbox. The link works for 15 minutes.",
    linkInvalid: "That link expired or was already used. Request a new one.",
    tooMany: "Too many attempts. Try again in a little while.",
    error: "Something went wrong. Please try again.",
  },
  es: {
    enter: "Entrar",
    tag: "Solo miembros",
    checking: "Verificando acceso…",
    intro: "Esta página es solo para miembros. Escribe tu email y te enviamos un enlace de acceso.",
    emailPlaceholder: "tu@email.com",
    sendLink: "Enviarme el enlace",
    checkInbox: "Listo — revisa tu correo. El enlace dura 15 minutos.",
    linkInvalid: "Ese enlace expiró o ya se usó. Pide uno nuevo.",
    tooMany: "Demasiados intentos. Inténtalo en un rato.",
    error: "Algo salió mal. Inténtalo de nuevo.",
  },
  pt: {
    enter: "Entrar",
    tag: "Apenas membros",
    checking: "Verificando acesso…",
    intro: "Esta página é só para membros. Digite seu e-mail e enviaremos um link de acesso.",
    emailPlaceholder: "voce@email.com",
    sendLink: "Enviar o link",
    checkInbox: "Pronto — confira sua caixa de entrada. O link vale por 15 minutos.",
    linkInvalid: "Esse link expirou ou já foi usado. Peça um novo.",
    tooMany: "Muitas tentativas. Tente novamente em instantes.",
    error: "Algo deu errado. Tente de novo.",
  },
  fr: {
    enter: "Continuer",
    tag: "Réservé aux membres",
    checking: "Vérification de l'accès…",
    intro: "Cette page est réservée aux membres. Saisissez votre e-mail et nous vous enverrons un lien de connexion.",
    emailPlaceholder: "vous@email.com",
    sendLink: "M'envoyer le lien",
    checkInbox: "C'est fait — vérifiez votre boîte mail. Le lien est valable 15 minutes.",
    linkInvalid: "Ce lien a expiré ou a déjà été utilisé. Demandez-en un nouveau.",
    tooMany: "Trop de tentatives. Réessayez dans un instant.",
    error: "Une erreur s'est produite. Réessayez.",
  },
  de: {
    enter: "Weiter",
    tag: "Nur für Mitglieder",
    checking: "Zugriff wird geprüft…",
    intro: "Diese Seite ist nur für Mitglieder. Gib deine E-Mail ein und wir senden dir einen Anmeldelink.",
    emailPlaceholder: "du@email.com",
    sendLink: "Link senden",
    checkInbox: "Fertig — sieh in dein Postfach. Der Link gilt 15 Minuten.",
    linkInvalid: "Dieser Link ist abgelaufen oder wurde schon benutzt. Fordere einen neuen an.",
    tooMany: "Zu viele Versuche. Versuche es gleich noch einmal.",
    error: "Etwas ist schiefgelaufen. Bitte erneut versuchen.",
  },
  it: {
    enter: "Continua",
    tag: "Solo membri",
    checking: "Verifica dell'accesso…",
    intro: "Questa pagina è riservata ai membri. Inserisci la tua email e ti invieremo un link di accesso.",
    emailPlaceholder: "tu@email.com",
    sendLink: "Inviami il link",
    checkInbox: "Fatto — controlla la tua casella. Il link vale per 15 minuti.",
    linkInvalid: "Quel link è scaduto o è già stato usato. Richiedine uno nuovo.",
    tooMany: "Troppi tentativi. Riprova tra poco.",
    error: "Qualcosa è andato storto. Riprova.",
  },
  ja: {
    enter: "続ける",
    tag: "メンバー限定",
    checking: "アクセスを確認中…",
    intro: "このページはメンバー限定です。メールアドレスを入力すると、ログインリンクをお送りします。",
    emailPlaceholder: "you@email.com",
    sendLink: "リンクを送る",
    checkInbox: "送信しました。受信箱をご確認ください。リンクの有効期限は15分です。",
    linkInvalid: "このリンクは期限切れか使用済みです。新しいリンクを請求してください。",
    tooMany: "試行回数が多すぎます。しばらくしてからお試しください。",
    error: "問題が発生しました。もう一度お試しください。",
  },
  ko: {
    enter: "계속",
    tag: "멤버 전용",
    checking: "접근 확인 중…",
    intro: "이 페이지는 멤버 전용입니다. 이메일을 입력하면 로그인 링크를 보내드립니다.",
    emailPlaceholder: "you@email.com",
    sendLink: "링크 보내기",
    checkInbox: "완료 — 받은편지함을 확인하세요. 링크는 15분간 유효합니다.",
    linkInvalid: "링크가 만료되었거나 이미 사용되었습니다. 새 링크를 요청하세요.",
    tooMany: "시도 횟수가 너무 많습니다. 잠시 후 다시 시도하세요.",
    error: "문제가 발생했습니다. 다시 시도해 주세요.",
  },
  zh: {
    enter: "继续",
    tag: "会员专属",
    checking: "正在验证访问权限…",
    intro: "此页面仅限会员访问。输入你的邮箱，我们会发送登录链接。",
    emailPlaceholder: "you@email.com",
    sendLink: "发送链接",
    checkInbox: "已发送 — 请查收邮箱。链接 15 分钟内有效。",
    linkInvalid: "该链接已过期或已被使用。请重新获取。",
    tooMany: "尝试次数过多，请稍后再试。",
    error: "出了点问题，请重试。",
  },
  nl: {
    enter: "Doorgaan",
    tag: "Alleen leden",
    checking: "Toegang controleren…",
    intro: "Deze pagina is alleen voor leden. Vul je e-mail in en we sturen je een inloglink.",
    emailPlaceholder: "jij@email.com",
    sendLink: "Stuur mij de link",
    checkInbox: "Klaar — check je inbox. De link werkt 15 minuten.",
    linkInvalid: "Die link is verlopen of al gebruikt. Vraag een nieuwe aan.",
    tooMany: "Te veel pogingen. Probeer het zo weer.",
    error: "Er ging iets mis. Probeer het opnieuw.",
  },
};

// Compile-time-ish guard: every publish locale has a string table.
for (const l of PUBLISH_LOCALES) {
  if (!STRINGS[l.code]) {
    throw new Error(`gate-stub: missing strings for publish locale "${l.code}"`);
  }
}

/** The gate string table for a locale (en fallback) — shared with the
 *  verify interstitial so its one button speaks the page's language. */
export function gateStringsFor(locale?: string | null): GateStrings {
  return (locale && STRINGS[locale]) || STRINGS.en;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** JSON.stringify hardened for inline <script> embedding. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function buildGateStub(params: GateStubParams): string {
  const locale =
    params.locale && STRINGS[params.locale] ? params.locale : "en";
  const t = STRINGS[locale];
  const title = escapeHtml(params.projectTitle.trim() || params.sub);
  const logo = params.logoUrl?.trim()
    ? `<img class="logo" src="${escapeHtml(params.logoUrl.trim())}" alt="">`
    : `<svg class="logo lock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="9" rx="2.2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`;

  const script = `(function(){
var SUB=${scriptJson(params.sub)},SLUG=${scriptJson(params.slug)},T=${scriptJson({
    linkInvalid: t.linkInvalid,
    tooMany: t.tooMany,
    checkInbox: t.checkInbox,
    error: t.error,
  })};
var API="/api/m/"+SUB;
var loading=document.getElementById("m-loading");
var form=document.getElementById("m-form");
var msg=document.getElementById("m-msg");
var btn=document.getElementById("m-btn");
var hadErr=/[?&]m_err=/.test(location.search);
function showForm(){loading.hidden=true;form.hidden=false;if(hadErr)setMsg(T.linkInvalid);}
function setMsg(text){msg.textContent=text;msg.hidden=false;}
fetch(API+"/page/"+SLUG,{credentials:"same-origin"}).then(function(r){
if(r.status===200){return r.text().then(function(h){document.open();document.write(h);document.close();});}
showForm();
}).catch(showForm);
form.addEventListener("submit",function(e){
e.preventDefault();
btn.disabled=true;
fetch(API+"/auth/request",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:document.getElementById("m-email").value,slug:SLUG})}).then(function(r){
btn.disabled=false;setMsg(r.status===429?T.tooMany:T.checkInbox);
}).catch(function(){btn.disabled=false;setMsg(T.error);});
});
})();`;

  return `<!doctype html>
<html lang="${escapeHtml(locale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="ol-member-gate" content="v1">
<title>${title}</title>
<style>
  :root{
    --bg:#fafafa;--fg:#16181d;--muted:#6b7280;--card:rgba(255,255,255,.72);
    --ring:rgba(22,24,29,.08);--field:rgba(22,24,29,.04);
  }
  @media (prefers-color-scheme:dark){
    :root{--bg:#101216;--fg:#f3f4f6;--muted:#9ca3af;--card:rgba(255,255,255,.05);--ring:rgba(255,255,255,.10);--field:rgba(255,255,255,.06)}
  }
  *{margin:0;box-sizing:border-box}
  html,body{height:100%}
  body{
    font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
    background:var(--bg);color:var(--fg);display:grid;place-items:center;
    padding:24px;-webkit-font-smoothing:antialiased;
  }
  main{
    text-align:center;max-width:420px;width:100%;
    background:var(--card);border:1px solid var(--ring);border-radius:24px;
    padding:clamp(36px,6vw,52px) clamp(24px,5vw,44px);
    backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);
    box-shadow:0 1px 2px rgba(0,0,0,.04),0 24px 80px -32px rgba(0,0,0,.25);
  }
  .logo{width:44px;height:44px;margin:0 auto 18px;display:block;object-fit:contain}
  .logo.lock{opacity:.55;padding:4px}
  .tag{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted);font-weight:600}
  h1{margin-top:8px;font-size:clamp(22px,5vw,28px);letter-spacing:-.02em;line-height:1.15;font-weight:700}
  #m-loading{margin-top:22px;font-size:14px;color:var(--muted)}
  #m-form p.intro{margin-top:14px;font-size:14.5px;line-height:1.55;color:var(--muted)}
  #m-email{
    width:100%;margin-top:20px;padding:13px 16px;font-size:15px;color:var(--fg);
    background:var(--field);border:1px solid var(--ring);border-radius:12px;outline:none;
  }
  #m-email:focus{border-color:var(--fg)}
  #m-btn{
    width:100%;margin-top:10px;padding:13px 16px;font-size:14.5px;font-weight:600;
    color:var(--bg);background:var(--fg);border:0;border-radius:12px;cursor:pointer;
    transition:opacity .15s,transform .15s;
  }
  #m-btn:hover{opacity:.88}
  #m-btn:active{transform:scale(.985)}
  #m-btn:disabled{opacity:.5;cursor:default}
  #m-msg{margin-top:14px;font-size:13.5px;line-height:1.5;color:var(--muted)}
</style>
</head>
<body>
<main>
  ${logo}
  <p class="tag">${escapeHtml(t.tag)}</p>
  <h1>${title}</h1>
  <div id="m-loading">${escapeHtml(t.checking)}</div>
  <form id="m-form" hidden>
    <p class="intro">${escapeHtml(t.intro)}</p>
    <input id="m-email" type="email" required autocomplete="email" placeholder="${escapeHtml(t.emailPlaceholder)}">
    <button id="m-btn" type="submit">${escapeHtml(t.sendLink)}</button>
    <p id="m-msg" hidden></p>
  </form>
  <noscript><p class="intro" style="margin-top:18px">${escapeHtml(t.intro)}</p></noscript>
</main>
<script>${script}</script>
</body>
</html>
`;
}
