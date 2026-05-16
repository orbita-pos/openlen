import { z } from "zod";
import { regenerateSection } from "@/lib/orchestrator/regenerate-section";
import {
  CopySchema,
  GeneratedImageSchema,
  PlanSchema,
} from "@/lib/orchestrator/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/regenerate-section
//
// Body: { brief, plan, copy, images, sectionId, additionalInstruction? }
// Returns: { html, css, copy, cost, generationId }
//
// Used by both the bare "Regenerate" overlay button (no instruction) and the
// "Edit prompt" modal (with instruction).
// ─────────────────────────────────────────────────────────────────────────────

const RequestSchema = z.object({
  brief: z.string().min(10).max(4000),
  plan: PlanSchema,
  copy: CopySchema,
  images: z.array(GeneratedImageSchema),
  sectionId: z.string().min(1),
  additionalInstruction: z.string().max(2000).optional(),
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

  try {
    const result = await regenerateSection(parsed.data);
    return json(result, 200);
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
