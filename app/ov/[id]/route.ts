import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { previewTokenMatches } from "@/lib/projects/preview";
import { renderOverlayHtml } from "@/lib/overlay/render";
import type { ProjectData } from "@/lib/projects/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// GET /ov/[id]?t=<token> — public, token-gated OBS/browser-source page for the
// streamer overlay module (settings.overlay). No login: whoever holds the
// link drops it into a browser source and sees the live goal/screen state.
// The token is server-minted onto data.settings.overlay.token (see
// settings-patch.ts) and NEVER accepted from a client patch.
//
// Clones the /p/[id] preview-link posture (see lib/projects/preview.ts):
// timing-safe token compare (previewTokenMatches — reused as-is; it's already
// a public export, not module-private, so no extraction was needed here) and
// an IDENTICAL notFound() for every failure (missing project / module off /
// bad token), so the link can't be used to probe which project ids exist.
// Never cached, never indexed.
//
// All rendering (transparent doc, goal widget, brand screen, polling script)
// lives in lib/overlay/render.ts — this route is just lookup + auth + headers.
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const url = new URL(req.url);
  const token = url.searchParams.get("t");
  if (!id || !token) return notFound();

  const row = await loadOverlayRow(id);
  if (!row) return notFound();

  const overlay = row.data.settings?.overlay;
  if (!overlay?.enabled) return notFound();
  if (!previewTokenMatches(overlay.token, token)) return notFound();

  const html = renderOverlayHtml({
    goal: overlay.goal ?? null,
    screen: overlay.screen ?? null,
    projectHtml: row.data.html ?? "",
    stateUrl: `/api/ov/${encodeURIComponent(id)}/state?t=${encodeURIComponent(token)}`,
    title: row.title,
  });

  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-robots-tag": "noindex",
      "cache-control": "no-store",
    },
  });
}

// ── helpers ──────────────────────────────────────────────────────────────────

async function loadOverlayRow(
  id: string,
): Promise<{ title: string; data: ProjectData } | null> {
  const rows = await db
    .select({ title: schema.projects.title, data: schema.projects.data })
    .from(schema.projects)
    .where(eq(schema.projects.id, id))
    .limit(1);
  return rows[0] ?? null;
}

function notFound(): Response {
  return new Response(NOT_FOUND_HTML, {
    status: 404,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
    },
  });
}

const NOT_FOUND_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Overlay unavailable</title><style>html{font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;background:#0b0b0c;color:#e7e7ea;height:100%}body{margin:0;display:grid;place-items:center;height:100%}.c{text-align:center;padding:2rem;max-width:28rem}h1{font-size:1.05rem;font-weight:600;margin:0 0 .4rem}p{margin:0;color:#9a9aa2;font-size:.9rem;line-height:1.5}</style></head><body><div class="c"><h1>This overlay link isn't available</h1><p>It may have been turned off, or the link may be wrong.</p></div></body></html>`;
