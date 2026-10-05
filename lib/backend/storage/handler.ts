// /storage/v1 — el servidor de Supabase Storage portado
// (plans/len-agente-2026/plan-2-5/d-storage.md). La puerta:
//
//   · SÓLO en el host del `ref` (`<ref>.openlen.app`). Al revés que /rest/v1,
//     nunca en el host de la página ni en sus dominios: un SVG o un HTML que
//     sube un visitante tendría el origen de la página.
//   · La clave, como la pasarela de Supabase (`apikey`), salvo las rutas que su
//     servidor deja abiertas (lo público y lo firmado: ./routes.ts las marca).
//   · El JWT de usuario, como su plugin `jwt` (src/http/plugins/jwt.ts): si no
//     vale, `AccessDenied` con el mensaje de `jose`.
//   · Lo que no existe, el 404 de su `setRestNotFoundHandler`.

import { errors as joseErrors, jwtVerify } from "jose";

import { hashSecretKey } from "../keys";
import type { ApiRole } from "../rest/handler";
import type { BackendProject } from "../router";
import type { BlobStore } from "./blob-store";
import { BUCKET_ROUTES } from "./buckets";
import { ERRORS, StorageError, storageErrorResponse } from "./errors";
import { OBJECT_ROUTES } from "./objects";
import { pageBlobStore } from "./r2-blob-store";
import { SIGNED_ROUTES } from "./signed";
import { storageLimits, type StorageLimits } from "./limits";

export interface StorageContext {
  readonly project: BackendProject;
  readonly store: BlobStore;
  readonly role: ApiRole;
  readonly claims: Record<string, unknown>;
  /** El JWT tal cual (va en `request.jwt`, como en Supabase). */
  readonly jwt: string;
  /** Su `request.isAuthenticated`: la petición trae una clave o un JWT que vale.
   *  Sin eso, una ruta abierta sólo enseña lo de los buckets públicos. */
  readonly authenticated: boolean;
  readonly limits: StorageLimits;
  readonly method: string;
  /** La ruta dentro de /storage/v1, sin la consulta. */
  readonly path: string;
}

export interface StorageRoute {
  readonly method: "GET" | "HEAD" | "POST" | "PUT" | "DELETE";
  readonly pattern: RegExp;
  /** Su servidor la atiende sin JWT (`allowInvalidJwt`): no pide `apikey`. */
  readonly open?: boolean;
  handle(req: Request, ctx: StorageContext, m: RegExpExecArray): Promise<Response>;
}

/** Las rutas de su servidor que cubrimos (buckets.ts, objects.ts, signed.ts). */
const routes: readonly StorageRoute[] = [...BUCKET_ROUTES, ...SIGNED_ROUTES, ...OBJECT_ROUTES];

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...headers } });
}

/** El cuerpo JSON de una petición (vacío = `{}`). */
export async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (!text) return {};
  try {
    const v = JSON.parse(text) as unknown;
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    // abajo
  }
  throw ERRORS.InvalidRequest("Body is not valid JSON");
}

function gatewayError(message: string, hint: string): Response {
  return json({ message, hint }, 401);
}

const API_ROLES: readonly ApiRole[] = ["anon", "authenticated", "service_role"];

/** El host de la petición es el del proyecto: `<ref>.<cualquier base>`. */
export function isProjectHost(req: Request, ref: string): boolean {
  const host = (req.headers.get("host") ?? new URL(req.url).host).toLowerCase().replace(/:\d+$/, "");
  return host.split(".")[0] === ref && host.includes(".");
}

type Resolved = { ok: true; role: ApiRole; claims: Record<string, unknown>; jwt: string; authenticated: boolean } | { ok: false; response: Response };

async function resolveStorageRole(req: Request, project: BackendProject, open: boolean): Promise<Resolved> {
  const url = new URL(req.url);
  const apikey = req.headers.get("apikey") ?? url.searchParams.get("apikey");
  let base: ApiRole = "anon";
  if (apikey) {
    if (apikey === project.publishableKey) base = "anon";
    else if (hashSecretKey(apikey) === project.secretKeyHash) base = "service_role";
    else return { ok: false, response: gatewayError("Invalid API key", "Double check your Supabase `anon` or `service_role` API key.") };
  } else if (!open) {
    return { ok: false, response: gatewayError("No API key found in request", "No `apikey` request header or url param was found.") };
  }

  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "")?.[1]?.trim() ?? "";
  if (!bearer || bearer === apikey) return { ok: true, role: base, claims: { role: base }, jwt: "", authenticated: Boolean(apikey) };
  try {
    const { payload } = await jwtVerify(bearer, new TextEncoder().encode(project.jwtSecret), { algorithms: ["HS256"] });
    const role = payload.role;
    if (typeof role !== "string" || !(API_ROLES as readonly string[]).includes(role)) {
      throw ERRORS.AccessDenied(`role "${String(role)}" does not exist`);
    }
    return { ok: true, role: role as ApiRole, claims: payload as Record<string, unknown>, jwt: bearer, authenticated: true };
  } catch (err) {
    // `allowInvalidJwt`: la ruta sigue como anon.
    if (open) return { ok: true, role: "anon", claims: { role: "anon" }, jwt: "", authenticated: false };
    if (err instanceof StorageError) return { ok: false, response: storageErrorResponse(err) };
    const message = err instanceof joseErrors.JOSEError || err instanceof Error ? err.message : String(err);
    return { ok: false, response: storageErrorResponse(ERRORS.AccessDenied(message)) };
  }
}

/** HEAD sin ruta propia la atiende la de GET, como Fastify. */
function findRoute(method: string, path: string): { r: StorageRoute; m: RegExpExecArray } | null {
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.pattern.exec(path);
    if (m) return { r, m };
  }
  return method === "HEAD" ? findRoute("GET", path) : null;
}

/** El almacén de un proyecto: el suyo si lo trae (pruebas), si no, el del
 *  entorno. null = sin R2 en este servidor. */
function storeFor(project: BackendProject): BlobStore | null {
  return project.storage ? project.storage.store : pageBlobStore();
}

/** Una petición a /storage/v1`sub`. */
export async function handleStorage(req: Request, sub: string, project: BackendProject): Promise<Response> {
  if (!isProjectHost(req, project.ref)) return json({ message: "no Route matched with those values" }, 404);
  const store = storeFor(project);
  if (!store) return json({ message: "Storage is not available on this server" }, 503);
  try {
    await project.storage?.ensure?.();
  } catch (err) {
    console.error("[storage] no se pudo montar el esquema storage", project.ref, err);
    return json({ message: "The project storage is not ready yet. Try again in a moment." }, 503);
  }

  const method = req.method.toUpperCase();
  const path = sub || "/";
  const route = findRoute(method, path);

  const resolved = await resolveStorageRole(req, project, route?.r.open === true);
  if (!resolved.ok) return resolved.response;

  if (!route) {
    const search = new URL(req.url).search;
    return json({ statusCode: "404", error: "Not Found", message: `Route ${method}:${path}${search} not found`, code: "InvalidRequest" }, 404);
  }
  const ctx: StorageContext = {
    project,
    store,
    role: resolved.role,
    claims: resolved.claims,
    jwt: resolved.jwt,
    authenticated: resolved.authenticated,
    limits: project.storage?.limits ?? storageLimits(),
    method,
    path,
  };
  try {
    return await route.r.handle(req, ctx, route.m);
  } catch (err) {
    return storageErrorResponse(err);
  }
}
