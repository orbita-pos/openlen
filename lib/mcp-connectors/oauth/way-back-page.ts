// THE PAGES OF THE WAY BACK FROM AN OAUTH SIGN-IN (spec local 2026-11-17-oauth-de-conectores-mcp, §5.4 step 3, §10.1;
// final review F5): what `GET /api/mcp-connectors/oauth/callback` and `POST /api/mcp-connectors/oauth/confirm` answer.
//
// - The result page: one line in the person's language, and a script that tells the workspace on a same-origin
//   `BroadcastChannel` (and with `postMessage` to `window.opener` as a fallback: the window was cut off from its opener on
//   purpose, and a provider's Cross-Origin-Opener-Policy would do it anyway), then closes the window.
// - The confirm page of a phone sign-in (F5): it names the OpenLen account the connection would go to — its email,
//   masked — and the server, with «Connect to this account» and «This isn't me». Its form carries ONE thing: the one-time
//   token of this sign-in. Never the `code`, the `state`, a token or anything a provider sent.
//
// Every page: no-store, no-referrer, a CSP that runs nothing from elsewhere and posts forms only to OpenLen
// (`form-action 'self'`), and never in a frame (`frame-ancestors 'none'`, `X-Frame-Options: DENY`): a confirm button in
// somebody else's frame would be a click they could steal.
import { SIGN_IN_CHANNEL } from "./sign-in-channel";

export type Locale = "en" | "es" | "pt" | "fr" | "de" | "it" | "ja" | "ko" | "zh" | "nl";

interface Copy {
  ok: string;
  denied: string;
  failed: string;
  back: string;
  /** A web sign-in that came back to a browser not signed in as its person (F5). */
  wrongBrowser: string;
  /** A phone sign-in that came back to a browser signed in as another person (F5). */
  otherAccount: string;
  /** The confirm page's question: {server} and {account} (the masked email). */
  confirmQuestion: string;
  confirmHint: string;
  connect: string;
  notMe: string;
  discarded: string;
  expired: string;
}

