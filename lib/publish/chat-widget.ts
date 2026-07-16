// Publish-time injection of the visitor-facing PRIVATE CHAT widget. Mirrors the
// comments-widget pattern: a self-contained IIFE in a Shadow DOM (total CSS
// isolation), wrapped in try/catch, inserted at publish — it can never break
// the host page.
//
// TRANSPORT (load-bearing): auth is a host-only `ol_chat` cookie set on the
// PUBLISHED page's own host. So every fetch MUST be RELATIVE (/api/chat/<sub>/…)
// with credentials:"same-origin" — a cross-origin call to the apex would drop
// the cookie, so /me would always say logged-out and every POST would 401.
// (This is the COMMENTS-widget posture, NOT the assistant's cross-origin one.)
//
// Placement: if the page carries a `data-ol-chat-section` placeholder, the panel
// renders THERE in place (mount "section"/"both"); the floating FAB is appended
// before </body> (mount "fab"/"both"). The script tag is marked
// `data-ol-chat-widget` (idempotency + CSP seal — keep this byte-stable).
//
// Auth is @username + password (Login / Register) — NOT email magic-link.
// Register is only offered when the space is self-serve (selfServeJoin); else an
// "invite only" note. XSS: every username + message body renders via textContent
// / createElement — never innerHTML on user data.

interface ChatStrings {
  title: string;
  login: string;
  register: string;
  username: string;
  password: string;
  displayName: string;
  loginBtn: string;
  registerBtn: string;
  inviteOnly: string;
  errBadUser: string;
  errBadPass: string;
  errTaken: string;
  errInvalid: string;
  errRate: string;
  search: string;
  noConvos: string;
  noUsers: string;
  compose: string;
  send: string;
  back: string;
  logout: string;
  open: string;
  close: string;
  error: string;
  messageBusiness: string;
  online: string;
  typing: string;
  seen: string;
  guestName: string;
  guestEmail: string;
  guestStart: string;
  guestNameRequired: string;
}

