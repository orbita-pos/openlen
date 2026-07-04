import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getProject } from "@/lib/projects";
import { listProfiles } from "@/lib/business-profiles/store";
import { getPostTemplate, getPostTemplateHtml } from "@/lib/marketing/post-templates/store";
import { fillPostTemplate } from "@/lib/marketing/fill";
import { buildPostData } from "@/lib/marketing/post-data";
import { renderCacheKey, renderPostPng } from "@/lib/marketing/render";
import { getOpenLenImageStorage } from "@/lib/storage/openlen-images";
import { tryConsumeMemory } from "@/lib/rate-limit-rs";

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/marketing/render?projectId&postId&offer&photo
//
// Renders a filled post template to a PNG via headless Chrome and redirects
// to the R2-cached copy, uploading on a cache miss. A real render is a real
// Chrome launch (unlike /preview's plain HTML) — rate-limited per user.
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return new NextResponse(null, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const projectId = sp.get("projectId");
  const postId = sp.get("postId");
  if (!projectId || !postId) return new NextResponse(null, { status: 400 });

  if (!tryConsumeMemory(`mkt-render:${session.user.id}`, 20, 60_000).allowed) {
    return new NextResponse(null, { status: 429 });
  }

  const project = await getProject(projectId, session.user.id);
  if (!project) return new NextResponse(null, { status: 404 });

  const profiles = await listProfiles(session.user.id);
  const profile = (profiles.find((p) => p.isDefault) ?? profiles[0])?.data ?? null;

  const post = await getPostTemplate(postId);
  if (!post || post.status !== "published") return new NextResponse(null, { status: 404 });
  const postHtml = await getPostTemplateHtml(postId);
  if (!postHtml) return new NextResponse(null, { status: 404 });

  const data = buildPostData({
    html: project.data.html,
    subdomain: project.subdomain ?? null,
    profile,
    pageTitle: project.title,
    userOffer: sp.get("offer") ?? undefined,
    photoUrl: sp.get("photo") ?? undefined,
  });
  const filled = fillPostTemplate(postHtml, data);
  const key = renderCacheKey(post.contentHash, filled);
  const storage = getOpenLenImageStorage();

  let publicUrl = r2PublicUrlFor(key);
  const cacheHit = publicUrl ? await headOk(publicUrl) : false;
  if (!cacheHit) {
    const png = await renderPostPng(filled, post.format);
    if (!png) return new NextResponse(null, { status: 503 });
    const uploaded = await storage.upload({ key, contentType: "image/png", body: png });
    publicUrl = uploaded.url;
  }
  return NextResponse.redirect(new URL(publicUrl!, req.url), 302);
}

// StorageAdapter (lib/storage/types.ts) has no exists()/head() — R2's public
// bucket answers HEAD 200/404 directly, so a cache hit can skip a render
// without a DB round-trip. Only attempted when R2 is actually configured
// (mirrors the check in openlen-images.ts's buildStorage): the filesystem
// fallback has no stable public origin worth HEAD-ing, and render+upload
// there is cheap and idempotent (same key, same bytes) — so we just render.
function r2PublicUrlFor(key: string): string | null {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY, R2_SECRET_KEY, R2_IMAGES_PUBLIC_URL } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY || !R2_SECRET_KEY) return null;
  const base = (R2_IMAGES_PUBLIC_URL || "https://images.openlen.com").replace(/\/+$/, "");
  return `${base}/${key}`;
}

async function headOk(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "HEAD" });
    return res.ok;
  } catch {
    return false;
  }
}
