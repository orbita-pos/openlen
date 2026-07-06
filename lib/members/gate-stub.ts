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
import { deriveAccentInk } from "@/lib/theme-derive";

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
  /** Site accent (#rrggbb, from detectSiteAccent at publish) — tints the
   *  button/focus so the card wears the site's color. Absent/invalid →
   *  the neutral monochrome look. */
  accent?: string | null;
  /** Preset «Cuentas»: render the tabbed password card (register/login +
   *  magic-link). Off/absent → the magic-link-only form (invite preset). */
  passwordLogin?: boolean;
  /** gate = probe the protected page, swap on 200, show verify on 403.
   *  account = probe /me, render the dashboard (Task 3) on 200. Default gate. */
  mode?: "gate" | "account";
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
  tabIn: string;
  tabUp: string;
  passwordPlaceholder: string;
  createAccount: string;
  signIn: string;
  orLink: string;
  orWord: string;
  badCred: string;
  signupClosed: string;
  exists: string;
  badPassword: string;
  verifyTitle: string;
  verifyIntro: string;
  verifyBtn: string;
  acctTag: string;
  acctAccount: string;
  acctHi: string;
  acctHiNoName: string;
  acctPassword: string;
  acctPasswordHint: string;
  acctChange: string;
  acctSave: string;
  acctPwSaved: string;
  acctBookings: string;
  acctLogout: string;
  acctUnverified: string;
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
    tabIn: "Sign in",
    tabUp: "Sign up",
    passwordPlaceholder: "Password (min 8)",
    createAccount: "Create account",
    signIn: "Sign in",
    orLink: "Sign in with an email link",
    orWord: "or",
    badCred: "Wrong email or password.",
    signupClosed: "Sign-ups are closed here right now — try signing in, or ask for access.",
    exists: "That email is already registered — sign in instead.",
    badPassword: "Password must be at least 8 characters.",
    verifyTitle: "Confirm your email",
    verifyIntro: "To open this, confirm your email — we'll send you a link.",
    verifyBtn: "Send me the link",
    acctTag: "Your account",
    acctAccount: "Account",
    acctHi: "Hi, %s",
    acctHiNoName: "Your account",
    acctPassword: "Password",
    acctPasswordHint: "Sign in instantly next time",
    acctChange: "Change",
    acctSave: "Save",
    acctPwSaved: "Password updated",
    acctBookings: "My bookings",
    acctLogout: "Sign out",
    acctUnverified: "Email not confirmed",
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
    tabIn: "Entrar",
    tabUp: "Registrarse",
    passwordPlaceholder: "Contraseña (mín. 8)",
    createAccount: "Crear cuenta",
    signIn: "Entrar",
    orLink: "Entrar con un link por correo",
    orWord: "o",
    badCred: "Correo o contraseña incorrectos.",
    signupClosed: "Los registros están cerrados aquí ahora mismo — inicia sesión o pide acceso.",
    exists: "Ese correo ya está registrado — inicia sesión.",
    badPassword: "La contraseña debe tener al menos 8 caracteres.",
    verifyTitle: "Confirma tu correo",
    verifyIntro: "Para abrir esto, confirma tu correo — te enviamos un link.",
    verifyBtn: "Enviarme el link",
    acctTag: "Tu cuenta",
    acctAccount: "Cuenta",
    acctHi: "Hola, %s",
    acctHiNoName: "Tu cuenta",
    acctPassword: "Contraseña",
    acctPasswordHint: "Entra al instante la próxima vez",
    acctChange: "Cambiar",
    acctSave: "Guardar",
    acctPwSaved: "Contraseña actualizada",
    acctBookings: "Mis reservas",
    acctLogout: "Cerrar sesión",
    acctUnverified: "Correo sin confirmar",
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
    tabIn: "Entrar",
    tabUp: "Cadastrar",
    passwordPlaceholder: "Senha (mín. 8)",
    createAccount: "Criar conta",
    signIn: "Entrar",
    orLink: "Entrar com um link por e-mail",
    orWord: "ou",
    badCred: "E-mail ou senha incorretos.",
    signupClosed: "Os cadastros estão fechados aqui no momento — faça login ou peça acesso.",
    exists: "Esse e-mail já está cadastrado — faça login.",
    badPassword: "A senha deve ter pelo menos 8 caracteres.",
    verifyTitle: "Confirme seu e-mail",
    verifyIntro: "Para abrir isto, confirme seu e-mail — enviaremos um link.",
    verifyBtn: "Enviar o link",
    acctTag: "Sua conta",
    acctAccount: "Conta",
    acctHi: "Olá, %s",
    acctHiNoName: "Sua conta",
    acctPassword: "Senha",
    acctPasswordHint: "Entre na hora da próxima vez",
    acctChange: "Alterar",
    acctSave: "Salvar",
    acctPwSaved: "Senha atualizada",
    acctBookings: "Minhas reservas",
    acctLogout: "Sair",
    acctUnverified: "E-mail não confirmado",
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
    tabIn: "Se connecter",
    tabUp: "S'inscrire",
    passwordPlaceholder: "Mot de passe (min. 8)",
    createAccount: "Créer un compte",
    signIn: "Se connecter",
    orLink: "Se connecter avec un lien par e-mail",
    orWord: "ou",
    badCred: "E-mail ou mot de passe incorrect.",
    signupClosed: "Les inscriptions sont fermées ici pour le moment — connectez-vous ou demandez un accès.",
    exists: "Cet e-mail est déjà inscrit — connectez-vous.",
    badPassword: "Le mot de passe doit contenir au moins 8 caractères.",
    verifyTitle: "Confirmez votre e-mail",
    verifyIntro: "Pour ouvrir ceci, confirmez votre e-mail — nous vous enverrons un lien.",
    verifyBtn: "M'envoyer le lien",
    acctTag: "Votre compte",
    acctAccount: "Compte",
    acctHi: "Bonjour, %s",
    acctHiNoName: "Votre compte",
    acctPassword: "Mot de passe",
    acctPasswordHint: "Connectez-vous instantanément la prochaine fois",
    acctChange: "Modifier",
    acctSave: "Enregistrer",
    acctPwSaved: "Mot de passe mis à jour",
    acctBookings: "Mes réservations",
    acctLogout: "Se déconnecter",
    acctUnverified: "E-mail non confirmé",
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
    tabIn: "Anmelden",
    tabUp: "Registrieren",
    passwordPlaceholder: "Passwort (mind. 8)",
    createAccount: "Konto erstellen",
    signIn: "Anmelden",
    orLink: "Mit einem E-Mail-Link anmelden",
    orWord: "oder",
    badCred: "Falsche E-Mail oder falsches Passwort.",
    signupClosed: "Registrierungen sind hier gerade geschlossen — melde dich an oder bitte um Zugang.",
    exists: "Diese E-Mail ist bereits registriert — melde dich an.",
    badPassword: "Das Passwort muss mindestens 8 Zeichen haben.",
    verifyTitle: "Bestätige deine E-Mail",
    verifyIntro: "Zum Öffnen bestätige deine E-Mail — wir senden dir einen Link.",
    verifyBtn: "Link senden",
    acctTag: "Dein Konto",
    acctAccount: "Konto",
    acctHi: "Hallo, %s",
    acctHiNoName: "Dein Konto",
    acctPassword: "Passwort",
    acctPasswordHint: "Beim nächsten Mal sofort anmelden",
    acctChange: "Ändern",
    acctSave: "Speichern",
    acctPwSaved: "Passwort aktualisiert",
    acctBookings: "Meine Buchungen",
    acctLogout: "Abmelden",
    acctUnverified: "E-Mail nicht bestätigt",
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
    tabIn: "Accedi",
    tabUp: "Registrati",
    passwordPlaceholder: "Password (min. 8)",
    createAccount: "Crea account",
    signIn: "Accedi",
    orLink: "Accedi con un link via email",
    orWord: "o",
    badCred: "Email o password errati.",
    signupClosed: "Le registrazioni sono chiuse qui al momento — accedi o chiedi l'accesso.",
    exists: "Questa email è già registrata — accedi.",
    badPassword: "La password deve avere almeno 8 caratteri.",
    verifyTitle: "Conferma la tua email",
    verifyIntro: "Per aprire questo, conferma la tua email — ti invieremo un link.",
    verifyBtn: "Inviami il link",
    acctTag: "Il tuo account",
    acctAccount: "Account",
    acctHi: "Ciao, %s",
    acctHiNoName: "Il tuo account",
    acctPassword: "Password",
    acctPasswordHint: "Accedi subito la prossima volta",
    acctChange: "Modifica",
    acctSave: "Salva",
    acctPwSaved: "Password aggiornata",
    acctBookings: "Le mie prenotazioni",
    acctLogout: "Esci",
    acctUnverified: "Email non confermata",
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
    tabIn: "ログイン",
    tabUp: "新規登録",
    passwordPlaceholder: "パスワード（8文字以上）",
    createAccount: "アカウント作成",
    signIn: "ログイン",
    orLink: "メールのリンクでログイン",
    orWord: "または",
    badCred: "メールアドレスまたはパスワードが違います。",
    signupClosed: "現在このサイトでは新規登録を受け付けていません。ログインするか、アクセスを申請してください。",
    exists: "このメールアドレスは登録済みです。ログインしてください。",
    badPassword: "パスワードは8文字以上にしてください。",
    verifyTitle: "メールを確認してください",
    verifyIntro: "開くにはメールの確認が必要です。リンクをお送りします。",
    verifyBtn: "リンクを送る",
    acctTag: "アカウント",
    acctAccount: "アカウント",
    acctHi: "%s さん、こんにちは",
    acctHiNoName: "アカウント",
    acctPassword: "パスワード",
    acctPasswordHint: "次回はすぐにログインできます",
    acctChange: "変更",
    acctSave: "保存",
    acctPwSaved: "パスワードを更新しました",
    acctBookings: "予約一覧",
    acctLogout: "ログアウト",
    acctUnverified: "メール未確認",
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
    tabIn: "로그인",
    tabUp: "회원가입",
    passwordPlaceholder: "비밀번호 (8자 이상)",
    createAccount: "계정 만들기",
    signIn: "로그인",
    orLink: "이메일 링크로 로그인",
    orWord: "또는",
    badCred: "이메일 또는 비밀번호가 올바르지 않습니다.",
    signupClosed: "지금은 이 사이트에서 회원가입을 받지 않습니다 — 로그인하거나 접근을 요청하세요.",
    exists: "이미 등록된 이메일입니다 — 로그인하세요.",
    badPassword: "비밀번호는 8자 이상이어야 합니다.",
    verifyTitle: "이메일을 확인하세요",
    verifyIntro: "열려면 이메일을 확인하세요 — 링크를 보내드립니다.",
    verifyBtn: "링크 보내기",
    acctTag: "내 계정",
    acctAccount: "계정",
    acctHi: "%s님, 안녕하세요",
    acctHiNoName: "내 계정",
    acctPassword: "비밀번호",
    acctPasswordHint: "다음에는 바로 로그인됩니다",
    acctChange: "변경",
    acctSave: "저장",
    acctPwSaved: "비밀번호가 변경되었습니다",
    acctBookings: "내 예약",
    acctLogout: "로그아웃",
    acctUnverified: "이메일 미확인",
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
    tabIn: "登录",
    tabUp: "注册",
    passwordPlaceholder: "密码（至少 8 位）",
    createAccount: "创建账户",
    signIn: "登录",
    orLink: "使用邮件链接登录",
    orWord: "或",
    badCred: "邮箱或密码错误。",
    signupClosed: "此站点当前未开放注册 — 请登录或申请访问权限。",
    exists: "该邮箱已注册 — 请登录。",
    badPassword: "密码至少需要 8 个字符。",
    verifyTitle: "确认你的邮箱",
    verifyIntro: "要打开此内容，请确认你的邮箱 — 我们会给你发送链接。",
    verifyBtn: "给我发送链接",
    acctTag: "我的账户",
    acctAccount: "账户",
    acctHi: "你好，%s",
    acctHiNoName: "我的账户",
    acctPassword: "密码",
    acctPasswordHint: "下次即可直接登录",
    acctChange: "修改",
    acctSave: "保存",
    acctPwSaved: "密码已更新",
    acctBookings: "我的预约",
    acctLogout: "退出登录",
    acctUnverified: "邮箱未确认",
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
    tabIn: "Inloggen",
    tabUp: "Registreren",
    passwordPlaceholder: "Wachtwoord (min. 8)",
    createAccount: "Account aanmaken",
    signIn: "Inloggen",
    orLink: "Inloggen met een e-maillink",
    orWord: "of",
    badCred: "Onjuist e-mailadres of wachtwoord.",
    signupClosed: "Registraties zijn hier momenteel gesloten — log in of vraag toegang aan.",
    exists: "Dat e-mailadres is al geregistreerd — log in.",
    badPassword: "Het wachtwoord moet minstens 8 tekens bevatten.",
    verifyTitle: "Bevestig je e-mail",
    verifyIntro: "Om dit te openen, bevestig je e-mail — we sturen je een link.",
    verifyBtn: "Stuur mij de link",
    acctTag: "Je account",
    acctAccount: "Account",
    acctHi: "Hoi, %s",
    acctHiNoName: "Je account",
    acctPassword: "Wachtwoord",
    acctPasswordHint: "Log de volgende keer direct in",
    acctChange: "Wijzigen",
    acctSave: "Opslaan",
    acctPwSaved: "Wachtwoord bijgewerkt",
    acctBookings: "Mijn reserveringen",
    acctLogout: "Uitloggen",
    acctUnverified: "E-mail niet bevestigd",
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

