// POST /api/projects/[id]/ab/[expId]/decide — atomic owner decision:
//   promote_b | keep_a | extend | cancel
// Accessible from both Web and Mobile (`paraLaApp` + `usuarioDeLaPeticion`).
import { z } from "zod";

import {
  AbLifecycleError,
  cancelAbDraft,
  extendExperiment,
  keepControlA,
  promoteVariantB,
} from "@/lib/ab/lifecycle";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { usuarioDeLaPeticion } from "@/lib/movil/quien";
import { exigirAcceso } from "@/lib/projects/acceso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DecideBodySchema = z.object({
  action: z.enum(["promote_b", "keep_a", "extend", "cancel"]),
  locale: z.string().min(2).max(10).optional(),
  extraDays: z.number().int().min(1).max(14).optional(),
});

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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const parsed = DecideBodySchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: "invalid", message: parsed.error.issues[0]?.message ?? "Invalid input" }, 400);
  }

  try {
    if (parsed.data.action === "promote_b") {
      const result = await promoteVariantB({
        projectId: id,
        experimentId: expId,
        ownerId: acceso.duenoId,
        actorId: userId,
        locale: parsed.data.locale,
      });
      return json({ ok: true, ...result }, 200);
    }
    if (parsed.data.action === "keep_a") {
      const experiment = await keepControlA({
        projectId: id,
        experimentId: expId,
        ownerId: acceso.duenoId,
        actorId: userId,
      });
      return json({ ok: true, experiment }, 200);
    }
    if (parsed.data.action === "extend") {
      const experiment = await extendExperiment({
        projectId: id,
        experimentId: expId,
        actorId: userId,
        extraDays: parsed.data.extraDays,
      });
      return json({ ok: true, experiment }, 200);
    }
    const experiment = await cancelAbDraft({ projectId: id, experimentId: expId });
    return json({ ok: true, experiment }, 200);
  } catch (err) {
    if (err instanceof AbLifecycleError) {
      return json({ error: err.code, message: err.message, ...(err.extra ?? {}) }, err.status);
    }
    return json({ error: "decision_failed" }, 500);
  }
});

export const OPTIONS = respuestaPrevia;
