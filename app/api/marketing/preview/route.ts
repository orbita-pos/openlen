import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getProject } from "@/lib/projects";
import { listProfiles } from "@/lib/business-profiles/store";
import { getPostTemplate, getPostTemplateHtml } from "@/lib/marketing/post-templates/store";
import { fillPostTemplate } from "@/lib/marketing/fill";
import { buildPostData, extractPagePhotos } from "@/lib/marketing/post-data";

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/marketing/preview?projectId=<id>&postId=<slug>&offer=<txt>&photo=<url>
//
// Fills a post template with the project's/business's data and returns raw
// HTML for the workspace's Marketing tab to iframe. No AI call, no credit
// check — this is pure server-side templating (lib/marketing/fill.ts).
//
// CSP sandbox + no X-Frame-Options: the response MUST be iframable by the
// workspace (same posture as the post's own inline styles/scripts, sandboxed).
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return new NextResponse(null, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const projectId = sp.get("projectId");
  const postId = sp.get("postId");
  if (!projectId || !postId) return new NextResponse(null, { status: 400 });

  const project = await getProject(projectId, session.user.id);
  if (!project) return new NextResponse(null, { status: 404 });

  const profiles = await listProfiles(session.user.id);
  const profile = (profiles.find((p) => p.isDefault) ?? profiles[0])?.data ?? null;

  const post = await getPostTemplate(postId);
  if (!post || post.status !== "published") return new NextResponse(null, { status: 404 });

  const data = buildPostData({
    html: project.data.html,
    subdomain: project.subdomain ?? null,
    profile,
    pageTitle: project.title,
    userOffer: sp.get("offer") ?? undefined,
    photoUrl: sp.get("photo") ?? undefined,
  });

  // as=json: the workspace's PostDetail wants the built data + the page's own
  // photos to power captions + the photo strip — no HTML fetch/fill needed.
  if (sp.get("as") === "json") {
    return NextResponse.json({ data, pagePhotos: extractPagePhotos(project.data.html) });
  }

  const postHtml = await getPostTemplateHtml(postId);
  if (!postHtml) return new NextResponse(null, { status: 404 });

  return new NextResponse(fillPostTemplate(postHtml, data), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "sandbox allow-scripts",
      "Cache-Control": "no-store",
    },
  });
}