/** Publish-time logout wiring for PROTECTED documents — same pattern as the
 *  forms/analytics injects: a tiny IIFE before </body>, added pre-seal so
 *  its hash enters the CSP. Any element carrying data-ol-logout (the
 *  auto-created members page ships one) becomes a working logout control:
 *  POST to the member API, then reload — the stub takes over. No-ops when
 *  the document has no such element. */
export function wireMemberLogout(html: string, sub: string): string {
  if (!html.includes("data-ol-logout")) return html;
  const script = `<script>(function(){document.addEventListener("click",function(e){var t=e.target&&e.target.closest&&e.target.closest("[data-ol-logout]");if(!t)return;e.preventDefault();fetch("/api/m/${sub}/auth/logout",{method:"POST",credentials:"same-origin"}).then(function(){location.reload()}).catch(function(){location.reload()});});})();</script>`;
  const idx = html.lastIndexOf("</body>");
  if (idx === -1) return html + script;
  return html.slice(0, idx) + script + html.slice(idx);
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

// Extra CSS for the passwordLogin tabbed card — appended after the base
// style rules, only when the preset is on. Uses the file's existing tokens
// (--field, --card, --fg, --muted, --ring, --focus); #m-btn is untouched so
// it keeps inheriting the accent rules above.
const PASSWORD_CSS = `
  .tabs{display:flex;gap:4px;background:var(--field);border-radius:12px;padding:4px;margin-top:22px}
  .tabs button{flex:1;border:0;background:transparent;color:var(--muted);font:inherit;font-weight:600;font-size:13.5px;padding:9px 0;border-radius:9px;cursor:pointer}
  .tabs button[aria-selected="true"]{background:var(--card);color:var(--fg);box-shadow:0 2px 8px -3px rgba(0,0,0,.25)}
  #m-pass{width:100%;margin-top:10px;padding:13px 16px;font-size:15px;color:var(--fg);background:var(--field);border:1px solid var(--ring);border-radius:12px;outline:none}
  #m-pass:focus{border-color:var(--focus)}
  .or{display:flex;align-items:center;gap:12px;color:var(--muted);font-size:12px;margin:16px 0 10px;text-transform:lowercase}
  .or::before,.or::after{content:"";height:1px;flex:1;background:var(--ring)}
  .ghost{width:100%;padding:12px;font-size:13.5px;font-weight:600;color:var(--fg);background:transparent;border:1px solid var(--ring);border-radius:12px;cursor:pointer}
  .ghost:disabled{opacity:.5;cursor:default}
  #m-verify .intro{margin-top:14px;font-size:14.5px;line-height:1.55;color:var(--muted)}`;

// Extra CSS for the account dashboard (mode:"account"), appended after
// PASSWORD_CSS — account mode shows BOTH the auth card (logged out) and the
// dashboard (logged in). The card <main> is text-align:center; the dashboard
// needs left-aligned rows.
const DASHBOARD_CSS = `
  #m-acct{text-align:left}
  .acct-head{display:flex;align-items:center;gap:13px}
  .avatar{width:44px;height:44px;border-radius:50%;background:var(--field);display:grid;place-items:center;font-weight:700;color:var(--fg);font-size:16px;text-transform:uppercase}
  .acct-head h3{font-size:16px;letter-spacing:-.01em;font-weight:700}
  .acct-head .em{font-size:12.5px;color:var(--muted);margin-top:2px}
  .chip{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:600;padding:5px 10px;border-radius:999px;margin-top:18px;background:color-mix(in srgb,var(--btn-bg) 15%,transparent);color:var(--btn-bg)}
  .sec-label{font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-top:20px}
  .row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 0;border-top:1px solid var(--ring)}
  .row:first-of-type{margin-top:10px}
  .row .k{font-size:13.5px;font-weight:600}
  .row .s{font-size:12px;color:var(--muted);margin-top:2px}
  .mini{border:1px solid var(--ring);background:transparent;border-radius:10px;font:inherit;font-weight:600;font-size:12.5px;color:var(--fg);padding:8px 13px;cursor:pointer;white-space:nowrap}
  .mini:disabled{opacity:.5}
  #m-pwform{display:flex;gap:8px;margin-top:12px}
  #m-newpw{flex:1;padding:11px 14px;font-size:14px;color:var(--fg);background:var(--field);border:1px solid var(--ring);border-radius:10px;outline:none}
  #m-newpw:focus{border-color:var(--focus)}
  .logout{margin-top:20px;width:100%;text-align:center;background:transparent;border:0;color:var(--muted);font:inherit;font-size:12.5px;cursor:pointer;padding:6px}`;

export function buildGateStub(params: GateStubParams): string {
  const locale =
    params.locale && STRINGS[params.locale] ? params.locale : "en";
  const t = STRINGS[locale];
  const title = escapeHtml(params.projectTitle.trim() || params.sub);
  // Site accent (validated) tints button/focus/lock; the ink keeps the
  // button text readable on it (same engine as the Looks system).
  const accentHex =
    params.accent && /^#[0-9a-fA-F]{6}$/.test(params.accent.trim())
      ? params.accent.trim().toLowerCase()
      : null;
  const accentCss = accentHex
    ? `\n  :root{--btn-bg:${accentHex};--btn-fg:${deriveAccentInk(accentHex)};--focus:${accentHex}}`
    : "";
  const logo = params.logoUrl?.trim()
    ? `<img class="logo" src="${escapeHtml(params.logoUrl.trim())}" alt="">`
    : `<svg class="logo lock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="9" rx="2.2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`;

  const passwordLogin = params.passwordLogin === true;
  const mode = params.mode === "account" ? "account" : "gate";

  // Spliced into passwordScript's IIFE (shares its API/T scope) only when
  // mode==="account". Runs synchronously at IIFE-execution time — before the
  // on-load /me fetch's `.then` (async) resolves — so window.__olRenderAccount
  // is already defined by the time it's called. Paints every per-member value
  // via textContent (never innerHTML); booking rows are built with
  // document.createElement + textContent. The %s in acctHi is filled via a
  // FUNCTION replacer so a name containing "$" can't trigger $-pattern
  // substitution.
  const accountTail = `
var ACCT=${scriptJson({ hi: t.acctHi, hiNoName: t.acctHiNoName, pwSaved: t.acctPwSaved })},LOCALE=${scriptJson(locale)};
function fmtDate(iso){try{return new Date(iso).toLocaleString(LOCALE,{weekday:"short",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"});}catch(e){return "";}}
window.__olRenderAccount=function(data){
var nm=(data&&data.name)||"",em=(data&&data.email)||"";
document.getElementById("m-ava").textContent=(nm||em||"?").trim().charAt(0).toUpperCase();
document.getElementById("m-hi").textContent=nm?ACCT.hi.replace("%s",function(){return nm;}):ACCT.hiNoName;
document.getElementById("m-em").textContent=em;
document.getElementById("m-chip").hidden=!!(data&&data.verified);
var list=(data&&data.bookings)||[],box=document.getElementById("m-bklist");
if(list.length){
for(var i=0;i<list.length;i++){
var b=list[i],row=document.createElement("div");row.className="row";
var left=document.createElement("div");
var k=document.createElement("div");k.className="k";k.textContent=b.service||"";
var s=document.createElement("div");s.className="s";s.textContent=fmtDate(b.startUtc);
left.appendChild(k);left.appendChild(s);row.appendChild(left);box.appendChild(row);
}
document.getElementById("m-bookings").hidden=false;
}
document.getElementById("m-loading").hidden=true;
document.getElementById("m-acct").hidden=false;
};
var chpw=document.getElementById("m-chpw"),pwform=document.getElementById("m-pwform"),newpw=document.getElementById("m-newpw"),pwmsg=document.getElementById("m-pwmsg");
if(chpw)chpw.addEventListener("click",function(){pwform.hidden=!pwform.hidden;if(!pwform.hidden)newpw.focus();});
if(pwform)pwform.addEventListener("submit",function(e){
e.preventDefault();var sv=document.getElementById("m-pwsave");sv.disabled=true;pwmsg.hidden=true;
fetch(API+"/auth/set-password",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({password:newpw.value})}).then(function(r){
sv.disabled=false;
if(r.status===200){pwform.hidden=true;newpw.value="";pwmsg.textContent=ACCT.pwSaved;pwmsg.hidden=false;return;}
pwmsg.textContent=r.status===400?T.badPassword:T.error;pwmsg.hidden=false;
}).catch(function(){sv.disabled=false;pwmsg.textContent=T.error;pwmsg.hidden=false;});
});
var lo=document.getElementById("m-logout");
if(lo)lo.addEventListener("click",function(){lo.disabled=true;fetch(API+"/auth/logout",{method:"POST",credentials:"same-origin"}).then(function(){location.reload();}).catch(function(){location.reload();});});`;

  const legacyScript = `(function(){
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

  // Two independent state axes: MODE (gate|account, baked from params) and
  // tab (up|in, the register/login toggle). On successful auth — register OR
  // login — we just reload: the on-load probe re-runs and lands on the
  // exactly-right next state (protected doc swap / verify / dashboard), so
  // there's no register-vs-login branch to get wrong. The verify button
  // fetches /me first because POST /auth/request requires an explicit email
  // and never reads the session cookie — and #m-email is empty here (the
  // member arrived already logged in, just unverified).
  const passwordScript = `(function(){
var SUB=${scriptJson(params.sub)},SLUG=${scriptJson(params.slug)},MODE=${scriptJson(mode)},T=${scriptJson({
    linkInvalid: t.linkInvalid, tooMany: t.tooMany, checkInbox: t.checkInbox, error: t.error,
    createAccount: t.createAccount, signIn: t.signIn, badCred: t.badCred, signupClosed: t.signupClosed, exists: t.exists, badPassword: t.badPassword,
  })};
var API="/api/m/"+SUB;
var loading=document.getElementById("m-loading"),auth=document.getElementById("m-auth"),verify=document.getElementById("m-verify");
var form=document.getElementById("m-form"),email=document.getElementById("m-email"),pass=document.getElementById("m-pass"),btn=document.getElementById("m-btn"),msg=document.getElementById("m-msg");
var tabIn=document.getElementById("m-tab-in"),tabUp=document.getElementById("m-tab-up");
var tab="up";
var hadErr=/[?&]m_err=/.test(location.search);
function setMsg(el,text){el.textContent=text;el.hidden=false;}
function showAuth(){loading.hidden=true;auth.hidden=false;if(hadErr)setMsg(msg,T.linkInvalid);}
function showVerify(){loading.hidden=true;auth.hidden=true;verify.hidden=false;}
function selTab(m){tab=m;var up=m==="up";tabUp.setAttribute("aria-selected",up?"true":"false");tabIn.setAttribute("aria-selected",up?"false":"true");btn.textContent=up?T.createAccount:T.signIn;pass.setAttribute("autocomplete",up?"new-password":"current-password");msg.hidden=true;}
tabIn.addEventListener("click",function(){selTab("in");});
tabUp.addEventListener("click",function(){selTab("up");});
if(MODE==="account"){
  fetch(API+"/me",{credentials:"same-origin"}).then(function(r){
    if(r.status===200)return r.json().then(function(d){if(window.__olRenderAccount){window.__olRenderAccount(d);}else{location.reload();}});
    showAuth();
  }).catch(showAuth);
}else{
  fetch(API+"/page/"+SLUG,{credentials:"same-origin"}).then(function(r){
    if(r.status===200)return r.text().then(function(h){document.open();document.write(h);document.close();});
    if(r.status===403)return showVerify();
    showAuth();
  }).catch(showAuth);
}
form.addEventListener("submit",function(e){
  e.preventDefault();btn.disabled=true;msg.hidden=true;
  var path=tab==="up"?"/register":"/login";
  fetch(API+"/auth"+path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:email.value,password:pass.value})}).then(function(r){
    btn.disabled=false;
    if(r.status===200){location.reload();return;}
    if(r.status===429){setMsg(msg,T.tooMany);return;}
    if(r.status===409){setMsg(msg,T.exists);return;}
    if(r.status===400){setMsg(msg,T.badPassword);return;}
    if(r.status===403){setMsg(msg,T.signupClosed);return;}
    setMsg(msg,T.badCred);
  }).catch(function(){btn.disabled=false;setMsg(msg,T.error);});
});
document.getElementById("m-link").addEventListener("click",function(){
  var b=this,em=(email.value||"").trim();
  if(!em){email.focus();return;}
  b.disabled=true;msg.hidden=true;
  fetch(API+"/auth/request",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:em,slug:SLUG})}).then(function(r){
    b.disabled=false;setMsg(msg,r.status===429?T.tooMany:T.checkInbox);
  }).catch(function(){b.disabled=false;setMsg(msg,T.error);});
});
var vbtn=document.getElementById("m-vbtn"),vmsg=document.getElementById("m-vmsg");
if(vbtn)vbtn.addEventListener("click",function(){
  vbtn.disabled=true;vmsg.hidden=true;
  fetch(API+"/me",{credentials:"same-origin"}).then(function(r){return r.status===200?r.json():null;}).then(function(me){
    var em=me&&me.email;
    if(!em){vbtn.disabled=false;setMsg(vmsg,T.error);return;}
    return fetch(API+"/auth/request",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:em,slug:SLUG})}).then(function(r){
      vbtn.disabled=false;setMsg(vmsg,r.status===429?T.tooMany:T.checkInbox);
    });
  }).catch(function(){vbtn.disabled=false;setMsg(vmsg,T.error);});
});
selTab("up");
${mode === "account" ? accountTail : ""}
})();`;

  const script = passwordLogin ? passwordScript : legacyScript;

  const legacyFormMarkup = `<form id="m-form" hidden>
    <p class="intro">${escapeHtml(t.intro)}</p>
    <input id="m-email" type="email" required autocomplete="email" placeholder="${escapeHtml(t.emailPlaceholder)}">
    <button id="m-btn" type="submit">${escapeHtml(t.sendLink)}</button>
    <p id="m-msg" hidden></p>
  </form>`;

  const passwordCardMarkup = `<div id="m-auth" hidden>
    <div class="tabs" role="tablist">
      <button id="m-tab-in" type="button" role="tab" aria-selected="false">${escapeHtml(t.tabIn)}</button>
      <button id="m-tab-up" type="button" role="tab" aria-selected="true">${escapeHtml(t.tabUp)}</button>
    </div>
    <form id="m-form">
      <input id="m-email" type="email" required autocomplete="email" placeholder="${escapeHtml(t.emailPlaceholder)}">
      <input id="m-pass" type="password" required autocomplete="new-password" minlength="8" placeholder="${escapeHtml(t.passwordPlaceholder)}">
      <button id="m-btn" type="submit">${escapeHtml(t.createAccount)}</button>
    </form>
    <div class="or"><span>${escapeHtml(t.orWord)}</span></div>
    <button id="m-link" type="button" class="ghost">${escapeHtml(t.orLink)}</button>
    <p id="m-msg" hidden></p>
  </div>
  <div id="m-verify" hidden>
    <p class="intro" style="font-weight:600;color:var(--fg)">${escapeHtml(t.verifyTitle)}</p>
    <p class="intro">${escapeHtml(t.verifyIntro)}</p>
    <button id="m-vbtn" type="button" class="ghost" style="margin-top:16px">${escapeHtml(t.verifyBtn)}</button>
    <p id="m-vmsg" hidden></p>
  </div>`;

  // Static copy is escaped at build; the ONLY elements filled from /me at
  // runtime are #m-ava, #m-hi, #m-em, and the #m-bklist rows (ACCOUNT_TAIL,
  // via textContent — never innerHTML). The chip text is static, toggled by
  // `hidden`.
  const accountMarkup =
    mode === "account"
      ? `<div id="m-acct" hidden>
    <div class="acct-head">
      <div class="avatar" id="m-ava"></div>
      <div><h3 id="m-hi"></h3><div class="em" id="m-em"></div></div>
    </div>
    <span class="chip" id="m-chip" hidden>${escapeHtml(t.acctUnverified)}</span>
    <div class="sec-label">${escapeHtml(t.acctAccount)}</div>
    <div class="row">
      <div><div class="k">${escapeHtml(t.acctPassword)}</div><div class="s">${escapeHtml(t.acctPasswordHint)}</div></div>
      <button type="button" class="mini" id="m-chpw">${escapeHtml(t.acctChange)}</button>
    </div>
    <form id="m-pwform" hidden>
      <input id="m-newpw" type="password" autocomplete="new-password" minlength="8" placeholder="${escapeHtml(t.passwordPlaceholder)}">
      <button type="submit" class="mini" id="m-pwsave">${escapeHtml(t.acctSave)}</button>
    </form>
    <p id="m-pwmsg" class="s" hidden></p>
    <div id="m-bookings" hidden>
      <div class="sec-label">${escapeHtml(t.acctBookings)}</div>
      <div id="m-bklist"></div>
    </div>
    <button type="button" class="logout" id="m-logout">${escapeHtml(t.acctLogout)}</button>
  </div>`
      : "";
  const cardBody = passwordLogin ? passwordCardMarkup + accountMarkup : legacyFormMarkup;
  const extraCss = passwordLogin
    ? PASSWORD_CSS + (mode === "account" ? DASHBOARD_CSS : "")
    : "";
  // "Members only" is wrong copy on a sign-in/account card.
  const tagText = mode === "account" ? t.acctTag : t.tag;

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
    --btn-bg:var(--fg);--btn-fg:var(--bg);--focus:var(--fg);
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
  .logo.lock{opacity:.55;padding:4px;color:var(--btn-bg)}
  .tag{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted);font-weight:600}
  h1{margin-top:8px;font-size:clamp(22px,5vw,28px);letter-spacing:-.02em;line-height:1.15;font-weight:700}
  #m-loading{margin-top:22px;font-size:14px;color:var(--muted)}
  #m-form p.intro{margin-top:14px;font-size:14.5px;line-height:1.55;color:var(--muted)}
  #m-email{
    width:100%;margin-top:20px;padding:13px 16px;font-size:15px;color:var(--fg);
    background:var(--field);border:1px solid var(--ring);border-radius:12px;outline:none;
  }
  #m-email:focus{border-color:var(--focus)}
  #m-btn{
    width:100%;margin-top:10px;padding:13px 16px;font-size:14.5px;font-weight:600;
    color:var(--btn-fg);background:var(--btn-bg);border:0;border-radius:12px;cursor:pointer;
    transition:opacity .15s,transform .15s;
  }
  #m-btn:hover{opacity:.88}
  #m-btn:active{transform:scale(.985)}
  #m-btn:disabled{opacity:.5;cursor:default}
  #m-msg{margin-top:14px;font-size:13.5px;line-height:1.5;color:var(--muted)}${extraCss}${accentCss}
</style>
</head>
<body>
<main>
  ${logo}
  <p class="tag">${escapeHtml(tagText)}</p>
  <h1>${title}</h1>
  <div id="m-loading">${escapeHtml(t.checking)}</div>
  ${cardBody}
  <noscript><p class="intro" style="margin-top:18px">${escapeHtml(t.intro)}</p></noscript>
</main>
<script>${script}</script>
</body>
</html>
`;
}