const STRINGS: Record<string, ChatStrings> = {
  en: { title: "Messages", login: "Log in", register: "Sign up", username: "Username", password: "Password", displayName: "Display name (optional)", loginBtn: "Log in", registerBtn: "Create account", inviteOnly: "This space is invite-only.", errBadUser: "Invalid username.", errBadPass: "Password is too short.", errTaken: "That username is taken.", errInvalid: "Wrong username or password.", errRate: "Too many attempts. Wait a moment.", search: "Search @username", noConvos: "No conversations yet.", noUsers: "No users found.", compose: "Write a message…", send: "Send", back: "Back", logout: "Log out", open: "Open chat", close: "Close", error: "Something went wrong.", messageBusiness: "Message the business", online: "Online", typing: "typing…", seen: "Seen", guestName: "Your name", guestEmail: "Email (optional)", guestStart: "Start chat", guestNameRequired: "Please enter your name" },
  es: { title: "Mensajes", login: "Entrar", register: "Crear cuenta", username: "Usuario", password: "Contraseña", displayName: "Nombre visible (opcional)", loginBtn: "Entrar", registerBtn: "Crear cuenta", inviteOnly: "Este espacio es solo por invitación.", errBadUser: "Usuario no válido.", errBadPass: "La contraseña es muy corta.", errTaken: "Ese usuario ya existe.", errInvalid: "Usuario o contraseña incorrectos.", errRate: "Demasiados intentos. Espera un momento.", search: "Buscar @usuario", noConvos: "Aún no hay conversaciones.", noUsers: "No se encontraron usuarios.", compose: "Escribe un mensaje…", send: "Enviar", back: "Atrás", logout: "Salir", open: "Abrir chat", close: "Cerrar", error: "Algo salió mal.", messageBusiness: "Escribir al negocio", online: "En línea", typing: "escribiendo…", seen: "Visto", guestName: "Tu nombre", guestEmail: "Email (opcional)", guestStart: "Empezar chat", guestNameRequired: "Escribe tu nombre" },
  pt: { title: "Mensagens", login: "Entrar", register: "Criar conta", username: "Usuário", password: "Senha", displayName: "Nome de exibição (opcional)", loginBtn: "Entrar", registerBtn: "Criar conta", inviteOnly: "Este espaço é apenas por convite.", errBadUser: "Usuário inválido.", errBadPass: "A senha é muito curta.", errTaken: "Esse usuário já existe.", errInvalid: "Usuário ou senha incorretos.", errRate: "Muitas tentativas. Aguarde um momento.", search: "Buscar @usuário", noConvos: "Ainda não há conversas.", noUsers: "Nenhum usuário encontrado.", compose: "Escreva uma mensagem…", send: "Enviar", back: "Voltar", logout: "Sair", open: "Abrir chat", close: "Fechar", error: "Algo deu errado.", messageBusiness: "Mensagem para o negócio", online: "Online", typing: "digitando…", seen: "Seen", guestName: "Seu nome", guestEmail: "Email (opcional)", guestStart: "Iniciar chat", guestNameRequired: "Digite seu nome" },
  fr: { title: "Messages", login: "Connexion", register: "Créer un compte", username: "Nom d'utilisateur", password: "Mot de passe", displayName: "Nom affiché (facultatif)", loginBtn: "Se connecter", registerBtn: "Créer un compte", inviteOnly: "Cet espace est sur invitation uniquement.", errBadUser: "Nom d'utilisateur invalide.", errBadPass: "Le mot de passe est trop court.", errTaken: "Ce nom est déjà pris.", errInvalid: "Nom d'utilisateur ou mot de passe incorrect.", errRate: "Trop de tentatives. Patientez un instant.", search: "Chercher @utilisateur", noConvos: "Aucune conversation pour l'instant.", noUsers: "Aucun utilisateur trouvé.", compose: "Écrire un message…", send: "Envoyer", back: "Retour", logout: "Déconnexion", open: "Ouvrir le chat", close: "Fermer", error: "Une erreur s'est produite.", messageBusiness: "Contacter l'entreprise", online: "En ligne", typing: "en train d'écrire…", seen: "Seen", guestName: "Votre nom", guestEmail: "E-mail (facultatif)", guestStart: "Démarrer le chat", guestNameRequired: "Veuillez saisir votre nom" },
  de: { title: "Nachrichten", login: "Anmelden", register: "Registrieren", username: "Benutzername", password: "Passwort", displayName: "Anzeigename (optional)", loginBtn: "Anmelden", registerBtn: "Konto erstellen", inviteOnly: "Dieser Bereich ist nur auf Einladung.", errBadUser: "Ungültiger Benutzername.", errBadPass: "Das Passwort ist zu kurz.", errTaken: "Dieser Benutzername ist vergeben.", errInvalid: "Benutzername oder Passwort falsch.", errRate: "Zu viele Versuche. Bitte warte einen Moment.", search: "@Benutzer suchen", noConvos: "Noch keine Unterhaltungen.", noUsers: "Keine Benutzer gefunden.", compose: "Nachricht schreiben…", send: "Senden", back: "Zurück", logout: "Abmelden", open: "Chat öffnen", close: "Schließen", error: "Etwas ist schiefgelaufen.", messageBusiness: "Das Unternehmen anschreiben", online: "Online", typing: "schreibt…", seen: "Seen", guestName: "Dein Name", guestEmail: "E-Mail (optional)", guestStart: "Chat starten", guestNameRequired: "Bitte gib deinen Namen ein" },
  it: { title: "Messaggi", login: "Accedi", register: "Registrati", username: "Nome utente", password: "Password", displayName: "Nome visualizzato (facoltativo)", loginBtn: "Accedi", registerBtn: "Crea account", inviteOnly: "Questo spazio è solo su invito.", errBadUser: "Nome utente non valido.", errBadPass: "La password è troppo corta.", errTaken: "Questo nome utente è già in uso.", errInvalid: "Nome utente o password errati.", errRate: "Troppi tentativi. Attendi un momento.", search: "Cerca @utente", noConvos: "Ancora nessuna conversazione.", noUsers: "Nessun utente trovato.", compose: "Scrivi un messaggio…", send: "Invia", back: "Indietro", logout: "Esci", open: "Apri chat", close: "Chiudi", error: "Qualcosa è andato storto.", messageBusiness: "Scrivi all'azienda", online: "Online", typing: "sta scrivendo…", seen: "Seen", guestName: "Il tuo nome", guestEmail: "Email (facoltativa)", guestStart: "Inizia chat", guestNameRequired: "Inserisci il tuo nome" },
  ja: { title: "メッセージ", login: "ログイン", register: "登録", username: "ユーザー名", password: "パスワード", displayName: "表示名（任意）", loginBtn: "ログイン", registerBtn: "アカウント作成", inviteOnly: "このスペースは招待制です。", errBadUser: "ユーザー名が無効です。", errBadPass: "パスワードが短すぎます。", errTaken: "そのユーザー名は使用されています。", errInvalid: "ユーザー名またはパスワードが違います。", errRate: "試行回数が多すぎます。少し待ってください。", search: "@ユーザー名で検索", noConvos: "まだ会話はありません。", noUsers: "ユーザーが見つかりません。", compose: "メッセージを入力…", send: "送信", back: "戻る", logout: "ログアウト", open: "チャットを開く", close: "閉じる", error: "問題が発生しました。", messageBusiness: "ビジネスに連絡", online: "オンライン", typing: "入力中…", seen: "Seen", guestName: "お名前", guestEmail: "メール（任意）", guestStart: "チャットを開始", guestNameRequired: "お名前を入力してください" },
  ko: { title: "메시지", login: "로그인", register: "가입", username: "사용자 이름", password: "비밀번호", displayName: "표시 이름 (선택)", loginBtn: "로그인", registerBtn: "계정 만들기", inviteOnly: "이 공간은 초대 전용입니다.", errBadUser: "잘못된 사용자 이름입니다.", errBadPass: "비밀번호가 너무 짧습니다.", errTaken: "이미 사용 중인 사용자 이름입니다.", errInvalid: "사용자 이름 또는 비밀번호가 틀렸습니다.", errRate: "시도가 너무 많습니다. 잠시 기다려 주세요.", search: "@사용자 검색", noConvos: "아직 대화가 없습니다.", noUsers: "사용자를 찾을 수 없습니다.", compose: "메시지 입력…", send: "보내기", back: "뒤로", logout: "로그아웃", open: "채팅 열기", close: "닫기", error: "문제가 발생했습니다.", messageBusiness: "비즈니스에 메시지", online: "온라인", typing: "입력 중…", seen: "Seen", guestName: "이름", guestEmail: "이메일 (선택)", guestStart: "채팅 시작", guestNameRequired: "이름을 입력해 주세요" },
  zh: { title: "消息", login: "登录", register: "注册", username: "用户名", password: "密码", displayName: "显示名称（可选）", loginBtn: "登录", registerBtn: "创建账户", inviteOnly: "此空间仅限邀请。", errBadUser: "用户名无效。", errBadPass: "密码太短。", errTaken: "该用户名已被占用。", errInvalid: "用户名或密码错误。", errRate: "尝试次数过多，请稍候。", search: "搜索 @用户名", noConvos: "还没有会话。", noUsers: "未找到用户。", compose: "写条消息…", send: "发送", back: "返回", logout: "退出", open: "打开聊天", close: "关闭", error: "出了点问题。", messageBusiness: "联系商家", online: "在线", typing: "正在输入…", seen: "Seen", guestName: "您的姓名", guestEmail: "邮箱（可选）", guestStart: "开始聊天", guestNameRequired: "请输入您的姓名" },
  nl: { title: "Berichten", login: "Inloggen", register: "Registreren", username: "Gebruikersnaam", password: "Wachtwoord", displayName: "Weergavenaam (optioneel)", loginBtn: "Inloggen", registerBtn: "Account aanmaken", inviteOnly: "Deze ruimte is alleen op uitnodiging.", errBadUser: "Ongeldige gebruikersnaam.", errBadPass: "Het wachtwoord is te kort.", errTaken: "Die gebruikersnaam is al in gebruik.", errInvalid: "Gebruikersnaam of wachtwoord onjuist.", errRate: "Te veel pogingen. Wacht even.", search: "Zoek @gebruiker", noConvos: "Nog geen gesprekken.", noUsers: "Geen gebruikers gevonden.", compose: "Schrijf een bericht…", send: "Versturen", back: "Terug", logout: "Uitloggen", open: "Chat openen", close: "Sluiten", error: "Er ging iets mis.", messageBusiness: "Bericht naar het bedrijf", online: "Online", typing: "aan het typen…", seen: "Seen", guestName: "Je naam", guestEmail: "E-mail (optioneel)", guestStart: "Chat starten", guestNameRequired: "Voer je naam in" },
};

