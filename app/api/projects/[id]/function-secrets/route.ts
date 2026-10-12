import { z } from "zod";

import { auth } from "@/auth";
import { setFunctionSecrets, unsetFunctionSecrets } from "@/lib/functions/secrets-core";
import { realSecretsDeps } from "@/lib/functions/secrets-real";
import { exigirAcceso } from "@/lib/projects/acceso";

// ─────────────────────────────────────────────────────────────────────────────
// /api/projects/[id]/function-secrets — LOS SECRETOS DE LAS EDGE FUNCTIONS
// (spec local 2026-10-11, Parte 4). Aquí escriben la tarjeta de Len
// (`request_secrets`), «Guardar como secreto» del compositor y los que faltan
// al publicar.
//
//   GET    (ver)    → por entorno, nombre, huella y fecha; el lector, sólo nombres.
//   POST   (editar) → guarda (dueño y editor, borrador y producción) y los lleva
//                     al motor al momento.
//   DELETE (editar) → quita.
//
// 🔴 LOS VALORES NO SE DEVUELVEN NUNCA: ni a Len, ni a la interfaz, ni al dueño.
// Sin motor de funciones en este servidor: GET dice `available: false` y lo
// demás, 503.
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Entorno = z.enum(["draft", "live"]);
const SetBody = z.object({
  secrets: z.array(z.object({ environment: Entorno, name: z.string().min(1).max(256), value: z.string().min(1) })).min(1).max(20),
});
const UnsetBody = z.object({ environment: Entorno, names: z.array(z.string().min(1).max(256)).min(1).max(50) });

type Ctx = { params: Promise<{ id: string }> };

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export async function GET(_req: Request, { params }: Ctx): Promise<Response> {
  const userId = (await auth())?.user?.id;
  if (!userId) return json({ error: "unauthorized" }, 401);
  const { id } = await params;
  const acceso = await exigirAcceso(id, userId, "ver");
  if (acceso instanceof Response) return acceso;
  const deps = realSecretsDeps();
  if (!deps) return json({ available: false, draft: [], live: [] }, 200);
  const filas = await deps.store.list(id);
  const conHuella = acceso.rol !== "lector";
  const de = (env: "draft" | "live") =>
    filas
      .filter((f) => f.environment === env)
      .map((f) => (conHuella ? { name: f.name, digest: f.digest, updatedAt: f.updatedAt.toISOString() } : { name: f.name }));
  return json({ available: true, draft: de("draft"), live: de("live") }, 200);
}

export async function POST(req: Request, { params }: Ctx): Promise<Response> {
  const userId = (await auth())?.user?.id;
  if (!userId) return json({ error: "unauthorized" }, 401);
  const { id } = await params;
  const acceso = await exigirAcceso(id, userId, "editar");
  if (acceso instanceof Response) return acceso;
  const deps = realSecretsDeps();
  if (!deps) return json({ error: "functions_unavailable" }, 503);
  const body = SetBody.safeParse(await req.json().catch(() => null));
  if (!body.success) return json({ error: "invalid_body" }, 400);
  const r = await setFunctionSecrets(id, body.data.secrets, userId, deps);
  if (r.ok) return json({ ok: true, saved: r.saved }, 200);
  const { ok: _ok, ...error } = r;
  return json(error, r.error === "env_too_large" ? 422 : 400);
}

export async function DELETE(req: Request, { params }: Ctx): Promise<Response> {
  const userId = (await auth())?.user?.id;
  if (!userId) return json({ error: "unauthorized" }, 401);
  const { id } = await params;
  const acceso = await exigirAcceso(id, userId, "editar");
  if (acceso instanceof Response) return acceso;
  const deps = realSecretsDeps();
  if (!deps) return json({ error: "functions_unavailable" }, 503);
  const body = UnsetBody.safeParse(await req.json().catch(() => null));
  if (!body.success) return json({ error: "invalid_body" }, 400);
  return json({ ok: true, removed: await unsetFunctionSecrets(id, body.data.environment, body.data.names, deps) }, 200);
}
