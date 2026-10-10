// El backend de un proyecto, para su DUEÑO (las rutas del panel,
// app/api/projects/[id]/backend/**). 401 sin sesión y 404 si el proyecto no es
// tuyo, el mismo par que las demás rutas de proyecto.

import "server-only";
import { and, eq } from "drizzle-orm";

import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { backendConfigured } from "./pg";
import { getEnvironment, type Environment } from "./environments";
import { adoptLegacyEnvironment, backendProjectFor, getBackendByProject, hasLiveEnvironment, projectUrl } from "./registry";
import type { BackendProject } from "./router";

export type OwnedBackend =
  | { readonly kind: "unauthorized" }
  | { readonly kind: "not_found" }
  /** Este servidor no tiene el clúster de las páginas. */
  | { readonly kind: "unavailable" }
  /** El proyecto todavía no tiene backend: se crea cuando Len lo usa. */
  | { readonly kind: "none" }
  /** Tiene registro pero aún no su base: nadie le ha pedido nada. */
  | { readonly kind: "empty"; readonly url: string; readonly environment: Environment }
  | { readonly kind: "ready"; readonly url: string; readonly environment: Environment; readonly project: BackendProject };

/** El backend del proyecto en un entorno (spec local 2026-10-09). Sin pedir
 *  ninguno: producción si ya existe, si no el borrador. */
export async function ownedBackend(projectId: string, wanted?: Environment): Promise<OwnedBackend> {
  const session = await auth();
  if (!session?.user?.id) return { kind: "unauthorized" };
  const [owned] = await db
    .select({ subdomain: schema.projects.subdomain })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, session.user.id)))
    .limit(1);
  if (!owned) return { kind: "not_found" };
  if (!backendConfigured()) return { kind: "unavailable" };
  const record = await getBackendByProject(projectId);
  if (!record) return { kind: "none" };
  const url = projectUrl(record.ref);
  await adoptLegacyEnvironment(record);
  const environment = wanted ?? ((await hasLiveEnvironment(record)) ? "live" : "draft");
  const e = await getEnvironment(projectId, environment);
  if (!e?.provisionedAt) return { kind: "empty", url, environment };
  return { kind: "ready", url, environment, project: backendProjectFor({ record, pageSub: owned.subdomain ?? null }, e) };
}

/** `?env=draft|live` del panel (spec local 2026-10-09); sin él, el de por
 *  defecto (reales si hay). */
export function environmentFromRequest(req: Request): Environment | undefined {
  const v = new URL(req.url).searchParams.get("env");
  return v === "draft" || v === "live" ? v : undefined;
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** La respuesta de un backend que NO está listo. */
export function notReady(ob: Exclude<OwnedBackend, { kind: "ready" }>): Response {
  if (ob.kind === "unauthorized") return json({ error: "unauthorized" }, 401);
  if (ob.kind === "not_found") return json({ error: "not_found" }, 404);
  return json({ error: "backend_not_ready", status: ob.kind }, 409);
}

/** El nombre de la tabla de la URL. */
export function tableParam(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** El cuerpo JSON como objeto, o `null`. */
export async function objectBody(req: Request): Promise<Record<string, unknown> | null> {
  const b = (await req.json().catch(() => null)) as unknown;
  return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : null;
}
