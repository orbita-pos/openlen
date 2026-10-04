// Las claves de un proyecto y sus JWT, con la forma de Supabase
// (plans/pages-backend/design.md):
//
//   · `ref`: 20 letras minúsculas, como `<ref>.supabase.co`.
//   · `sb_publishable_…` (va en la página) y `sb_secret_…` (sólo servidor), el
//     formato de claves actual de Supabase; supabase-js 2.117 sólo mira el
//     prefijo (`isNewApiKey` en su `fetchWithAuth`).
//   · Los tokens de sesión, JWT HS256 firmados con el secreto del proyecto,
//     como GoTrue con `GOTRUE_JWT_SECRET`.

import crypto from "node:crypto";
import { errors, jwtVerify, SignJWT, type JWTPayload } from "jose";

const LOWER = "abcdefghijklmnopqrstuvwxyz";
const BASE62 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function randomFrom(alphabet: string, length: number): string {
  let out = "";
  while (out.length < length) {
    for (const b of crypto.randomBytes(length * 2)) {
      // Rechazo de los bytes que sesgarían la distribución.
      if (b < 256 - (256 % alphabet.length)) out += alphabet[b % alphabet.length];
      if (out.length === length) break;
    }
  }
  return out;
}

export function newProjectRef(): string {
  return randomFrom(LOWER, 20);
}

export function newPublishableKey(): string {
  return `sb_publishable_${randomFrom(BASE62, 32)}`;
}

export function newSecretKey(): string {
  return `sb_secret_${randomFrom(BASE62, 32)}`;
}

export function hashSecretKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

/** 48 bytes: por encima de los 32 que pide HS256. */
export function newJwtSecret(): string {
  return crypto.randomBytes(48).toString("base64url");
}

/** La contraseña del rol de desarrollador (el «postgres» del proyecto). Sólo
 *  base64url: va pegada en un `ALTER ROLE … PASSWORD '…'`. */
export function newDatabasePassword(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export type JwtClaims = JWTPayload & Record<string, unknown>;

export async function signJwt(secret: string, claims: JwtClaims, expiresInSeconds: number): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt(now)
    .setExpirationTime(now + expiresInSeconds)
    .sign(new TextEncoder().encode(secret));
}

export type VerifyResult =
  | { ok: true; claims: JwtClaims }
  | { ok: false; reason: "expired" | "bad_signature" | "malformed" };

export async function verifyJwt(secret: string, token: string): Promise<VerifyResult> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), { algorithms: ["HS256"] });
    return { ok: true, claims: payload as JwtClaims };
  } catch (err) {
    if (err instanceof errors.JWTExpired) return { ok: false, reason: "expired" };
    if (err instanceof errors.JWSSignatureVerificationFailed) return { ok: false, reason: "bad_signature" };
    return { ok: false, reason: "malformed" };
  }
}
