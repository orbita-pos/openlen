import { gateStringsFor } from "@/lib/members/gate-stub";
import { buildMemberCookie } from "@/lib/members/session";
import {
  activateMember,
  clearMemberPassword,
  consumeLoginToken,
  createMemberSession,
  deleteMemberSessions,
  getMemberAuthByEmail,
  markMemberVerified,
  recordMemberAuthEvent,
  upsertActiveMember,
} from "@/lib/members/store";
import { shouldClearPassword } from "@/lib/members/verification";
import { PAGE_SLUG_RE, json, loadMemberSite, seeOther } from "../../_shared";

// ─────────────────────────────────────────────────────────────────────────────
// /api/m/[sub]/auth/verify — the magic link lands here.
//
// GET is a state-changing-NOTHING interstitial: a tiny auto-submitting form.
// Email security scanners prefetch every link in an inbox; if GET consumed
// the token, the member's click would always find it already used. Same
// link → page → POST shape as the app's own password-reset flow.
//
// POST consumes the token (single-use, race-safe in the store) and sets the
// host-only member cookie, then 303s to the gated page — a relative redirect,
// so the cookie host and the content host can't diverge on custom domains.
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOKEN_RE = /^[A-Za-z0-9_-]{20,100}$/;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ sub: string }> },
): Promise<Response> {
  const { sub } = await params;
  const site = await loadMemberSite(sub);
  if (!site) return json({ error: "not_found" }, 404);

  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  const slugParam = url.searchParams.get("s") ?? "";
  const slug = PAGE_SLUG_RE.test(slugParam) ? slugParam : null;
  if (!TOKEN_RE.test(token)) {
    return seeOther(slug ? `/${slug}/?m_err=1` : "/?m_err=1");
  }

  const t = gateStringsFor(site.locale);
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const html = `<!doctype html>
<html lang="${esc(site.locale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(site.title)}</title>
<style>
  :root{--bg:#fafafa;--fg:#16181d;--muted:#6b7280;--card:rgba(255,255,255,.72);--ring:rgba(22,24,29,.08)}
  @media (prefers-color-scheme:dark){:root{--bg:#101216;--fg:#f3f4f6;--muted:#9ca3af;--card:rgba(255,255,255,.05);--ring:rgba(255,255,255,.10)}}
  *{margin:0;box-sizing:border-box}html,body{height:100%}
  body{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--fg);display:grid;place-items:center;padding:24px}
  main{text-align:center;max-width:420px;width:100%;background:var(--card);border:1px solid var(--ring);border-radius:24px;padding:44px 36px;backdrop-filter:blur(18px)}
  h1{font-size:22px;letter-spacing:-.02em}
  button{margin-top:22px;padding:13px 28px;font-size:14.5px;font-weight:600;color:var(--bg);background:var(--fg);border:0;border-radius:12px;cursor:pointer}
</style>
</head>
<body>
<main>
  <h1>${esc(site.title)}</h1>
  <form method="post">
    <input type="hidden" name="token" value="${esc(token)}">
    ${slug ? `<input type="hidden" name="s" value="${esc(slug)}">` : ""}
    <button type="submit">${esc(t.enter)}</button>
  </form>
</main>
<script>document.forms[0].submit();</script>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
    },
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ sub: string }> },
): Promise<Response> {
  const { sub } = await params;
  const site = await loadMemberSite(sub);
  if (!site) return json({ error: "not_found" }, 404);

  let token = "";
  let slugParam = "";
  try {
    const form = await req.formData();
    token = String(form.get("token") ?? "");
    slugParam = String(form.get("s") ?? "");
  } catch {
    return seeOther("/?m_err=1");
  }
  // Only used for the ERROR redirect — the success path trusts the slug
  // stored with the token, never request input.
  const fallbackSlug = PAGE_SLUG_RE.test(slugParam) ? slugParam : null;
  const errPath = fallbackSlug ? `/${fallbackSlug}/?m_err=1` : "/?m_err=1";

  if (!site.membersEnabled || !TOKEN_RE.test(token)) return seeOther(errPath);

  const consumed = await consumeLoginToken(token, site.projectId);
  if (!consumed) return seeOther(errPath);

  let memberId: string;
  const existing = await getMemberAuthByEmail(site.projectId, consumed.email);
  if (existing) {
    if (
      shouldClearPassword({
        tokenKind: consumed.kind,
        hasPassword: existing.passwordHash !== null,
        alreadyVerified: existing.emailVerifiedAt !== null,
      })
    ) {
      // Reclamo: el dueño real (probado por este link) recupera; la contraseña
      // no confirmada del okupa y sus sesiones mueren ANTES de mintear la nueva.
      await clearMemberPassword(existing.id);
      await deleteMemberSessions(site.projectId, existing.id);
    }
    await activateMember(existing.id);
    memberId = existing.id;
  } else if (site.membersMode === "open") {
    memberId = (await upsertActiveMember(site.projectId, consumed.email)).id;
  } else {
    // Invitación y la fila desapareció entre request y click.
    return seeOther(errPath);
  }

  await markMemberVerified(memberId);
  const session = await createMemberSession(site.projectId, memberId);
  recordMemberAuthEvent({
    projectId: site.projectId,
    memberId,
    email: consumed.email,
    type: "login",
  });
  const target = consumed.slug ? `/${consumed.slug}/` : "/";
  return seeOther(target, buildMemberCookie(session));
}