export const COPY: Record<Locale, Copy> = {
  es: {
    ok: "Conectado.",
    denied: "No se conectó.",
    failed: "No se pudo completar el inicio de sesión.",
    back: "Ya puedes volver a OpenLen.",
    wrongBrowser: "No se conectó nada: este inicio de sesión tiene que terminar en el navegador donde tienes abierto OpenLen. Ábrelo otra vez desde la pestaña de OpenLen donde lo empezaste.",
    otherAccount: "No se conectó nada: este inicio de sesión es de otra cuenta de OpenLen.",
    confirmQuestion: "¿Conectar «{server}» a la cuenta de OpenLen {account}?",
    confirmHint: "Hazlo sólo si lo empezaste tú desde la app de OpenLen. Si no, no es tuyo: elige «No soy yo».",
    connect: "Conectar a esta cuenta",
    notMe: "No soy yo",
    discarded: "No se conectó. No se guardó nada.",
    expired: "Este inicio de sesión ya caducó o ya se usó. Vuelve a empezarlo desde OpenLen.",
  },
  en: {
    ok: "Connected.",
    denied: "Not connected.",
    failed: "Couldn't finish signing in.",
    back: "You can return to OpenLen now.",
    wrongBrowser: "Nothing was connected: this sign-in has to finish in the browser where you're signed in to OpenLen. Open it again from the OpenLen tab where you started it.",
    otherAccount: "Nothing was connected: this sign-in belongs to another OpenLen account.",
    confirmQuestion: "Connect “{server}” to the OpenLen account {account}?",
    confirmHint: "Only if you started this yourself from the OpenLen app. If not, it isn't yours: choose “This isn't me”.",
    connect: "Connect to this account",
    notMe: "This isn't me",
    discarded: "Not connected. Nothing was saved.",
    expired: "This sign-in has expired or was already used. Start it again from OpenLen.",
  },
  pt: {
    ok: "Conectado.",
    denied: "Não foi conectado.",
    failed: "Não foi possível concluir o início de sessão.",
    back: "Já pode voltar ao OpenLen.",
    wrongBrowser: "Nada foi conectado: este início de sessão tem de terminar no navegador onde tem o OpenLen aberto. Abra-o de novo a partir do separador do OpenLen onde o começou.",
    otherAccount: "Nada foi conectado: este início de sessão é de outra conta do OpenLen.",
    confirmQuestion: "Conectar «{server}» à conta do OpenLen {account}?",
    confirmHint: "Só se foi você que o começou na app do OpenLen. Se não, não é seu: escolha «Não sou eu».",
    connect: "Conectar a esta conta",
    notMe: "Não sou eu",
    discarded: "Não foi conectado. Nada foi guardado.",
    expired: "Este início de sessão expirou ou já foi usado. Comece-o de novo no OpenLen.",
  },
  fr: {
    ok: "Connecté.",
    denied: "Non connecté.",
    failed: "Impossible de terminer la connexion.",
    back: "Vous pouvez revenir à OpenLen.",
    wrongBrowser: "Rien n'a été connecté : cette connexion doit se terminer dans le navigateur où vous êtes connecté à OpenLen. Relancez-la depuis l'onglet OpenLen où vous l'avez commencée.",
    otherAccount: "Rien n'a été connecté : cette connexion appartient à un autre compte OpenLen.",
    confirmQuestion: "Connecter « {server} » au compte OpenLen {account} ?",
    confirmHint: "Seulement si vous l'avez lancée vous-même depuis l'app OpenLen. Sinon, ce n'est pas la vôtre : choisissez « Ce n'est pas moi ».",
    connect: "Connecter à ce compte",
    notMe: "Ce n'est pas moi",
    discarded: "Non connecté. Rien n'a été enregistré.",
    expired: "Cette connexion a expiré ou a déjà été utilisée. Relancez-la depuis OpenLen.",
  },
  de: {
    ok: "Verbunden.",
    denied: "Nicht verbunden.",
    failed: "Anmeldung konnte nicht abgeschlossen werden.",
    back: "Du kannst jetzt zu OpenLen zurückkehren.",
    wrongBrowser: "Nichts wurde verbunden: Diese Anmeldung muss in dem Browser enden, in dem du bei OpenLen angemeldet bist. Starte sie erneut aus dem OpenLen-Tab, in dem du sie begonnen hast.",
    otherAccount: "Nichts wurde verbunden: Diese Anmeldung gehört zu einem anderen OpenLen-Konto.",
    confirmQuestion: "„{server}“ mit dem OpenLen-Konto {account} verbinden?",
    confirmHint: "Nur wenn du das selbst in der OpenLen-App gestartet hast. Sonst ist es nicht deins: Wähle „Das bin ich nicht“.",
    connect: "Mit diesem Konto verbinden",
    notMe: "Das bin ich nicht",
    discarded: "Nicht verbunden. Nichts wurde gespeichert.",
    expired: "Diese Anmeldung ist abgelaufen oder wurde schon verwendet. Starte sie in OpenLen neu.",
  },
  it: {
    ok: "Connesso.",
    denied: "Non connesso.",
    failed: "Impossibile completare l'accesso.",
    back: "Ora puoi tornare a OpenLen.",
    wrongBrowser: "Non è stato collegato nulla: questo accesso deve finire nel browser in cui hai aperto OpenLen. Riaprilo dalla scheda di OpenLen in cui l'hai iniziato.",
    otherAccount: "Non è stato collegato nulla: questo accesso è di un altro account OpenLen.",
    confirmQuestion: "Collegare «{server}» all'account OpenLen {account}?",
    confirmHint: "Solo se l'hai avviato tu dall'app di OpenLen. Altrimenti non è tuo: scegli «Non sono io».",
    connect: "Collega a questo account",
    notMe: "Non sono io",
    discarded: "Non connesso. Non è stato salvato nulla.",
    expired: "Questo accesso è scaduto o è già stato usato. Riavvialo da OpenLen.",
  },
  ja: {
    ok: "接続しました。",
    denied: "接続されませんでした。",
    failed: "サインインを完了できませんでした。",
    back: "OpenLen に戻ることができます。",
    wrongBrowser: "何も接続されていません。このサインインは OpenLen にサインインしているブラウザーで完了する必要があります。始めた OpenLen のタブからもう一度開いてください。",
    otherAccount: "何も接続されていません。このサインインは別の OpenLen アカウントのものです。",
    confirmQuestion: "「{server}」を OpenLen アカウント {account} に接続しますか?",
    confirmHint: "OpenLen アプリからご自身で始めた場合だけ続けてください。そうでなければあなたのものではありません。「自分ではない」を選んでください。",
    connect: "このアカウントに接続",
    notMe: "自分ではない",
    discarded: "接続されませんでした。何も保存されていません。",
    expired: "このサインインは期限切れか、すでに使われています。OpenLen からもう一度始めてください。",
  },
  ko: {
    ok: "연결되었습니다.",
    denied: "연결되지 않았습니다.",
    failed: "로그인을 완료할 수 없습니다.",
    back: "이제 OpenLen으로 돌아갈 수 있습니다.",
    wrongBrowser: "아무것도 연결되지 않았습니다. 이 로그인은 OpenLen에 로그인된 브라우저에서 끝나야 합니다. 시작한 OpenLen 탭에서 다시 여세요.",
    otherAccount: "아무것도 연결되지 않았습니다. 이 로그인은 다른 OpenLen 계정의 것입니다.",
    confirmQuestion: "“{server}”을(를) OpenLen 계정 {account}에 연결할까요?",
    confirmHint: "OpenLen 앱에서 직접 시작한 경우에만 계속하세요. 아니라면 내 것이 아닙니다. “내가 아님”을 선택하세요.",
    connect: "이 계정에 연결",
    notMe: "내가 아님",
    discarded: "연결되지 않았습니다. 아무것도 저장되지 않았습니다.",
    expired: "이 로그인은 만료되었거나 이미 사용되었습니다. OpenLen에서 다시 시작하세요.",
  },
  zh: {
    ok: "已连接。",
    denied: "未连接。",
    failed: "无法完成登录。",
    back: "现在可以返回 OpenLen。",
    wrongBrowser: "没有连接任何内容：此登录必须在已登录 OpenLen 的浏览器中完成。请从你开始的 OpenLen 标签页重新打开。",
    otherAccount: "没有连接任何内容：此登录属于另一个 OpenLen 帐户。",
    confirmQuestion: "将“{server}”连接到 OpenLen 帐户 {account}？",
    confirmHint: "仅当你自己从 OpenLen 应用开始时才继续。否则这不是你的：请选择“不是我”。",
    connect: "连接到此帐户",
    notMe: "不是我",
    discarded: "未连接。没有保存任何内容。",
    expired: "此登录已过期或已被使用。请从 OpenLen 重新开始。",
  },
  nl: {
    ok: "Verbonden.",
    denied: "Niet verbonden.",
    failed: "Aanmelden kon niet worden voltooid.",
    back: "Je kunt nu teruggaan naar OpenLen.",
    wrongBrowser: "Er is niets verbonden: deze aanmelding moet eindigen in de browser waarin je bij OpenLen bent aangemeld. Open hem opnieuw vanuit het OpenLen-tabblad waar je begon.",
    otherAccount: "Er is niets verbonden: deze aanmelding hoort bij een ander OpenLen-account.",
    confirmQuestion: "“{server}” verbinden met het OpenLen-account {account}?",
    confirmHint: "Alleen als je dit zelf in de OpenLen-app bent begonnen. Zo niet, dan is het niet van jou: kies “Dit ben ik niet”.",
    connect: "Met dit account verbinden",
    notMe: "Dit ben ik niet",
    discarded: "Niet verbonden. Er is niets opgeslagen.",
    expired: "Deze aanmelding is verlopen of al gebruikt. Begin opnieuw in OpenLen.",
  },
};

