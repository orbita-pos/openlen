// /u/<token> — THE UNSUBSCRIBE LINK OF A PROJECT'S APP OR FORM EMAIL (spec local
// 2026-10-22-email-integration, 6.7). GET only asks (a mail scanner opening the
// link unsubscribes nobody); POST unsubscribes — the page's button and the
// one-click POST of the List-Unsubscribe headers (RFC 8058) alike. The token is
// signed (lib/project-email/unsubscribe.ts): it only takes that address off that
// project's emails, and never off the sign-in ones.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

async function answer(req: Request, ctx: Ctx, unsubscribe: boolean): Promise<Response> {
  const [{ realUnsubscribeDeps }, { readUnsubscribeToken }, { pageLanguage, unsubscribePageHtml }] = await Promise.all([
    import("@/lib/project-email/real"),
    import("@/lib/project-email/unsubscribe"),
    import("@/lib/project-email/unsubscribe-page"),
  ]);
  const deps = realUnsubscribeDeps();
  const lang = pageLanguage(req.headers.get("accept-language"));
  const read = readUnsubscribeToken((await ctx.params).token, deps.secret);
  const page = (status: number, html: string) =>
    new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'" } });
  if (!read) return page(400, unsubscribePageHtml("invalid", { lang, sender: "", address: "" }));
  if (unsubscribe) await deps.store.suppress(read.projectId, read.address, "unsubscribed");
  const sender = (await deps.senderOf(read.projectId)) ?? "";
  return page(200, unsubscribePageHtml(unsubscribe ? "done" : "ask", { lang, sender, address: read.address }));
}

export function GET(req: Request, ctx: Ctx): Promise<Response> {
  return answer(req, ctx, false);
}

export function POST(req: Request, ctx: Ctx): Promise<Response> {
  return answer(req, ctx, true);
}
