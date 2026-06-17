import { requireAdmin } from "@/lib/auth/admin-only";
import {
  archiveTemplate,
  getTemplate,
  upsertTemplate,
} from "@/lib/templates/store";
import {
  UpdateSchema,
  htmlContainsEditorMarker,
} from "@/lib/templates/admin-schemas";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// PUT /api/admin/templates/[id] — partial update. id from URL, body fields
// optional. html omitted = keep current. status accepts draft/published/
// archived so this also covers publish/unpublish transitions.
export async function PUT(
  req: Request,
  context: RouteContext,
): Promise<Response> {
  const guard = await requireAdmin();
  if (guard instanceof Response) return guard;

  const { id } = await context.params;
  const existing = await getTemplate(id);
  if (!existing) return json({ error: "not_found", id }, 404);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      { error: "invalid_body", issues: parsed.error.flatten() },
      400,
    );
  }

  const hasMarker =
    (parsed.data.html != null && htmlContainsEditorMarker(parsed.data.html)) ||
    (parsed.data.pages ?? []).some((p) => htmlContainsEditorMarker(p.html));
  if (hasMarker) {
    return json(
      {
        error: "invalid_html",
        reason: "html contains data-slot-path marker (editor-mode leak)",
      },
      400,
    );
  }

  // Merge new fields over existing. upsertTemplate() needs html — if the
  // caller didn't send one, re-use the current body so the storage write
  // is a no-op (same hash → same key → idempotent overwrite).
  const html = parsed.data.html ?? null;
  let bodyHtml: string;
  if (html !== null) {
    bodyHtml = html;
  } else {
    const res = await fetch(existing.storageUrl, { cache: "no-store" });
    if (!res.ok) {
      return json({ error: "existing_html_unavailable" }, 500);
    }
    bodyHtml = await res.text();
  }

  const record = await upsertTemplate({
    id: existing.id,
    name: parsed.data.name ?? existing.name,
    family: parsed.data.family ?? existing.family,
    accent: parsed.data.accent ?? existing.accent,
    pitch: parsed.data.pitch ?? existing.pitch,
    description: parsed.data.description ?? existing.description,
    mode: parsed.data.mode ?? existing.mode,
    html: bodyHtml,
    // Preserve subpages unless the caller explicitly sends a new set —
    // upsert always writes the pages column, so a partial update without
    // this would wipe a multi-page template down to its home.
    pages: parsed.data.pages ?? existing.pages,
    status: parsed.data.status ?? existing.status,
  });

  return json({
    id: record.id,
    storageUrl: record.storageUrl,
    contentHash: record.contentHash,
    status: record.status,
  });
}

// DELETE /api/admin/templates/[id] — soft-delete. Flips status to
// 'archived' so the row stops appearing in the public gallery but the
// HTML in storage is left intact (orphan GC can clean it up later).
export async function DELETE(
  _req: Request,
  context: RouteContext,
): Promise<Response> {
  const guard = await requireAdmin();
  if (guard instanceof Response) return guard;

  const { id } = await context.params;
  const existing = await getTemplate(id);
  if (!existing) return json({ error: "not_found", id }, 404);

  await archiveTemplate(id);
  return json({ id, status: "archived" });
}

function json(body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
