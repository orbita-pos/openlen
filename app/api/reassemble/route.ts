import { z } from "zod";
import { auth } from "@/auth";
import { renderDeterministic } from "@/lib/orchestrator/assemble";
import {
  FilledBlockSchema,
  GeneratedImageSchema,
  IntentSchema,
  PlanSchema,
} from "@/lib/orchestrator/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/reassemble
//
// Body: { plan, filledBlocks, images, intent }
// Returns: { html, css }
//
// Deterministic re-rendering of the page from updated slot JSON. Called by
// the sidebar slot editor on every (debounced) edit. No LLM, no witness
// record, no project persistence — this is read-only against the orchestrator
// pipeline. Cost: $0, latency: ~50ms.
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
    const { html } = renderDeterministic({
      paletteName: parsed.data.plan.palette,
      filledBlocks: parsed.data.filledBlocks,
      images: parsed.data.images,
      intent: parsed.data.intent,
      plan: parsed.data.plan,
    });
    return json({ html, css: "" }, 200);
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
