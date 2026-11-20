// GET  /api/projects/[id]/ab  — list A/B experiments (with live metrics on running ones)
// POST /api/projects/[id]/ab  — create an isolated A/B draft experiment + worktree
import { z } from "zod";

import { abTestingEnabled } from "@/lib/ab/enabled";
import { AbLifecycleError, createAbDraft } from "@/lib/ab/lifecycle";
import { computeExperimentMetrics } from "@/lib/ab/metrics";
import {
  listExperimentsForProject,
  toExperimentView,
  updateExperiment,
} from "@/lib/ab/store";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { usuarioDeLaPeticion } from "@/lib/movil/quien";
import { exigirAcceso } from "@/lib/projects/acceso";

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

export const GET = paraLaApp(async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> => {
  const userId = await usuarioDeLaPeticion(req);
  if (!userId) return json({ error: "unauthorized" }, 401);
  const { id } = await params;
  const acceso = await exigirAcceso(id, userId, "ver");
  if (acceso instanceof Response) return acceso;

  if (!abTestingEnabled()) {
    return json({ enabled: false, active: null, experiments: [] }, 200);
  }

  const rows = await listExperimentsForProject(id, 20);
  const now = new Date();
  const views = await Promise.all(
    rows.map(async (row) => {
      if (row.status === "running" && row.startedAt) {
        try {
          const metrics = await computeExperimentMetrics(
            {
              experimentId: row.id,
              projectId: row.projectId,
              primaryMetric: row.primaryMetric,
              splitBps: row.splitBps,
              startedAt: row.startedAt,
              endedAt: row.endedAt,
            },
            now,
          );
          await updateExperiment(row.id, { metricsSnapshot: metrics, evaluatedAt: now }).catch(
            () => undefined,
          );
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
});

export const POST = paraLaApp(async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> => {
  const userId = await usuarioDeLaPeticion(req);
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
});

export const OPTIONS = respuestaPrevia;
