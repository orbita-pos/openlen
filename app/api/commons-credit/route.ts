import { NextResponse } from "next/server";

import { creditFrom, isCommonsCopy, sidecarUrl } from "@/lib/chat/commons-image";

export const runtime = "nodejs";

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/commons-credit?url=<a photo image_search copied>
//
// The credit of a Wikimedia Commons photo in Len's reply (spec local
// 2026-10-27-chat-drop-and-images, Part B), read from the sidecar beside the
// copy. The chat can't read our storage's JSON across origins, so this route
// does — only for our own Commons copies (`isCommonsCopy`), so it fetches
// nothing else. The credit is public and never changes: cached a day.
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url).searchParams.get("url") ?? "";
  if (!isCommonsCopy(url)) return NextResponse.json({ error: "not a Commons copy" }, { status: 400 });
  const target = new URL(sidecarUrl(url), req.url).toString();
  const res = await fetch(target, { headers: { accept: "application/json" } }).catch(() => null);
  const credit = res?.ok ? creditFrom(await res.json().catch(() => null)) : null;
  if (!credit) return NextResponse.json({ error: "no credit" }, { status: 404 });
  return NextResponse.json(credit, { headers: { "cache-control": "public, max-age=86400" } });
}
