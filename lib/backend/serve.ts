// La entrada de Next para /rest/v1, /auth/v1 y /storage/v1 (app/rest/v1,
// app/auth/v1, app/storage/v1): del host al proyecto, del Origin al ENTORNO
// (borrador o producción, spec local 2026-10-09), la base creada si aún no lo
// está, y el enrutador.

import "server-only";

import { etiquetaDeLienzo } from "@/lib/lienzo/host";

import { decideEnvironment, isPublicObjectRead } from "./environment-routing";
import { getEnvironment, type Environment } from "./environments";
import { backendConfigured } from "./pg";
import { backendForHost, backendProjectFor, ensureEnvironmentReady, hasLiveEnvironment, type HostBackend } from "./registry";
import { handleBackendRequest } from "./router";

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" },
  });
}

async function serveIn(req: Request, hb: HostBackend, env: Environment): Promise<Response> {
  let e;
  try {
    e = await ensureEnvironmentReady(hb.record, env);
  } catch (err) {
    console.error("[backend] no se pudo crear la base del proyecto", hb.record.ref, env, err);
    return json({ message: "The project database is not ready yet. Try again in a moment." }, 503);
  }
  return handleBackendRequest(req, backendProjectFor(hb, e));
}

export async function serveBackend(req: Request): Promise<Response> {
  if (!backendConfigured()) {
    // Sin clúster configurado, se dice: no se finge un backend.
    return json({ message: "The backend is not available on this server", hint: "PAGES_DATABASE_URL is not configured." }, 503);
  }
  const hb = await backendForHost(req.headers.get("host"));
  // Lo que contesta la pasarela de Supabase a una ruta que no existe.
  if (!hb) return json({ message: "no Route matched with those values" }, 404);
  const decision = decideEnvironment({
    origin: req.headers.get("origin"),
    referer: req.headers.get("referer"),
    lienzoLabel: etiquetaDeLienzo(hb.record.projectId),
    hasLive: await hasLiveEnvironment(hb.record),
  });
  if (decision.kind === "forbidden") return json({ message: decision.message }, 403);
  const res = await serveIn(req, hb, decision.environment);
  // Un `<img>` del lienzo no dice de dónde viene (sin Origin, y el lienzo
  // sirve con `no-referrer`): lo que no está en producción se busca en el
  // borrador. Sólo lecturas PÚBLICAS: ya son de cualquiera.
  if (decision.environment === "live" && !decision.attributed && isPublicObjectRead(req) && (res.status === 400 || res.status === 404)) {
    const draft = await getEnvironment(hb.record.projectId, "draft");
    if (draft?.provisionedAt) return serveIn(req, hb, "draft");
  }
  return res;
}