export interface ChatWidgetConfig {
  sub: string;
  /** Accent color (hex). Default OpenLen coral. */
  accent?: string;
  /** Where to render: a floating FAB, an in-page section host, or both. */
  mount: "fab" | "section" | "both";
  /** When true the auth view offers self-registration; else "invite only". */
  selfServeJoin: boolean;
  /** Show the "with OpenLen" footer (free tier). Default true. */
  branding?: boolean;
  /** Lift the FAB/panel this many px from the bottom (corner-stacking with the
   *  assistant/whatsapp FABs — set by the publish caller). Default 18. */
  bottomPx?: number;
  /** Business display name — shown as the thread title in messageOwner(). */
  title?: string;
  /** How non-members identify. "guest" (default) = name + optional email.
   *  "account" = @username + password. */
  identityMode?: "guest" | "account";
  welcome?: string;
  quickReplies?: { q: string; a: string }[];
  theme?: "light" | "dark";
  /** When true, this baked widget renders WITHOUT its own floating FAB and
   *  instead exposes window.__openlenChat.{open, openConversation, close}. Used
   *  when the site assistant is the single launcher and hands off to the human
   *  chat (assistant + chat both enabled → one bubble, not two). */
  chatAsHandoffTarget?: boolean;
}

// Coral OpenLen (#FF5A36, components/openlen-logo.tsx) — la cara del chat en
// páginas sin acento declarado; con acento, la marca de la página manda
// (detectSiteAccent lee --ol-accent primero desde el fix 2026-07-15).
const DEFAULT_ACCENT = "#FF5A36";
const WIDGET_MARKER = "data-ol-chat-widget";
const SECTION_MARKER = "data-ol-chat-section";
const FAB_HOST = `<div data-ol-chat-host data-ol-chat-fab></div>`;
const SECTION_HOST = `<div data-ol-chat-host></div>`;

