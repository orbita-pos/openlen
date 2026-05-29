import { and, desc, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import type { ProjectData } from "@/lib/projects/types";
import { createVersion } from "@/lib/projects/versions";
import { detectSlotPath } from "@/lib/html-engine";

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/projects/[id]/html — overwrite `data.html` for a project.
//
// Used by the Design panel on flat (template-clone / paste) projects to
// persist token swaps (accent color, fonts) without going through the
// orchestrator. The handler only swaps `html` inside the JSONB envelope;
// everything else in `data` (meta, plan, cost, …) is preserved verbatim.
//
// `hasUnpublishedChanges` is computed at read time in lib/projects.ts by
// comparing `data.html` to `publishedHtml`, so no work to do here beyond
// updating html + the row's updatedAt.
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";

const MAX_HTML_BYTES = 8 * 1024 * 1024;
// Idle-based checkpoint cadence for inline content edits — if it's been
// at least this long since the project's most-recent version of any kind,
// the next PATCH writes a "manual" snapshot so the user has natural undo
// points across long editing sessions. Short bursts of edits share a
// single snapshot; sustained editing produces one checkpoint per window.
const IDLE_CHECKPOINT_MS = 5 * 60 * 1000;

interface PatchBody {
  html?: string;
  /** Distinguishes inline-text edits (default — idle-checkpointed) from
   *  structural mutations (reorder, replace) which always snapshot so the
   *  version timeline shows them distinctly. Anything unrecognized is
   *  treated as inline-edit. */
  source?: "inline-edit" | "reorder" | "replace" | "props" | "section-insert";
  /** ms-epoch of the project's updatedAt this tab last wrote. When it no
   *  longer matches, another writer (typically a second browser tab) changed
   *  data.html since — the current HTML is about to be clobbered, so we
   *  snapshot it into the version history first. Inline-edit autosaves are
   *  only idle-checkpointed every few minutes, so without this a two-tab
   *  edit race could drop text that lives in no version. */
  baseUpdatedAt?: number;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id } = await params;

  const body = (await req.json().catch(() => null)) as PatchBody | null;
  if (!body || typeof body.html !== "string") {
    return json(
      { error: "invalid_body", message: "html string is required" },
      400,
    );
  }
  const html = body.html;
  if (Buffer.byteLength(html, "utf8") > MAX_HTML_BYTES) {
    return json(
      { error: "too_large", message: "HTML must be under 8 MB" },
      413,
    );
  }
  if (detectSlotPath(html)) {
    return json(
      {
        error: "invalid_html",
        message:
          "HTML contains editor-mode markers (data-slot-path). Save the rendered output instead.",
      },
      400,
    );
  }

  const rows = await db
    .select({
      data: schema.projects.data,
      updatedAt: schema.projects.updatedAt,
    })
    .from(schema.projects)
    .where(
      and(
        eq(schema.projects.id, id),
        eq(schema.projects.userId, session.user.id),
      ),
    )
    .limit(1);
  const existing = rows[0];
  if (!existing) return json({ error: "not_found" }, 404);

  // Concurrency guard. If another writer changed data.html since the client
  // loaded its base, the current HTML is about to be clobbered — snapshot it
  // into the version history first so the about-to-be-lost state stays
  // recoverable. createVersion dedups against the latest version, so the
  // common no-conflict first save (base 0) costs nothing. Soft — never
  // blocks the save.
  if (
    typeof body.baseUpdatedAt === "number" &&
    existing.updatedAt.getTime() !== body.baseUpdatedAt
  ) {
    const staleHtml = existing.data?.html ?? "";
    if (staleHtml && staleHtml !== html) {
      try {
        await createVersion({
          projectId: id,
          html: staleHtml,
          label: "Saved before a concurrent edit",
          source: "manual",
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[projects/html] conflict snapshot failed", err);
      }
    }
  }

  // Preserve everything else in `data` (notably data.settings — the Phase 2
  // form config) — only `html` is being replaced here.
  const nextData: ProjectData = { ...existing.data, html };
  const now = new Date();

  try {
    await db
      .update(schema.projects)
      .set({ data: nextData, updatedAt: now })
      .where(
        and(
          eq(schema.projects.id, id),
          eq(schema.projects.userId, session.user.id),
        ),
      );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[projects/html] db update failed", err);
    return json({ error: "db_update_failed" }, 500);
  }

  try {
    if (body.source === "reorder") {
      // Reorders are structural — snapshot every time (createVersion's
      // own dedupe handles consecutive byte-identical posts).
      await createVersion({
        projectId: id,
        html,
        label: "Reordered sections",
        source: "reorder",
      });
    } else if (body.source === "replace") {
      // Asset replacements (icon / image swap) are intentional, distinct
      // actions — always snapshot.
      await createVersion({
        projectId: id,
        html,
        label: "Replaced asset",
        source: "replace",
      });
    } else if (body.source === "props") {
      // Inspector edits (link target, alt text, SEO) are discrete,
      // intentional actions — snapshot each as its own undo point.
      await createVersion({
        projectId: id,
        html,
        label: "Edited properties",
        source: "manual",
      });
    } else if (body.source === "section-insert") {
      // Inserting a library section is a discrete structural action —
      // snapshot it so the user has a clean undo point before/after.
      await createVersion({
        projectId: id,
        html,
        label: "Inserted section",
        source: "manual",
      });
    } else {
      // Inline-edit autosave: idle-checkpoint as before.
      const latest = await db
        .select({ createdAt: schema.projectVersions.createdAt })
        .from(schema.projectVersions)
        .where(eq(schema.projectVersions.projectId, id))
        .orderBy(desc(schema.projectVersions.createdAt))
        .limit(1);
      const lastAt = latest[0]?.createdAt;
      const elapsed = lastAt ? now.getTime() - lastAt.getTime() : Infinity;
      if (elapsed >= IDLE_CHECKPOINT_MS) {
        await createVersion({
          projectId: id,
          html,
          label: "Edited content",
          source: "manual",
        });
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[projects/html] version snapshot failed", err);
  }

  return json({ ok: true, updatedAt: now.toISOString() }, 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
