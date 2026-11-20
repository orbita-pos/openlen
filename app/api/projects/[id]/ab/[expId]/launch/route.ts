// POST /api/projects/[id]/ab/[expId]/launch — launch a draft A/B experiment 50/50
import { z } from "zod";

import { AbLifecycleError, launchAbExperiment } from "@/lib/ab/lifecycle";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { usuarioDeLaPeticion } from "@/lib/movil/quien";
import { exigirAcceso } from "@/lib/projects/acceso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LaunchBodySchema = z
  .object({
    locale: z.string().min(2).max(10).optional(),
    acceptSecurityFingerprint: z.string().regex(/^[0-9a-f]{64}$/).optional(),
    splitBps: z.number().int().min(1000).max(9000).optional(),
  })
  .optional();

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const POST = paraLaApp(async (
  req: Request,
  { params }: { params: Promise<{ id: string; expId: string }> },
): Promise<Response> => {
  const userId = await usuarioDeLaPeticion(req);
  if (!userId) return json({ error: "unauthorized" }, 401);
  const { id, expId } = await params;
  const acceso = await exigirAcceso(id, userId, "editar");
  if (acceso instanceof Response) return acceso;

  let rawBody: unknown = undefined;
  try {
    const text = await req.text();
    if (text.trim()) rawBody = JSON.parse(text);
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const parsed = LaunchBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return json({ error: "invalid", message: parsed.error.issues[0]?.message ?? "Invalid input" }, 400);
  }

  try {
    const experiment = await launchAbExperiment({
      projectId: id,
      experimentId: expId,
      ownerId: acceso.duenoId,
      actorId: userId,
      locale: parsed.data?.locale,
      acceptSecurityFingerprint: parsed.data?.acceptSecurityFingerprint,
      splitBps: parsed.data?.splitBps,
    });
    return json({ experiment }, 200);
  } catch (err) {
    if (err instanceof AbLifecycleError) {
      return json({ error: err.code, message: err.message, ...(err.extra ?? {}) }, err.status);
    }
    return json({ error: "launch_failed" }, 500);
  }
});

export const OPTIONS = respuestaPrevia;
