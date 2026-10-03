// La sesión de una cuenta en una página: un token opaco en una cookie, y sólo
// su sha256 en la base (`memberSessions`). Verificar ES buscar la fila; borrar
// la fila ES cerrar la sesión. El mismo diseño que el chat privado
// (lib/chat/session.ts), con una diferencia que no es de estilo:
//
// 🔴 EL PREFIJO `__Host-`. `openlen.app` NO está en la Public Suffix List
// (infra/caddy/Caddyfile), así que `a.openlen.app` y `b.openlen.app` son el
// MISMO SITIO para el navegador, y una página ajena —que puede llevar
// JavaScript— podría plantar una cookie para `.openlen.app` que la caja de otro
// leería como suya. Con `__Host-` el navegador sólo acepta la cookie si es
// `Secure`, con `Path=/` y SIN `Domain`: nadie más que ese host puede ponerla.
// Por eso va siempre `Secure`, también en desarrollo: `localhost` cuenta como
// origen seguro y la acepta.

import crypto from "node:crypto";

export const SESSION_COOKIE = "__Host-ol_s";
/** La de una cuenta: 30 días. La del dueño, 7: abre todo. */
export const MEMBER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const OWNER_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function newSessionToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(32).toString("base64url");
  return { raw, hash: hashToken(raw) };
}

export function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export function buildSessionCookie(raw: string, ttlMs: number): string {
  return `${SESSION_COOKIE}=${raw}; Path=/; Max-Age=${Math.floor(ttlMs / 1000)}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

/** El token de la cookie, o `null`. Sólo acepta la forma que emitimos: 32
 *  bytes en base64url. Lo demás no llega a la base. */
export function readSessionCookie(headers: { get(name: string): string | null }): string | null {
  const raw = headers.get("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1 || part.slice(0, eq).trim() !== SESSION_COOKIE) continue;
    const value = part.slice(eq + 1).trim();
    return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
  }
  return null;
}
