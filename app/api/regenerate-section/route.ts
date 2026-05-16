import { z } from "zod";
import { auth } from "@/auth";
import { regenerateBlock } from "@/lib/orchestrator/regenerate-section";
import {
  FilledBlockSchema,
  GeneratedImageSchema,
  IntentSchema,
  PlanSchema,
} from "@/lib/orchestrator/types";
import { getProject, updateProjectPage } from "@/lib/projects";
import {
  PLAN_LIMITS,
  checkAndConsume,
  getUserPlan,
  userLimitKey,
} from "@/lib/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/regenerate-section
//
// Body: { brief, intent, plan, filledBlocks, images, blockIndex, additionalInstruction? }
// Returns: { page, cost, generationId }
//
// Used by both the bare "Regenerate" overlay button (no instruction) and the
// "Edit prompt" modal (with instruction). The iframe overlay's data-section-id
// is a "block-N" string the client parses into the numeric blockIndex passed
// here.
// ─────────────────────────────────────────────────────────────────────────────

const RequestSchema = z.object({
  brief: z.string().min(10).max(4000),
  intent: IntentSchema,
  plan: PlanSchema,
  filledBlocks: z.array(FilledBlockSchema),
  images: z.array(GeneratedImageSchema),
  blockIndex: z.number().int().nonnegative(),
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

  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return json({ error: "unauthorized" }, 401);
  }

  // Regen has its own (more generous) bucket so a flurry of small edits
  // doesn't immediately exhaust the monthly generate quota.
  const plan = await getUserPlan(userId);
  const decision = await checkAndConsume(
    userLimitKey(userId, "regen"),
    PLAN_LIMITS[plan].regen,
  );
  if (!decision.ok && decision.blocked) {
    return new Response(
      JSON.stringify({
        error: "quota_exceeded",
        scope: decision.blocked.label,
        plan,
        max: decision.blocked.max,
        windowMs: decision.blocked.windowMs,
        resetAt: decision.resetAt?.toISOString(),
      }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(
            Math.max(1, Math.ceil(((decision.resetAt?.getTime() ?? Date.now() + 60000) - Date.now()) / 1000)),
          ),
        },
      },
    );
  }

  try {
    const result = await regenerateBlock(parsed.data);

    // Persist back to the project when caller supplied a projectId and
    // owns it. The session was already loaded above for the quota check.
    if (parsed.data.projectId) {
      const project = await getProject(parsed.data.projectId, userId);
      if (project) {
        const merged = {
          ...result.page,
          cost: addBreakdowns(project.data.cost, result.cost),
        };
        await updateProjectPage(parsed.data.projectId, userId, merged);
      }
    }

    return json(result, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, 500);
  }
}

function addBreakdowns(
  a: { total: number; classify: number; plan: number; fill: number; images: number; assemble: number; gates: number },
  b: { total: number; classify: number; plan: number; fill: number; images: number; assemble: number; gates: number },
) {
  return {
    total: a.total + b.total,
    classify: a.classify + b.classify,
    plan: a.plan + b.plan,
    fill: a.fill + b.fill,
    images: a.images + b.images,
    assemble: a.assemble + b.assemble,
    gates: a.gates + b.gates,
  };
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