function widgetScript(cfg: ChatWidgetConfig): string {
  // Embed ALL locale strings and pick at RUNTIME from <html lang>: the widget is
  // baked once and copied verbatim into translated locale variants, so a
  // build-time locale would freeze the root language onto every variant.
  // Escape "<" so nothing in the JSON (locale strings) can break out of the
  // <script> element.
  const C = JSON.stringify({
    sub: cfg.sub,
    // Solo un hex se interpola en el CSS del script (ACC aparece en ~14
    // reglas). Hoy todo caller pasa salida de detectSiteAccent (siempre
    // #rrggbb) — este guard evita que un futuro "color custom del widget"
    // reabra una inyección CSS sin que nadie lo note (review e56321c).
    accent: /^#[0-9a-fA-F]{3,8}$/.test(cfg.accent ?? "") ? cfg.accent : DEFAULT_ACCENT,
    mount: cfg.mount,
    selfServeJoin: cfg.selfServeJoin,
    branding: cfg.branding ?? true,
    bottom: cfg.bottomPx,
    title: cfg.title,
    identityMode: cfg.identityMode || "guest",
    welcome: cfg.welcome,
    quickReplies: cfg.quickReplies,
    theme: cfg.theme || "light",
    handoff: cfg.chatAsHandoffTarget ?? false,
    S: STRINGS,
  }).replace(/</g, "\\u003c");

  return `<script ${WIDGET_MARKER}>(function(){try{
var C=${C};
var T=C.S[(document.documentElement.lang||"en").slice(0,2).toLowerCase()]||C.S.en;
var ACC=C.accent;var BTM=(typeof C.bottom==="number"?C.bottom:18);
var DARK=C.theme==="dark";
var PBG=DARK?'#16171a':'#fff',PBD=DARK?'#2a2c31':'#ececef',PTX=DARK?'#e8e8ea':'#1a1a1a';
var MBG=DARK?'#0f1012':'#f7f7f8',BBG=DARK?'#232427':'#fff',BBD=DARK?'#2e3035':'#e8e8ea',BTX=DARK?'#e8e8ea':'#1a1a1a';
var CBG=DARK?'#16171a':'#fff',IBD=DARK?'#34363c':'#d8d8dc',ITX=DARK?'#e8e8ea':'#1a1a1a',MUT=DARK?'#7c7f87':'#9a9aa0';
var q=function(u,o){o=o||{};o.credentials="same-origin";return fetch("/api/chat/"+C.sub+u,o)};
function jreq(u,o){return q(u,o).then(function(r){return r.json().catch(function(){return{}}).then(function(j){return{s:r.status,j:j}})})}
function jpost(u,b){return jreq(u,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(b)})}
function el(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e}
function fmtT(x){try{return new Date(x).toLocaleTimeString([],{hour:"numeric",minute:"2-digit"})}catch(_e){return""}}
var HDBG='background:'+ACC+';background:color-mix(in srgb,'+ACC+' 76%,#170a05)';
var PAPER=DARK?'#0d1418':'#f4ede8';
var DOT='color-mix(in srgb,'+ACC+' 6%,transparent)';
var PAPERBG='background:'+PAPER+';background:radial-gradient(circle at 20% 30%,'+DOT+' 0 14px,transparent 15px),radial-gradient(circle at 70% 60%,'+DOT+' 0 10px,transparent 11px),radial-gradient(circle at 45% 85%,'+DOT+' 0 12px,transparent 13px),radial-gradient(circle at 85% 15%,'+DOT+' 0 9px,transparent 10px),'+PAPER;
var MINEBG=DARK
  ?'background:#26333a;background:color-mix(in srgb,'+ACC+' 26%,#141c21);color:#eceff1'
  :'background:#ffe9e2;background:color-mix(in srgb,'+ACC+' 14%,#fff);color:#221b17';
var CSS=':host{all:initial}'
+'*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}'
+'.fab{position:fixed;right:18px;bottom:'+BTM+'px;width:56px;height:56px;border-radius:50%;border:0;background:'+ACC+';color:#fff;cursor:pointer;box-shadow:0 6px 22px rgba(0,0,0,.22);z-index:2147483646;display:flex;align-items:center;justify-content:center;padding:0}'
+'.fab svg{width:26px;height:26px}'
+'.fab:focus-visible{outline:3px solid #000;outline-offset:2px}'
// align/justify: el panel flotante lleva AMBAS clases ("panel fab") y la regla
// del botón .fab trae align-items:center — sin este override los hijos del
// panel se encogían a su contenido (header angosto flotando; bug visible en
// prod desde el origen del widget, cazado en el restyle 2026-07-15).
+'.panel{background:'+PBG+';border-radius:18px;border:0;box-shadow:0 16px 56px rgba(0,0,0,.24);flex-direction:column;align-items:stretch;justify-content:flex-start;overflow:hidden;color:'+PTX+'}'
+'.panel.fab{position:fixed;right:18px;bottom:'+(BTM+66)+'px;width:360px;max-width:calc(100vw - 24px);height:540px;max-height:calc(100vh - 110px);z-index:2147483647;display:none}'
+'.panel.fab.open{display:flex}'
+'.panel.inline{display:flex;width:100%;max-width:680px;height:540px;margin:24px auto}'
+'.hd{'+HDBG+';color:#fff;padding:10px 14px;font-weight:600;display:flex;align-items:center;gap:11px}'
+'.hd .ava{width:38px;height:38px;border-radius:50%;background:rgba(255,255,255,.22);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:16px;flex:none}'
+'.hd .tt{font-size:15px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
+'.hd .ha{display:flex;gap:4px;align-items:center}'
+'.hd button{background:transparent;border:0;color:#fff;cursor:pointer;font-size:13px;padding:4px 6px;border-radius:6px}'
+'.hd .x{font-size:22px;line-height:1;padding:0 6px;opacity:.9}'
+'.bd{flex:1;display:flex;flex-direction:column;min-height:0;'+PAPERBG+'}'
+'.auth{padding:16px 14px;display:flex;flex-direction:column;gap:10px;overflow-y:auto}'
+'.hello{align-self:flex-start;background:'+BBG+';color:'+BTX+';border-radius:10px;border-top-left-radius:2px;box-shadow:0 1px 1px rgba(0,0,0,.08);padding:10px 13px;font-size:14px;line-height:1.45;max-width:92%;white-space:pre-wrap;word-wrap:break-word;margin-bottom:2px}'
+'.tabs{display:flex;gap:6px}'
+'.tabs button{flex:1;min-height:36px;border:1px solid '+IBD+';border-radius:999px;background:'+PBG+';font-weight:600;font-size:13px;cursor:pointer;color:'+PTX+'}'
+'.tabs button.on{background:'+ACC+';color:#fff;border-color:'+ACC+'}'
+'.auth input{min-height:44px;border:1px solid '+IBD+';border-radius:999px;padding:0 16px;font-size:14px;background:'+PBG+';color:'+ITX+';box-shadow:0 1px 2px rgba(0,0,0,.05)}'
+'.auth input:focus{outline:2px solid '+ACC+';border-color:'+ACC+'}'
+'.auth .go{min-height:46px;border:0;border-radius:999px;background:'+ACC+';color:#fff;font-weight:700;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.18)}'
+'.auth .go:disabled{opacity:.5;cursor:default}'
+'.err{color:#dc2626;font-size:12.5px;min-height:15px}'
+'.note{color:#6b7280;font-size:12.5px}'
+'.list{display:flex;flex-direction:column;flex:1;min-height:0}'
+'.srch{padding:10px;border-bottom:1px solid '+PBD+';display:flex;flex-direction:column;gap:6px}'
+'.srch input{min-height:40px;border:1px solid '+IBD+';border-radius:10px;padding:0 12px;font-size:14px;background:'+MBG+';color:'+ITX+'}'
+'.srch input:focus{outline:2px solid '+ACC+';border-color:'+ACC+'}'
+'.res{max-height:170px;overflow-y:auto;border:1px solid '+PBD+';border-radius:10px}'
+'.convs{flex:1;overflow-y:auto}'
+'.conv{padding:11px 14px;border-bottom:1px solid '+PBD+';cursor:pointer;display:flex;flex-direction:column;gap:1px}'
+'.conv:hover{background:'+MBG+'}'
+'.conv .cn{font-weight:600;font-size:14px}'
+'.conv .cu{color:'+MUT+';font-size:12px}'
+'.empty{color:'+MUT+';font-size:13.5px;padding:18px;text-align:center;display:flex;flex-direction:column;gap:10px;align-items:stretch}'
+'.mobtn{min-height:44px;border:0;border-radius:10px;background:'+ACC+';color:#fff;font-weight:600;cursor:pointer}'
+'.thread{display:flex;flex-direction:column;flex:1;min-height:0}'
+'.tbar{padding:8px 12px;border-bottom:1px solid '+PBD+';display:flex;align-items:center;gap:8px;background:'+PBG+'}'
+'.tbar .bk{border:0;background:transparent;cursor:pointer;font-size:13px;color:'+ACC+';padding:4px 2px;font-weight:600}'
+'.tbar .tinfo{display:flex;flex-direction:column;line-height:1.2;min-width:0}'
+'.tbar .who{font-weight:600;font-size:14px;color:'+PTX+'}'
+'.tbar .st{font-size:11px;color:'+MUT+';min-height:13px}'
+'.tbar .st.on{color:#16a34a}'
+'.msgs{flex:1;overflow-y:auto;padding:10px 14px;display:flex;flex-direction:column;gap:5px}'
+'.row{display:flex}'
+'.row.mine{justify-content:flex-end}'
+'.bub{max-width:80%;padding:7px 10px 5px;border-radius:10px;font-size:14px;line-height:1.4;white-space:pre-wrap;word-wrap:break-word;box-shadow:0 1px 1px rgba(0,0,0,.08)}'
+'.row.b .bub{background:'+BBG+';border-top-left-radius:2px;color:'+BTX+'}'
+'.row.mine .bub{'+MINEBG+';border-top-right-radius:2px}'
+'.bub .t{font-size:10.5px;opacity:.6;text-align:right;margin-top:2px}'
+'.chips{display:flex;flex-wrap:wrap;gap:6px;padding:2px 0 4px}'
+'.chip{padding:7px 12px;border-radius:999px;border:1.5px solid '+ACC+';background:'+PBG+';color:'+ACC+';font-size:12.5px;font-weight:600;cursor:pointer}'
+'.chip:hover{background:'+ACC+';color:#fff}'
+'.comp{display:flex;gap:8px;padding:8px 10px;align-items:center}'
+'.comp input{flex:1;min-height:44px;border:0;border-radius:999px;padding:0 18px;font-size:14px;background:'+CBG+';color:'+ITX+';box-shadow:0 1px 2px rgba(0,0,0,.1)}'
+'.comp input:focus{outline:2px solid '+ACC+'}'
+'.comp button{width:44px;min-width:44px;height:44px;border:0;border-radius:50%;background:'+ACC+';color:#fff;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.2)}'
+'.comp button:disabled{opacity:.5}'
+'.pb{font-size:11px;color:#b3b3b9;text-align:center;padding:5px 0}'
+'.pb a{color:#9a9aa0;text-decoration:none}'
+'.seen{font-size:10px;color:#53bdeb;text-align:right;padding:0 11px 4px}'
+'@media(max-width:480px){.panel.fab{right:8px;left:8px;bottom:78px;top:64px;width:auto;height:auto;max-height:none}}';

function instance(host,isFab){
if(!host||host.shadowRoot)return;
var R=host.attachShadow({mode:"open"});
var style=el("style");style.textContent=CSS;R.appendChild(style);
var panel=el("div","panel "+(isFab?"fab":"inline"));
var hd=el("div","hd");
var hdt=C.title||T.title;
hd.appendChild(el("div","ava",(hdt||"M").charAt(0).toUpperCase()));
hd.appendChild(el("span","tt",hdt));
var ha=el("div","ha");
var loBtn=el("button","lo",T.logout);loBtn.type="button";loBtn.style.display="none";ha.appendChild(loBtn);
var xb=null;
if(isFab){xb=el("button","x","×");xb.type="button";xb.setAttribute("aria-label",T.close);ha.appendChild(xb)}
hd.appendChild(ha);
var bd=el("div","bd");
panel.appendChild(hd);panel.appendChild(bd);
if(C.branding){var pb=el("div","pb");var a=el("a",null,"OpenLen");a.href="https://openlen.com";a.target="_blank";a.rel="noopener";pb.appendChild(document.createTextNode("with "));pb.appendChild(a);panel.appendChild(pb)}

var me=null,pollTimer=null,es=null,typT=null;
function stopPoll(){if(pollTimer){clearInterval(pollTimer);pollTimer=null}if(es){try{es.close()}catch(_e){}es=null}if(typT){clearTimeout(typT);typT=null}}
function clearBody(){stopPoll();bd.textContent=""}
function mapErr(s,code){if(code==="bad_username")return T.errBadUser;if(code==="bad_password")return T.errBadPass;if(code==="username_taken")return T.errTaken;if(code==="invite_only")return T.inviteOnly;if(code==="invalid"||s===401)return T.errInvalid;if(s===429)return T.errRate;return T.error}

function authView(){
clearBody();loBtn.style.display="none";
if(C.identityMode==="guest"){
  var gw=el("div","auth");
  if(C.welcome){gw.appendChild(el("div","hello",C.welcome))}
  var ge=el("div","err");
  var gn=el("input");gn.placeholder=T.guestName;gn.autocomplete="name";
  var gm=el("input");gm.placeholder=T.guestEmail;gm.type="email";gm.autocomplete="email";
  var gb=el("button","go",T.guestStart);gb.type="button";
  gw.appendChild(ge);gw.appendChild(gn);gw.appendChild(gm);gw.appendChild(gb);
  if(!C.selfServeJoin){gw.appendChild(el("div","note",T.inviteOnly))}
  gb.addEventListener("click",function(){
    var nm=(gn.value||"").trim();if(!nm){ge.textContent=T.guestNameRequired;return}
    gb.disabled=true;ge.textContent="";
    jpost("/auth/guest",{name:nm,email:(gm.value||"").trim()||undefined}).then(function(x){
      gb.disabled=false;
      if(x.s===200&&x.j&&x.j.user){me=x.j.user;listView()}else{ge.textContent=mapErr(x.s,x.j&&x.j.error)}
    }).catch(function(){gb.disabled=false;ge.textContent=T.error});
  });
  bd.appendChild(gw);setTimeout(function(){try{gn.focus()}catch(e){}},0);
  return;
}
var w=el("div","auth");
var tabs=el("div","tabs");
var tL=el("button",null,T.login);tL.type="button";
var tR=el("button",null,T.register);tR.type="button";
tabs.appendChild(tL);if(C.selfServeJoin)tabs.appendChild(tR);
var err=el("div","err");
var uname=el("input");uname.placeholder=T.username;uname.autocomplete="username";
var pass=el("input");pass.type="password";pass.placeholder=T.password;pass.autocomplete="current-password";
var dname=el("input");dname.placeholder=T.displayName;dname.style.display="none";
var go=el("button","go",T.loginBtn);go.type="button";
var mode="login";
function setMode(m){mode=m;tL.className=m==="login"?"on":"";tR.className=m==="register"?"on":"";dname.style.display=m==="register"?"block":"none";go.textContent=m==="register"?T.registerBtn:T.loginBtn;err.textContent=""}
tL.addEventListener("click",function(){setMode("login")});
tR.addEventListener("click",function(){setMode("register")});
w.appendChild(tabs);w.appendChild(err);w.appendChild(uname);w.appendChild(pass);w.appendChild(dname);w.appendChild(go);
if(!C.selfServeJoin){var note=el("div","note",T.inviteOnly);w.appendChild(note)}
go.addEventListener("click",function(){
var u=(uname.value||"").trim(),p=pass.value||"";
if(!u||!p){err.textContent=T.error;return}
go.disabled=true;err.textContent="";
var path=mode==="register"?"/auth/register":"/auth/login";
var body=mode==="register"?{username:u,password:p,displayName:(dname.value||"").trim()||undefined}:{username:u,password:p};
jpost(path,body).then(function(x){go.disabled=false;if(x.s===200&&x.j&&x.j.user){me=x.j.user;listView()}else{err.textContent=mapErr(x.s,x.j&&x.j.error)}}).catch(function(){go.disabled=false;err.textContent=T.error})});
bd.appendChild(w);setMode("login");setTimeout(function(){try{uname.focus()}catch(e){}},0);
}

function listView(){
clearBody();loBtn.style.display="";
var w=el("div","list");
var srch=el("div","srch");
var si=el("input");si.placeholder=T.search;si.autocomplete="off";
var res=el("div","res");res.style.display="none";
srch.appendChild(si);srch.appendChild(res);
var convs=el("div","convs");
w.appendChild(srch);w.appendChild(convs);bd.appendChild(w);
var st=null;
si.addEventListener("input",function(){
var term=(si.value||"").trim();
if(st)clearTimeout(st);
if(!term){res.style.display="none";res.textContent="";return}
st=setTimeout(function(){
jreq("/users/search?q="+encodeURIComponent(term)).then(function(x){
res.textContent="";var users=(x.j&&x.j.users)||[];
if(!users.length){res.appendChild(el("div","empty",T.noUsers));res.style.display="block";return}
users.forEach(function(u){var it=el("div","conv");it.appendChild(el("div","cn",u.displayName||u.username));it.appendChild(el("div","cu","@"+u.username));it.addEventListener("click",function(){openWith(u.username)});res.appendChild(it)});
res.style.display="block";
}).catch(function(){})},250)});
jreq("/conversations").then(function(x){
convs.textContent="";var list=(x.j&&x.j.conversations)||[];
if(!list.length){var emp=el("div","empty");var mob=el("button","mobtn",T.messageBusiness);mob.type="button";mob.addEventListener("click",messageOwner);emp.appendChild(mob);emp.appendChild(el("span",null,T.noConvos));convs.appendChild(emp);return}
list.forEach(function(c){var it=el("div","conv");it.appendChild(el("div","cn",c.otherDisplayName||c.otherUsername));it.appendChild(el("div","cu","@"+c.otherUsername));it.addEventListener("click",function(){threadView(c.id,c.otherDisplayName||c.otherUsername)});convs.appendChild(it)});
}).catch(function(){convs.textContent="";convs.appendChild(el("div","empty",T.error))});
}

function openWith(username){
jpost("/conversations",{username:username}).then(function(x){if(x.s===200&&x.j&&x.j.conversation){threadView(x.j.conversation.id,"@"+username)}}).catch(function(){})}

function messageOwner(){
jpost("/conversations/owner",{}).then(function(x){if(x.s===200&&x.j&&x.j.conversation){threadView(x.j.conversation.id,C.title||T.messageBusiness,true)}}).catch(function(){})}

function threadView(convId,who,business){
clearBody();loBtn.style.display="";
var selfId=me&&me.id;
var w=el("div","thread");
var tbar=el("div","tbar");
var bk=el("button","bk",T.back);bk.type="button";
var tinfo=el("div","tinfo");tinfo.appendChild(el("div","who",who));
var st=el("div","st");tinfo.appendChild(st);
tbar.appendChild(bk);tbar.appendChild(tinfo);
var msgs=el("div","msgs");
var comp=el("form","comp");
var ci=el("input");ci.placeholder=T.compose;ci.autocomplete="off";ci.maxLength=4000;
var cb=el("button",null,T.send);cb.type="submit";
comp.appendChild(ci);comp.appendChild(cb);
w.appendChild(tbar);w.appendChild(msgs);w.appendChild(comp);bd.appendChild(w);
function localBubble(body,mine){var row=el("div","row "+(mine?"mine":"b"));row.appendChild(el("div","bub",body));msgs.appendChild(row);msgs.scrollTop=msgs.scrollHeight}
if(business){
  if(C.welcome){localBubble(C.welcome,false)}
  var qr=C.quickReplies||[];
  if(qr.length){
    var chips=el("div","chips");
    qr.forEach(function(item){
      if(!item||!item.q||!item.a)return;
      var chip=el("button","chip",item.q);chip.type="button";
      chip.addEventListener("click",function(){localBubble(item.q,true);localBubble(item.a,false)});
      chips.appendChild(chip);
    });
    msgs.appendChild(chips);
  }
}
var lastCursor=null,seen={},online=false,typing=false,showT=null;
var otherReadAt=null,ownMsgs=[],seenEl=el("div","seen","✓✓ "+T.seen);
function renderSt(){if(typing){st.className="st";st.textContent=T.typing}else if(online){st.className="st on";st.textContent="● "+T.online}else{st.className="st";st.textContent=""}}
function add(m){if(!m||seen[m.id])return;seen[m.id]=1;var row=el("div","row "+(m.mine?"mine":"b"));var bub=el("div","bub",m.body);var tm=m.createdAt?fmtT(m.createdAt):"";if(tm)bub.appendChild(el("div","t",tm));row.appendChild(bub);if(m.mine)ownMsgs.push({createdAt:m.createdAt,row:row});msgs.appendChild(row)}
function updateSeen(){if(seenEl.parentNode)seenEl.parentNode.removeChild(seenEl);if(!otherReadAt)return;var orat=new Date(otherReadAt).getTime();var last=null;for(var i=0;i<ownMsgs.length;i++){if(new Date(ownMsgs[i].createdAt).getTime()<=orat)last=ownMsgs[i]}if(last){var ns=last.row.nextSibling;if(ns)msgs.insertBefore(seenEl,ns);else msgs.appendChild(seenEl)}}
function pull(){
var u="/messages?conversationId="+encodeURIComponent(convId)+(lastCursor?"&since="+encodeURIComponent(lastCursor):"");
jreq(u).then(function(x){var list=(x.j&&x.j.messages)||[];list.forEach(add);if(x.j&&x.j.nextCursor)lastCursor=x.j.nextCursor;if(x.j&&x.j.otherReadAt)otherReadAt=x.j.otherReadAt;updateSeen();if(list.length)msgs.scrollTop=msgs.scrollHeight}).catch(function(){})}
pull();stopPoll();pollTimer=setInterval(pull,2500);
// Live SSE layered on the poll (fallback). Same-origin relative → ol_chat
// cookie flows. Named events (message/presence/typing); raw message → compute
// mine = authorId === selfId. onerror → close, the 2.5s poll keeps running.
function onEvt(e){var evt;try{evt=JSON.parse(e.data)}catch(_e){return}
if(evt.type==="message"&&evt.message){var m=evt.message;m.mine=m.authorId===selfId;add(m);msgs.scrollTop=msgs.scrollHeight}
else if(evt.type==="presence"){if(evt.userId===selfId)return;online=!!evt.online;renderSt()}
else if(evt.type==="typing"){if(evt.userId===selfId)return;typing=!!evt.isTyping;renderSt();if(showT){clearTimeout(showT);showT=null}if(typing)showT=setTimeout(function(){typing=false;renderSt()},4000)}
else if(evt.type==="read"){if(evt.userId&&evt.userId!==selfId){otherReadAt=evt.readAt;updateSeen()}}}
try{es=new EventSource("/api/chat/"+C.sub+"/stream?conversationId="+encodeURIComponent(convId)+(lastCursor?"&since="+encodeURIComponent(lastCursor):""));
es.addEventListener("message",onEvt);es.addEventListener("presence",onEvt);es.addEventListener("typing",onEvt);es.addEventListener("read",onEvt);
es.onerror=function(){if(es){try{es.close()}catch(_e){}es=null}}}catch(_e){es=null}
bk.addEventListener("click",function(){stopPoll();listView()});
// Debounced typing ping: send true on input, false after idle/blur/send.
var typSent=false;
function ping(v){if(v===typSent)return;typSent=v;jpost("/typing",{conversationId:convId,isTyping:v})}
ci.addEventListener("input",function(){ping(true);if(typT)clearTimeout(typT);typT=setTimeout(function(){ping(false)},1500)});
ci.addEventListener("blur",function(){if(typT){clearTimeout(typT);typT=null}ping(false)});
comp.addEventListener("submit",function(e){e.preventDefault();var v=(ci.value||"").trim();if(!v)return;cb.disabled=true;if(typT){clearTimeout(typT);typT=null}ping(false);
jpost("/messages",{conversationId:convId,body:v}).then(function(x){cb.disabled=false;if(x.s===200&&x.j&&x.j.message){ci.value="";add(x.j.message);msgs.scrollTop=msgs.scrollHeight}else if(x.s===429){cb.disabled=false}}).catch(function(){cb.disabled=false})});
}

loBtn.addEventListener("click",function(){jpost("/auth/logout",{}).then(function(){me=null;authView()}).catch(function(){me=null;authView()})});

function start(){jreq("/me").then(function(x){if(x.j&&x.j.user){me=x.j.user;listView()}else{authView()}}).catch(function(){authView()})}

if(isFab){
var fab=null;
if(!C.handoff){
fab=el("button","fab");fab.type="button";fab.setAttribute("aria-label",T.open);
fab.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.9-.9L3 21l1.9-5.6A8.5 8.5 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z"/></svg>';
R.appendChild(fab);
}
R.appendChild(panel);
function openP(){panel.classList.add("open");if(fab)fab.setAttribute("aria-expanded","true");start()}
function closeP(){panel.classList.remove("open");if(fab)fab.setAttribute("aria-expanded","false");stopPoll()}
if(fab)fab.addEventListener("click",function(){panel.classList.contains("open")?closeP():openP()});
if(xb)xb.addEventListener("click",closeP);
host.addEventListener("keydown",function(e){if(e.key==="Escape"&&panel.classList.contains("open"))closeP()});
// Handoff target: no FAB of our own — the site assistant is the single launcher
// and opens us (already authed via the handoff cookie) straight into the
// escalated conversation via window.__openlenChat.openConversation(id).
if(C.handoff){var openConv=function(convId,who){panel.classList.add("open");jreq("/me").then(function(x){if(x.j&&x.j.user){me=x.j.user;threadView(convId,who||C.title||T.messageBusiness,true)}else{authView()}}).catch(function(){authView()})};try{window.__openlenChat={open:openP,openConversation:openConv,close:closeP}}catch(_e){}}
}else{R.appendChild(panel);start()}
}

function boot(){var hosts=document.querySelectorAll("[data-ol-chat-host]");for(var i=0;i<hosts.length;i++){instance(hosts[i],hosts[i].hasAttribute("data-ol-chat-fab"))}}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);else boot();
}catch(e){}})();
</script>`;
}

