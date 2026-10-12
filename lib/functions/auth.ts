// lib/functions/auth.ts — `verify_jwt` (spec local 2026-10-11, Parte 3). Por
// defecto activado, como en Supabase: pasa un JWT de usuario DE ESTE ENTORNO
// (su secreto: uno del borrador no entra en producción), o la clave del
// proyecto como Bearer o como `apikey` —lo que manda `supabase.functions.invoke`
// sin sesión; nuestro backend ya acepta la clave así—. Con `verify_jwt = false`
// (webhooks) pasa todo, y `OPTIONS` siempre: en Supabase el CORS lo pone el
// código de la función.

import { hashSecretKey, verifyJwt } from "@/lib/backend/keys";

export type AuthCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: "UNAUTHORIZED_NO_AUTH_HEADER" | "UNAUTHORIZED_INVALID_JWT_FORMAT" | "UNAUTHORIZED_LEGACY_JWT" };

export async function checkFunctionAuth(
  req: Request,
  o: { readonly verifyJwt: boolean; readonly publishableKey: string; readonly secretKeyHash: string; readonly jwtSecret: () => Promise<string> },
): Promise<AuthCheck> {
  if (!o.verifyJwt || req.method === "OPTIONS") return { ok: true };
  const esClave = (k: string) => k === o.publishableKey || hashSecretKey(k) === o.secretKeyHash;
  const auth = req.headers.get("authorization");
  if (!auth) {
    const apikey = req.headers.get("apikey");
    return apikey && esClave(apikey) ? { ok: true } : { ok: false, code: "UNAUTHORIZED_NO_AUTH_HEADER" };
  }
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (!m) return { ok: false, code: "UNAUTHORIZED_INVALID_JWT_FORMAT" };
  const token = m[1]!.trim();
  if (esClave(token)) return { ok: true };
  if (token.split(".").length !== 3) return { ok: false, code: "UNAUTHORIZED_INVALID_JWT_FORMAT" };
  const v = await verifyJwt(await o.jwtSecret(), token);
  return v.ok ? { ok: true } : { ok: false, code: "UNAUTHORIZED_LEGACY_JWT" };
}
