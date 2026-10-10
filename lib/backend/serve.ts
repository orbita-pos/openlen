// La entrada de Next para /rest/v1 y /auth/v1 (app/rest/v1, app/auth/v1):
// del host al proyecto, la base creada si aún no lo está, y el enrutador.

import "server-only";

import { backendConfigured } from "./pg";
import { backendForHost, backendProjectFor, ensureEnvironmentReady, hasLiveEnvironment } from "./registry";
import { handleBackendRequest } from "./router";

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" },
  });
}

export async function serveBackend(req: Request): Promise<Response> {
  if (!backendConfigured()) {
    // Sin clúster configurado, se dice: no se finge un backend.
    return json({ message: "The backend is not available on this server", hint: "PAGES_DATABASE_URL is not configured." }, 503);
  }
  const hb = await backendForHost(req.headers.get("host"));
  // Lo que contesta la pasarela de Supabase a una ruta que no existe.
  if (!hb) return json({ message: "no Route matched with those values" }, 404);
  let env;
  try {
    env = await ensureEnvironmentReady(hb.record, (await hasLiveEnvironment(hb.record)) ? "live" : "draft");
  } catch (err) {
    console.error("[backend] no se pudo crear la base del proyecto", hb.record.ref, err);
    return json({ message: "The project database is not ready yet. Try again in a moment." }, 503);
  }
  return handleBackendRequest(req, backendProjectFor(hb, env));
}
