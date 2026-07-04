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
// Renders a filled post template to a PNG via headless Chrome, caches it in
// R2 by content hash, and streams the bytes back same-origin (rather than
// redirecting to the R2 URL — images.openlen.com sends no CORS headers, and
// the workspace's Download/Share buttons need real bytes: Share builds a File
// for navigator.share, and Download needs a readable !res.ok to toast a real
// error instead of a silent cross-origin "Failed to fetch"). A real render is
// a real Chrome launch (unlike /preview's plain HTML) — rate-limited per user.
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
    register: post.register,
    match: sp.get("match") !== "0",
  });
  const filled = fillPostTemplate(postHtml, data);
  const key = renderCacheKey(post.contentHash, filled);
  const storage = getOpenLenImageStorage();

  const publicUrl = r2PublicUrlFor(key);
  const cacheHit = publicUrl ? await headOk(publicUrl) : false;

  let png: Buffer;
  if (cacheHit) {
    // Cache-hit path intentionally bypasses withRenderSlot/renderPostPng — a
    // plain R2 fetch, not a Chrome launch, so it doesn't compete for the
    // render concurrency cap.
    const cached = await fetch(publicUrl!);
    if (!cached.ok) return new NextResponse(null, { status: 502 });
    png = Buffer.from(await cached.arrayBuffer());
  } else {
    const rendered = await renderPostPng(filled, post.format);
    if (!rendered) return new NextResponse(null, { status: 503 });
    png = rendered;
    await storage.upload({ key, contentType: "image/png", body: png });
  }

  return new NextResponse(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "private, max-age=300",
      "Content-Disposition": `inline; filename="${postId}.png"`,
    },
  });
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