function injectBeforeBody(html: string, frag: string): string {
  const idx = html.lastIndexOf("</body>");
  return idx === -1 ? html + frag : html.slice(0, idx) + frag + html.slice(idx);
}

/** Inject the private-chat widget. Idempotent (skips if the widget script is
 *  already present). Renders the panel in a `data-ol-chat-section` placeholder
 *  when one exists (mount "section"/"both"); the floating FAB host + the runtime
 *  script go before </body> (mount "fab"/"both"). The same baked widget is
 *  copied into translated locale variants — it picks its UI language from
 *  <html lang> at runtime. Emits NO `data-slot-path` (reserved editor marker). */
export function bakeChatWidget(html: string, cfg: ChatWidgetConfig): string {
  if (html.includes(WIDGET_MARKER)) return html;

  const wantsFab = cfg.mount === "fab" || cfg.mount === "both";
  const wantsSection = cfg.mount === "section" || cfg.mount === "both";
  let out = html;

  if (wantsSection) {
    const markerRe = new RegExp(
      `<(section|div)([^>]*\\b${SECTION_MARKER}\\b[^>]*)>[\\s\\S]*?<\\/\\1>`,
      "i",
    );
    if (markerRe.test(out)) {
      out = out.replace(
        markerRe,
        (_m, tag, attrs) => `<${tag}${attrs}>${SECTION_HOST}</${tag}>`,
      );
    } else {
      out = injectBeforeBody(out, SECTION_HOST);
    }
  }

  // The runtime script (carrying the marker) always goes before </body>, after
  // the optional FAB host. A trailing "\n" keeps "</script>" from ever sitting
  // directly against "</body>" (no script-breakout-looking sequence on disk).
  const tail = (wantsFab ? FAB_HOST : "") + widgetScript(cfg) + "\n";
  return injectBeforeBody(out, tail);
}
