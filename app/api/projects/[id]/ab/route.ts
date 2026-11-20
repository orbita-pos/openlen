// GET  /api/projects/[id]/ab  — list A/B experiments (with live metrics on running ones)
// POST /api/projects/[id]/ab  — create an isolated A/B draft experiment + worktree
import { z } from "zod";

import { abTestingEnabled } from "@/lib/ab/enabled";
import { AbLifecycleError, createAbDraft } from "@/lib/ab/lifecycle";
import { computeExperimentMetrics, metricsInputOf } from "@/lib/ab/metrics";
import { isSnapshotFresh } from "@/lib/ab/snapshot";
import {
  listExperimentsForProject,
  saveEvaluation,
  toExperimentView,
} from "@/lib/ab/store";
import { auth } from "@/auth";
import { exigirAcceso, puede } from "@/lib/projects/acceso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CreateBodySchema = z.object({
  name: z.string().min(1).max(120),
  hypothesis: z.string().max(500).optional(),
  targetPath: z.string().max(120).optional(),
  primaryMetric: z.enum(["conversion_any", "form_submit", "cta_click"]).optional(),
  includeLocales: z.boolean().optional(),
  splitBps: z.number().int().min(1000).max(9000).optional(),
});

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Web session only (review item 27): the phone doesn't call this route, so it doesn't take the phone's key and has no CORS.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const userId = (await auth())?.user?.id;
  if (!userId) return json({ error: "unauthorized" }, 401);
  const { id } = await params;
  const acceso = await exigirAcceso(id, userId, "ver");
  if (acceso instanceof Response) return acceso;

  if (!abTestingEnabled()) {
    return json({ enabled: false, active: null, experiments: [] }, 200);
  }

  const rows = await listExperimentsForProject(id, 20);
  const now = new Date();
  // What the visitors did is the owner's and an editor's (lib/projects/acceso.ts: results are theirs): a reader gets the
  // list of tests and no numbers (review item 28).
  const seesVisitorData = puede(acceso.rol, "editar");
  const views = await Promise.all(
    rows.map(async (row) => {
      if (!seesVisitorData) return toExperimentView({ ...row, metricsSnapshot: null });
      // The evaluator snapshots every 30 minutes; a request recomputes (four aggregations) and writes only when what is
      // stored is older than five. The write is the evaluator's compare-and-swap: it never overwrites a decision.
      if (row.status === "running" && row.startedAt && !isSnapshotFresh(row, now)) {
        try {
          const metrics = await computeExperimentMetrics(metricsInputOf({ ...row, startedAt: row.startedAt }), now);
          await saveEvaluation(row.id, { metricsSnapshot: metrics, evaluatedAt: now }).catch(() => false);
          return toExperimentView({ ...row, metricsSnapshot: metrics, evaluatedAt: now });
        } catch {
          return toExperimentView(row);
        }
      }
      return toExperimentView(row);
    }),
  );

  const active =
    views.find(
      (v) =>
        v.status === "draft" ||
        v.status === "running" ||
        v.status === "winner_ready" ||
        v.status === "inconclusive",
    ) ?? null;

  return json({ enabled: true, active, experiments: views }, 200);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const userId = (await auth())?.user?.id;
  if (!userId) return json({ error: "unauthorized" }, 401);
  const { id } = await params;
  const acceso = await exigirAcceso(id, userId, "editar");
  if (acceso instanceof Response) return acceso;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const parsed = CreateBodySchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: "invalid", message: parsed.error.issues[0]?.message ?? "Invalid input" }, 400);
  }

  try {
    const experiment = await createAbDraft({
      projectId: id,
      ownerId: acceso.duenoId,
      actorId: userId,
      ...parsed.data,
    });
    return json({ experiment }, 201);
  } catch (err) {
    if (err instanceof AbLifecycleError) {
      return json({ error: err.code, message: err.message, ...(err.extra ?? {}) }, err.status);
    }
    return json({ error: "internal_error" }, 500);
  }
}
