import { z } from "zod";
import { auth } from "@/auth";
import { renderDeterministic } from "@/lib/orchestrator/assemble";
import {
  FilledBlockSchema,
  GeneratedImageSchema,
  IntentSchema,
  PlanSchema,
} from "@/lib/orchestrator/types";
import { updateProjectSlots } from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/reassemble
//
// Body: { plan, filledBlocks, images, intent, editorMode?, projectId? }
// Returns: { html, editorHtml?, css }
//
// Deterministic re-rendering of the page from updated slot JSON. Called by
// the sidebar slot editor and the inline iframe editor on every (debounced)
// edit. No LLM, no witness record. Cost: $0, latency: ~50ms.
//
// When `projectId` is supplied, the route also writes the new filledBlocks +
// clean html into projects.data so a hard reload (and the publish flow,
// which reads project.data.html) sees the user's edits. Session 13 closed
// the gap where sidebar/iframe edits were only updating the iframe srcDoc
// and never landing in Neon.
//
// Auth is enforced (same surface area as /api/regenerate-section) but no
// quota is consumed: the operation is free and we don't want a typing user
// to chew through their generation budget.
// ─────────────────────────────────────────────────────────────────────────────

const RequestSchema = z.object({
  intent: IntentSchema,
  plan: PlanSchema,
  filledBlocks: z.array(FilledBlockSchema),
  images: z.array(GeneratedImageSchema).default([]),
  // Session 12 — when true, the response includes `editorHtml` with
  // `data-slot-path` + `contenteditable` markup for the workspace iframe.
  // The `html` field is ALWAYS the clean version (publish/zip safe).
  editorMode: z.boolean().optional(),
  // Session 13 — when present, the route persists the new filledBlocks +
  // clean html back to projects.data. Ownership is enforced inside
  // updateProjectSlots; a foreign or non-existent id silently no-ops so
  // the reassemble response itself isn't penalized. The workspace passes
  // this on every sidebar/iframe edit so the published page can be
  // re-deployed with the latest copy. publishedHtml stays as the last
  // publish snapshot — its drift against data.html drives the
  // "unpublished changes" indicator.
  projectId: z.string().optional(),
});

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: `Invalid request: ${parsed.error.message}` }, 400);
  }

  const session = await auth();
  if (!session?.user?.id) {
    return json({ error: "unauthorized" }, 401);
  }

  try {
    const renderInput = {
      paletteName: parsed.data.plan.palette,
      filledBlocks: parsed.data.filledBlocks,
      images: parsed.data.images,
      intent: parsed.data.intent,
      plan: parsed.data.plan,
    };
    const { html } = renderDeterministic(renderInput);
    // Editor-mode HTML is computed on demand only when the workspace asks
    // for it. The clean `html` field above is the publish/zip-safe one and
    // never carries `data-slot-path`.
    const editorHtml = parsed.data.editorMode
      ? renderDeterministic(renderInput, { editorMode: true }).html
      : undefined;

    // Session 13 — persist the freshly rendered slots so a hard-reload
    // (or a subsequent /api/projects/[id]/publish) sees the user's edits.
    // We persist the CLEAN html, never editorHtml — filesystem.ts has a
    // defense-in-depth assertion that rejects any html containing
    // `data-slot-path=`, and data.html is the canonical publish source.
    if (parsed.data.projectId) {
      await updateProjectSlots(
        parsed.data.projectId,
        session.user.id,
        parsed.data.filledBlocks,
        html,
      ).catch((err) => {
        // Logging-only: the render succeeded and the client already has the
        // new html optimistically. A persist failure means the next hard-
        // reload will show stale state — surface it for ops but don't 500
        // the reassemble.
        // eslint-disable-next-line no-console
        console.error("[reassemble] updateProjectSlots failed:", err);
      });
    }

    return json({ html, editorHtml, css: "" }, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, 500);
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
