// THE WAY BACK FROM THE OAUTH PROVIDER (spec local 2026-11-17-oauth-de-conectores-mcp, §5.4 step 3, §10.1, tightened by
// the final review's F5). The `state` alone is not trusted: the flow says where the sign-in was started.
//  - Web (the workspace's session): this browser must be signed in to OpenLen as the flow's person. The session cookie
//    (`authjs.session-token`, SameSite=Lax) rides the provider's top-level GET redirect, so a person who started here has
//    it. No session, or another person's: nothing is exchanged, the flow is spent, and the page says to open it again
//    from the OpenLen tab where it was started.
//  - Phone (the app's key; the system browser usually has no session): the code is exchanged but the tokens are HELD, not
//    a connection, and the page asks the person to confirm the OpenLen account (its email, masked) and the server, with a
//    one-time token in its form (`POST /api/mcp-connectors/oauth/confirm`). The same person's session skips the question;
//    another person's is refused.
// Then the result page tells the workspace (way-back-page.ts) and closes itself, or says the person can return to
// OpenLen. Never echoes `code`, `state`, a token or any provider string.
import { auth } from "@/auth";
import { mountServer } from "@/lib/mcp-connectors/mount";
import { oauthEnabled } from "@/lib/mcp-connectors/oauth/enabled";
import { finishSignIn, rememberNewIssuer } from "@/lib/mcp-connectors/oauth/flow";
import { SIGN_IN_CHANNEL } from "@/lib/mcp-connectors/oauth/sign-in-channel";
import { confirmPage, COPY, localeFrom, maskEmail, resultPage } from "@/lib/mcp-connectors/oauth/way-back-page";
import { realMountDeps, realOAuthDeps } from "@/lib/mcp-connectors/real";
import { markNeedsAuth, readMcpConfig, readServerStates } from "@/lib/mcp-connectors/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The email of the account a phone sign-in would go to, for the confirm page (masked there). */
async function emailOf(personId: string): Promise<string | null> {
  const { personEmail } = await import("@/lib/tools/store");
  return personEmail(personId).catch(() => null);
}

export async function GET(req: Request): Promise<Response> {
  const locale = localeFrom(req.headers.get("cookie"));
  const copy = COPY[locale];
  if (!oauthEnabled()) return resultPage(locale, copy.failed, { type: SIGN_IN_CHANNEL, server: null, ok: false, reason: "off" }, 404);
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
  if (r.ok === "confirm") return confirmPage(locale, r.server, maskEmail(await emailOf(r.personId)), r.confirmToken);
  if (r.ok) return resultPage(locale, copy.ok, { type: SIGN_IN_CHANNEL, server: r.server, ok: true }, 200);
  if (r.reason === "denied") return resultPage(locale, copy.denied, { type: SIGN_IN_CHANNEL, server: r.server ?? null, ok: false, reason: "denied" }, 200);
  if (r.reason === "issuer_changed") {
    // Stored, so the next card names where the sign-in is now (spec §10.2); the card hears the host, a hostname only.
    await rememberNewIssuer(r.personId, r.server, r.issuer, { readStates: readServerStates, markNeedsAuth }).catch(() => {});
    return resultPage(locale, copy.failed, { type: SIGN_IN_CHANNEL, server: r.server, ok: false, reason: r.reason, issuerHost: r.issuerHost }, 400);
  }
  if (r.reason === "wrong_browser") return resultPage(locale, copy.wrongBrowser, { type: SIGN_IN_CHANNEL, server: r.server ?? null, ok: false, reason: r.reason }, 403);
  if (r.reason === "other_account") return resultPage(locale, copy.otherAccount, { type: SIGN_IN_CHANNEL, server: r.server ?? null, ok: false, reason: r.reason }, 403);
  return resultPage(locale, copy.failed, { type: SIGN_IN_CHANNEL, server: r.server ?? null, ok: false, reason: r.reason }, 400);
}