export function localeFrom(cookieHeader: string | null): Locale {
  const m = /(?:^|;\s*)NEXT_LOCALE=([a-z]{2})\b/i.exec(cookieHeader ?? "");
  const code = (m?.[1] ?? "es").toLowerCase();
  return (code in COPY ? code : "es") as Locale;
}

/** The account a phone sign-in would go to, as the confirm page names it: the email's first letter and its domain
 *  (`j***@gmail.com`) — enough for its owner to recognize it, not a whole address on a page anyone could be sent. */
export function maskEmail(email: string | null | undefined): string {
  const e = (email ?? "").trim();
  const at = e.lastIndexOf("@");
  if (at < 1 || at === e.length - 1) return "***";
  return `${Array.from(e.slice(0, at))[0]}***@${e.slice(at + 1)}`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
  "x-frame-options": "DENY",
} as const;

function document(locale: Locale, body: string, status: number): Response {
  const html = `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>OpenLen</title>
</head>
<body>
${body}
</body>
</html>`;
  return new Response(html, { status, headers: HEADERS });
}

export type WayBackPayload = { type: typeof SIGN_IN_CHANNEL; server: string | null; ok: boolean; reason?: string; issuerHost?: string | null };

/** The result page: one line, the message to the workspace, and the window closes. */
export function resultPage(locale: Locale, heading: string, payload: WayBackPayload, status: number): Response {
  const jsonPayload = JSON.stringify(payload).replace(/</g, "\\u003c");
  return document(
    locale,
    `<p>${escapeHtml(heading)} ${escapeHtml(COPY[locale].back)}</p>
<script>
(function () {
  var payload = ${jsonPayload};
  try {
    if (typeof BroadcastChannel !== "undefined") {
      var channel = new BroadcastChannel("${SIGN_IN_CHANNEL}");
      channel.postMessage(payload);
      channel.close();
    }
  } catch (e) {}
  try {
    if (window.opener) window.opener.postMessage(payload, location.origin);
  } catch (e) {}
  // After the message is on its way, not before.
  setTimeout(function () {
    try {
      window.close();
    } catch (e) {}
  }, 150);
})();
</script>`,
    status,
  );
}

/** Where the confirm page's form posts. Same origin: the page and the route are OpenLen's. */
export const CONFIRM_PATH = "/api/mcp-connectors/oauth/confirm";

/** The confirm page of a phone sign-in (F5): the account (masked) and the server, and a form whose only field is the
 *  one-time token. No script: nothing on it runs. */
export function confirmPage(locale: Locale, server: string, account: string, confirmToken: string): Response {
  const copy = COPY[locale];
  // One pass with a function: neither value is read as a pattern (`$&`) or as the other placeholder.
  const question = copy.confirmQuestion.replace(/\{(server|account)\}/g, (_, k: string) => (k === "server" ? server : account));
  return document(
    locale,
    `<p>${escapeHtml(question)}</p>
<p>${escapeHtml(copy.confirmHint)}</p>
<form method="post" action="${CONFIRM_PATH}">
<input type="hidden" name="token" value="${escapeHtml(confirmToken)}">
<button type="submit" name="answer" value="connect">${escapeHtml(copy.connect)}</button>
<button type="submit" name="answer" value="discard">${escapeHtml(copy.notMe)}</button>
</form>`,
    200,
  );
}
