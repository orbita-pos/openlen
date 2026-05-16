import { z } from "zod";
import { auth } from "@/auth";
import { regenerateSection } from "@/lib/orchestrator/regenerate-section";
import {
  CopySchema,
  GeneratedImageSchema,
  PlanSchema,
} from "@/lib/orchestrator/types";
import { getProject, updateProjectPage } from "@/lib/projects";

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
  // Optional — when present, the updated page is persisted back to this
  // project. Ownership is verified server-side via the session.
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

  try {
    const result = await regenerateSection(parsed.data);

    // Persist back to the project when caller supplied a projectId and is
    // the owner. Silently skip on ownership mismatch — the regen still
    // returns to the client either way.
    if (parsed.data.projectId) {
      const session = await auth();
      const userId = session?.user?.id;
      if (userId) {
        const project = await getProject(parsed.data.projectId, userId);
        if (project) {
          const merged = {
            ...project.data,
            html: result.html,
            css: result.css,
            copy: result.copy,
            cost: addBreakdowns(project.data.cost, result.cost),
          };
          await updateProjectPage(parsed.data.projectId, userId, merged);
        }
      }
    }

    return json(result, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, 500);
  }
}

function addBreakdowns(
  a: { total: number; classify: number; plan: number; copy: number; html: number; images: number; refine: number },
  b: { total: number; classify: number; plan: number; copy: number; html: number; images: number; refine: number },
) {
  return {
    total: a.total + b.total,
    classify: a.classify + b.classify,
    plan: a.plan + b.plan,
    copy: a.copy + b.copy,
    html: a.html + b.html,
    images: a.images + b.images,
    refine: a.refine + b.refine,
  };
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
