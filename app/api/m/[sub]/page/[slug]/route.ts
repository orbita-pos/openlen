import { readProtectedPage } from "@/lib/publish/filesystem";
import { readMemberCookie, verifyMemberSession } from "@/lib/members/session";
import { getMemberById } from "@/lib/members/store";
import { PAGE_SLUG_RE, json, loadMemberSite } from "../../_shared";

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/m/[sub]/page/[slug] — the protected document behind a gate stub.
//
// Auth = the host-only ol_member cookie: a valid JWT whose projectId matches
// this sub's project AND whose member row still exists as active (revocation
// = the owner deleted the row; it bites on the very next fetch). The bytes
// come from <sub>/protected/<current-sha>/ — outside the web tier's reach,
// resolved through the same `current` pointer as the public release, so
// rollbacks stay coherent.
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ sub: string; slug: string }> },
): Promise<Response> {
  const { sub, slug } = await params;
  if (!PAGE_SLUG_RE.test(slug)) return json({ error: "not_found" }, 404);

  const site = await loadMemberSite(sub);
  if (!site) return json({ error: "not_found" }, 404);
  if (!site.membersEnabled) return json({ error: "auth" }, 401);

  const cookie = readMemberCookie(req);
  const claims = cookie ? await verifyMemberSession(cookie) : null;
  if (!claims || claims.projectId !== site.projectId) {
    return json({ error: "auth" }, 401);
  }
  const member = await getMemberById(claims.memberId);
  if (!member || member.status !== "active") return json({ error: "auth" }, 401);

  const html = await readProtectedPage(sub, slug);
  if (html === null) return json({ error: "not_found" }, 404);

  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex",
    },
  });
}
