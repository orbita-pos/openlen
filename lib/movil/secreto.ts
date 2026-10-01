// Los secretos de la app del teléfono: el código de un solo uso y la llave.
// Se guardan por su HUELLA (SHA-256), nunca tal cual: quien lea la base no
// puede entrar con ellos, igual que con las contraseñas. Son 32 bytes al azar,
// así que la huella sin sal basta (no hay diccionario que probar).
import crypto from "node:crypto";

export const VIDA_DEL_CODIGO_MS = 2 * 60_000;
const ESTADO = /^[A-Za-z0-9_-]{16,128}$/;
const BEARER = /^Bearer ([A-Za-z0-9_-]{20,200})$/;

export function secretoNuevo(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function huella(secreto: string): string {
  return crypto.createHash("sha256").update(secreto, "utf8").digest("hex");
}

/** El `estado` que la app inventa al abrir el navegador y comprueba al volver. */
export function estadoValido(x: unknown): x is string {
  return typeof x === "string" && ESTADO.test(x);
}

/** «Bearer <llave>» → la llave; cualquier otra cosa → null. */
export function llaveDeLaCabecera(valor: string | null): string | null {
  const m = BEARER.exec(valor?.trim() ?? "");
  return m ? m[1]! : null;
}
