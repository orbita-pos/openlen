// La puerta del backend de un proyecto: lo que en Supabase hace su pasarela
// (la `apikey`) y PostgREST (el JWT → el rol), antes de repartir a /rest/v1 o
// /auth/v1 (plans/pages-backend/design.md).
//
//   · `apikey` (cabecera o parámetro `apikey=`): la publicable es `anon`; la
//     secreta, `service_role`. Sin ella o con otra, los mensajes de Supabase.
//   · `Authorization: Bearer <jwt>` de un usuario (firmado con el secreto del
//     proyecto) manda sobre la clave: su `role` (normalmente `authenticated`).
//     Si el Bearer ES la clave (supabase-js lo manda así sin sesión), cuenta la
//     clave.
//   · CORS abierto, como Supabase: la autorización viaja en cabeceras, no en
//     cookies, así que una página ajena no puede usar una sesión que no tiene.

import type { AuthConfig, SendAuthMail } from "./auth/config";
import { handleAuth, isOpenAuthPath } from "./auth/handler";
import type { ProjectDatabase } from "./db";
import { hashSecretKey, verifyJwt } from "./keys";
import { errorResponse, handleRest, type ApiRole } from "./rest/handler";
import { PostgrestError } from "./rest/errors";
/* ── carril D: storage ── */
import type { BlobStore } from "./storage/blob-store";
import { handleStorage } from "./storage/handler";
import type { StorageLimits } from "./storage/limits";
/* ── fin carril D ── */

export interface BackendProject {
  readonly ref: string;
  readonly publishableKey: string;
  readonly secretKeyHash: string;
  readonly jwtSecret: string;
  readonly db: ProjectDatabase;
  readonly auth: { readonly config: AuthConfig; readonly sendMail: SendAuthMail };
  /* ── carril D: storage ── Sin esto, el almacén del entorno (R2) y los
   * límites por defecto; `ensure` monta el esquema `storage` la primera vez. */
  readonly storage?: {
    readonly store: BlobStore | null;
    readonly limits?: StorageLimits;
    readonly ensure?: () => Promise<void>;
  };
}

/** Las cabeceras que PostgREST deja ver a una página de otro origen; sin
 *  `Content-Range` supabase-js no podría leer el `count`. */
const EXPOSE_HEADERS =
  "Content-Encoding, Content-Location, Content-Range, Content-Type, Date, Location, Server, Transfer-Encoding, Range-Unit, Preference-Applied";

function withCors(res: Response, req: Request): Response {
  const h = new Headers(res.headers);
  h.set("Access-Control-Allow-Origin", req.headers.get("origin") ?? "*");
  h.set("Access-Control-Expose-Headers", EXPOSE_HEADERS);
  h.append("Vary", "Origin");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

function preflight(req: Request): Response {
  return new Response(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": req.headers.get("origin") ?? "*",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS, HEAD",
      "Access-Control-Allow-Headers":
        req.headers.get("access-control-request-headers") ??
        "authorization, x-client-info, apikey, content-type, prefer, accept-profile, content-profile, range, x-supabase-api-version",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    },
  });
}

function gatewayError(message: string, hint: string): Response {
  return new Response(JSON.stringify({ message, hint }), {
    status: 401,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export type ResolvedRole =
  | { ok: true; role: ApiRole; claims: Record<string, unknown>; viaUserJwt: boolean }
  | { ok: false; response: Response };

const API_ROLES: readonly ApiRole[] = ["anon", "authenticated", "service_role"];

/** La clave y el JWT de una petición → su rol y sus claims. */
export async function resolveRole(req: Request, project: BackendProject): Promise<ResolvedRole> {
  const url = new URL(req.url);
  const apikey = req.headers.get("apikey") ?? url.searchParams.get("apikey");
  if (!apikey) {
    return { ok: false, response: gatewayError("No API key found in request", "No `apikey` request header or url param was found.") };
  }
  let base: ApiRole;
  if (apikey === project.publishableKey) base = "anon";
  else if (hashSecretKey(apikey) === project.secretKeyHash) base = "service_role";
  else {
    return { ok: false, response: gatewayError("Invalid API key", "Double check your Supabase `anon` or `service_role` API key.") };
  }

  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "")?.[1]?.trim();
  if (!bearer || bearer === apikey) return { ok: true, role: base, claims: { role: base }, viaUserJwt: false };

  const v = await verifyJwt(project.jwtSecret, bearer);
  if (!v.ok) {
    const parts = bearer.split(".").length;
    const [code, message] =
      v.reason === "expired"
        ? ["PGRST303", "JWT expired"]
        : parts !== 3
          ? ["PGRST301", `Expected 3 parts in JWT; got ${parts}`]
          : ["PGRST301", "JWT cryptographic operation failed"];
    return {
      ok: false,
      response: errorResponse(
        new PostgrestError(401, { code, message, details: null, hint: null }, {
          "WWW-Authenticate": `Bearer error="invalid_token", error_description="${message}"`,
        }),
      ),
    };
  }
  const role = v.claims.role;
  if (typeof role !== "string" || !(API_ROLES as readonly string[]).includes(role)) {
    return {
      ok: false,
      response: errorResponse(new PostgrestError(401, { code: "22023", message: `role "${String(role)}" does not exist`, details: null, hint: null })),
    };
  }
  return { ok: true, role: role as ApiRole, claims: v.claims, viaUserJwt: true };
}

export async function handleBackendRequest(req: Request, project: BackendProject): Promise<Response> {
  if (req.method.toUpperCase() === "OPTIONS") return preflight(req);
  const path = new URL(req.url).pathname;
  const rest = /^\/rest\/v1(\/.*)?$/.exec(path);
  if (rest) {
    const resolved = await resolveRole(req, project);
    if (!resolved.ok) return withCors(resolved.response, req);
    return withCors(await handleRest(req, rest[1] ?? "", { db: project.db, role: resolved.role, claims: resolved.claims }), req);
  }
  const auth = /^\/auth\/v1(\/.*)?$/.exec(path);
  if (auth) {
    const sub = auth[1] ?? "";
    const url = new URL(req.url);
    const apikey = req.headers.get("apikey") ?? url.searchParams.get("apikey");
    let keyRole: "anon" | "service_role" | null = null;
    if (!isOpenAuthPath(sub, req.method.toUpperCase())) {
      if (!apikey) {
        return withCors(gatewayError("No API key found in request", "No `apikey` request header or url param was found."), req);
      }
      if (apikey === project.publishableKey) keyRole = "anon";
      else if (hashSecretKey(apikey) === project.secretKeyHash) keyRole = "service_role";
      else return withCors(gatewayError("Invalid API key", "Double check your Supabase `anon` or `service_role` API key."), req);
    }
    return withCors(
      await handleAuth(req, sub, {
        db: project.db,
        config: project.auth.config,
        sendMail: project.auth.sendMail,
        jwtSecret: project.jwtSecret,
        keyRole,
        apikey,
      }),
      req,
    );
  }
  /* ── carril D: storage ── (lib/backend/storage/handler.ts: sólo en el host
   * del `ref`, nunca en el de la página). */
  const storage = /^\/storage\/v1(\/.*)?$/.exec(path);
  if (storage) return withCors(await handleStorage(req, storage[1] ?? "", project), req);
  /* ── fin carril D ── */
  return withCors(
    new Response(JSON.stringify({ message: "no Route matched with those values" }), {
      status: 404,
      headers: { "content-type": "application/json; charset=utf-8" },
    }),
    req,
  );
}
