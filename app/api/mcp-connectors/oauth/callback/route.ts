// THE WAY BACK FROM THE OAUTH PROVIDER (spec local 2026-11-17-oauth-de-conectores-mcp, §5.4 step 3, §10.1): trusts the
// `state` (the session is only a cross-check when present: on the phone's browser there is none), exchanges the code,
// mounts the server, and serves a minimal HTML page that tells the workspace — on a same-origin `BroadcastChannel`, and
// with `postMessage` to `window.opener` as a fallback: the window was cut off from its opener on purpose, and a
// provider's Cross-Origin-Opener-Policy would do it anyway — and closes itself, or tells the person they can return to
// OpenLen. Never echoes `code`, `state`, a token or any provider string.
import { auth } from "@/auth";
import { mountServer } from "@/lib/mcp-connectors/mount";
import { oauthEnabled } from "@/lib/mcp-connectors/oauth/enabled";
import { finishSignIn, rememberNewIssuer } from "@/lib/mcp-connectors/oauth/flow";
import { realMountDeps, realOAuthDeps } from "@/lib/mcp-connectors/real";
import { SIGN_IN_CHANNEL } from "@/lib/mcp-connectors/oauth/sign-in-channel";
import { markNeedsAuth, readMcpConfig, readServerStates } from "@/lib/mcp-connectors/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Locale = "en" | "es" | "pt" | "fr" | "de" | "it" | "ja" | "ko" | "zh" | "nl";

const COPY: Record<Locale, { ok: string; denied: string; failed: string; back: string }> = {
  es: { ok: "Conectado.", denied: "No se conectó.", failed: "No se pudo completar el inicio de sesión.", back: "Ya puedes volver a OpenLen." },
  en: { ok: "Connected.", denied: "Not connected.", failed: "Couldn't finish signing in.", back: "You can return to OpenLen now." },
  pt: { ok: "Conectado.", denied: "Não foi conectado.", failed: "Não foi possível concluir o início de sessão.", back: "Já pode voltar ao OpenLen." },
  fr: { ok: "Connecté.", denied: "Non connecté.", failed: "Impossible de terminer la connexion.", back: "Vous pouvez revenir à OpenLen." },
  de: { ok: "Verbunden.", denied: "Nicht verbunden.", failed: "Anmeldung konnte nicht abgeschlossen werden.", back: "Du kannst jetzt zu OpenLen zurückkehren." },
  it: { ok: "Connesso.", denied: "Non connesso.", failed: "Impossibile completare l'accesso.", back: "Ora puoi tornare a OpenLen." },
  ja: { ok: "接続しました。", denied: "接続されませんでした。", failed: "サインインを完了できませんでした。", back: "OpenLen に戻ることができます。" },
  ko: { ok: "연결되었습니다.", denied: "연결되지 않았습니다.", failed: "로그인을 완료할 수 없습니다.", back: "이제 OpenLen으로 돌아갈 수 있습니다." },
  zh: { ok: "已连接。", denied: "未连接。", failed: "无法完成登录。", back: "现在可以返回 OpenLen。" },
  nl: { ok: "Verbonden.", denied: "Niet verbonden.", failed: "Aanmelden kon niet worden voltooid.", back: "Je kunt nu teruggaan naar OpenLen." },
};

function localeFrom(cookieHeader: string | null): Locale {
  const m = /(?:^|;\s*)NEXT_LOCALE=([a-z]{2})\b/i.exec(cookieHeader ?? "");
  const code = (m?.[1] ?? "es").toLowerCase();
  return (code in COPY ? code : "es") as Locale;
}

function page(
  locale: Locale,
  heading: string,
  payload: { type: typeof SIGN_IN_CHANNEL; server: string | null; ok: boolean; reason?: string; issuerHost?: string | null },
  status: number,
): Response {
  const copy = COPY[locale];
  const jsonPayload = JSON.stringify(payload).replace(/</g, "\\u003c");
  const html = `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>OpenLen</title>
</head>
<body>
<p>${heading} ${copy.back}</p>
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
</script>
</body>
</html>`;
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'",
    },
  });
}

export async function GET(req: Request): Promise<Response> {
  const locale = localeFrom(req.headers.get("cookie"));
  const copy = COPY[locale];
  if (!oauthEnabled()) return page(locale, copy.failed, { type: SIGN_IN_CHANNEL, server: null, ok: false, reason: "off" }, 404);
  const url = new URL(req.url);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? undefined;
  const error = url.searchParams.get("error") ?? undefined;
  const iss = url.searchParams.get("iss") ?? undefined;
  const sessionPersonId = (await auth().catch(() => null))?.user?.id ?? null;
  const r = await finishSignIn(
    { state, ...(code !== undefined ? { code } : {}), ...(error !== undefined ? { error } : {}), ...(iss !== undefined ? { iss } : {}) },
    sessionPersonId,
    {
      ...realOAuthDeps(),
      readConfig: readMcpConfig,
      mount: (p, n) => mountServer(p, n, realMountDeps()),
    },
  );
  if (r.ok) return page(locale, copy.ok, { type: SIGN_IN_CHANNEL, server: r.server, ok: true }, 200);
  if (r.reason === "denied") return page(locale, copy.denied, { type: SIGN_IN_CHANNEL, server: r.server ?? null, ok: false, reason: "denied" }, 200);
  if (r.reason === "issuer_changed") {
    // Stored, so the next card names where the sign-in is now (spec §10.2); the card hears the host, a hostname only.
    await rememberNewIssuer(r.personId, r.server, r.issuer, { readStates: readServerStates, markNeedsAuth }).catch(() => {});
    return page(locale, copy.failed, { type: SIGN_IN_CHANNEL, server: r.server, ok: false, reason: r.reason, issuerHost: r.issuerHost }, 400);
  }
  return page(locale, copy.failed, { type: SIGN_IN_CHANNEL, server: r.server ?? null, ok: false, reason: r.reason }, 400);
}
