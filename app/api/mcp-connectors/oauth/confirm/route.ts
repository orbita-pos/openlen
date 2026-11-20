// THE PERSON'S YES TO A PHONE SIGN-IN (spec local 2026-11-17-oauth-de-conectores-mcp, §10.1, final review F5): the form
// of the way-back page posts here — «Connect to this account» or «This isn't me» — with the sign-in's one-time token.
// Only that token identifies the held tokens (its hash is what is stored), and it works once. The post must come from
// OpenLen's own page: a browser that says where a request comes from (`Sec-Fetch-Site`, or a real `Origin`) must say
// OpenLen; the page's CSP lets its form post nowhere else. A browser signed in as another person is refused. The answer
// is the same result page as the way back.
import { auth } from "@/auth";
import { siteOrigin } from "@/lib/mcp/config";
import { mountServer } from "@/lib/mcp-connectors/mount";
import { oauthEnabled } from "@/lib/mcp-connectors/oauth/enabled";
import { confirmSignIn } from "@/lib/mcp-connectors/oauth/flow";
import { SIGN_IN_CHANNEL } from "@/lib/mcp-connectors/oauth/sign-in-channel";
import { COPY, localeFrom, resultPage } from "@/lib/mcp-connectors/oauth/way-back-page";
import { realMountDeps, realOAuthDeps } from "@/lib/mcp-connectors/real";
import { readMcpConfig } from "@/lib/mcp-connectors/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The post came from OpenLen's own page, as far as the browser says: a fetch-metadata header, else a real origin. A
 *  browser that says neither (or sends `Origin: null`, which a no-referrer page's form does) leans on the token. */
function fromOpenLen(req: Request): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site !== null) return site === "same-origin";
  const origin = req.headers.get("origin");
  if (origin === null || origin === "null") return true;
  return origin === new URL(siteOrigin()).origin || origin === new URL(req.url).origin;
}

export async function POST(req: Request): Promise<Response> {
  const locale = localeFrom(req.headers.get("cookie"));
  const copy = COPY[locale];
  if (!oauthEnabled()) return resultPage(locale, copy.failed, { type: SIGN_IN_CHANNEL, server: null, ok: false, reason: "off" }, 404);
  if (!fromOpenLen(req)) return resultPage(locale, copy.failed, { type: SIGN_IN_CHANNEL, server: null, ok: false, reason: "unknown" }, 403);
  const form = await req.formData().catch(() => null);
  const token = form?.get("token");
  const answer = form?.get("answer");
  if (typeof token !== "string" || (answer !== "connect" && answer !== "discard")) {
    return resultPage(locale, copy.failed, { type: SIGN_IN_CHANNEL, server: null, ok: false, reason: "unknown" }, 400);
  }
  const sessionPersonId = (await auth().catch(() => null))?.user?.id ?? null;
  const r = await confirmSignIn(token, answer, sessionPersonId, {
    ...realOAuthDeps(),
    readConfig: readMcpConfig,
    mount: (p, n) => mountServer(p, n, realMountDeps()),
  });
  if (r.ok) return resultPage(locale, copy.ok, { type: SIGN_IN_CHANNEL, server: r.server, ok: true }, 200);
  if (r.reason === "discarded") return resultPage(locale, copy.discarded, { type: SIGN_IN_CHANNEL, server: r.server ?? null, ok: false, reason: "denied" }, 200);
  if (r.reason === "other_account") return resultPage(locale, copy.otherAccount, { type: SIGN_IN_CHANNEL, server: r.server ?? null, ok: false, reason: r.reason }, 403);
  if (r.reason === "expired" || r.reason === "unknown") return resultPage(locale, copy.expired, { type: SIGN_IN_CHANNEL, server: null, ok: false, reason: r.reason }, 400);
  return resultPage(locale, copy.failed, { type: SIGN_IN_CHANNEL, server: r.server ?? null, ok: false, reason: r.reason }, 400);
}
