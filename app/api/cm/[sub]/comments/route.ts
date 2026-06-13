import { z } from "zod";
import { checkAndConsume, getClientIp, ipLimitKey } from "@/lib/limits";
import { readMemberCookie } from "@/lib/members/session";
import { getMemberById, getMemberSession } from "@/lib/members/store";
import { COMMENT_POST_LIMITS, commentPostKey } from "@/lib/comments/limits";
import { insertComment, listVisibleComments } from "@/lib/comments/store";
import { PAGE_SLUG_RE, json, loadCommentsSite } from "../_shared";

// ─────────────────────────────────────────────────────────────────────────────
// /api/cm/[sub]/comments — the comments widget on a published page talks here.
//
// GET  ?slug=<slug>           — public: the VISIBLE thread for a page.
// POST { slug?, body }        — members-only: post a comment. The ol_member
//                               session decides identity (copied verbatim from
//                               the protected-page route). New comments land
//                               'visible' or 'hidden' per the site's moderation.
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function pageFromSlug(raw: string | null): string | null {
  if (!raw) return null;
  return PAGE_SLUG_RE.test(raw) ? raw : null;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ sub: string }> },
): Promise<Response> {
  const { sub } = await params;
  const site = await loadCommentsSite(sub);
  if (!site || !site.commentsEnabled) return json({ comments: [] }, 200);

  const page = pageFromSlug(new URL(req.url).searchParams.get("slug"));
  const comments = await listVisibleComments(site.projectId, page);
  return json(
    { comments, moderation: site.moderation },
    200,
  );
}

const PostSchema = z.object({
  slug: z.string().regex(PAGE_SLUG_RE).optional(),
  body: z.string().trim().min(1).max(2000),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ sub: string }> },
): Promise<Response> {
  const { sub } = await params;
  const site = await loadCommentsSite(sub);
  if (!site) return json({ error: "not_found" }, 404);
  // Comments require the members module — that's the whole anti-spam basis.
  if (!site.commentsEnabled || !site.membersEnabled) {
    return json({ error: "disabled" }, 403);
  }

  // Session check — identical to the protected-page route.
  const cookie = readMemberCookie(req);
  const session = cookie ? await getMemberSession(cookie) : null;
  if (!session || session.projectId !== site.projectId) {
    return json({ error: "auth" }, 401);
  }
  const member = await getMemberById(session.memberId);
  if (!member || member.status !== "active") return json({ error: "auth" }, 401);

  const parsed = PostSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "invalid_body" }, 400);

  // Anti-flood: per-member (project-scoped) + per-IP.
  const ip = getClientIp(req);
  const memberDecision = await checkAndConsume(
    commentPostKey(site.projectId, member.id),
    COMMENT_POST_LIMITS,
  );
  if (!memberDecision.ok) return json({ error: "rate_limited" }, 429);
  const ipDecision = await checkAndConsume(
    ipLimitKey(ip, "comment-post"),
    COMMENT_POST_LIMITS,
  );
  if (!ipDecision.ok) return json({ error: "rate_limited" }, 429);

  const status = site.moderation === "all" ? "visible" : "hidden";
  const created = await insertComment({
    projectId: site.projectId,
    page: pageFromSlug(parsed.data.slug ?? null),
    memberId: member.id,
    authorName: member.name,
    authorEmail: member.email,
    body: parsed.data.body,
    status,
  });

  return json(
    {
      id: created.id,
      status: created.status,
      createdAt: created.createdAt,
      // The widget shows "awaiting approval" when hidden.
      authorName: member.name,
    },
    201,
  );
}
