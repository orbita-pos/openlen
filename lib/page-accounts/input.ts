// Lo que llega del navegador a las rutas de cuentas, limpio o rechazado. Puro.

import type { AccountsDeclaration } from "./declaration";

export { isValidPassword } from "@/lib/auth/visitor-password";

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,63}$/;

/** El correo en minúsculas y sin espacios, o `null` si no lo parece. La clave
 *  de una cuenta es `(projectId, email)`: sin normalizar, «Ana@x.mx» y
 *  «ana@x.mx» serían dos cuentas. */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  return EMAIL_RE.test(email) ? email : null;
}

export function cleanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim().replace(/\s+/g, " ").slice(0, 80).trim();
  return name.length > 0 ? name : null;
}

/** `undefined` = no viene (no se toca). `null` = sin papel. `false` = un papel
 *  que la página no declara: se rechaza, porque dárselo a una cuenta no le
 *  daría nada y el dueño creería que sí. */
export function roleFromInput(raw: unknown, accounts: AccountsDeclaration): string | null | undefined | false {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;
  return typeof raw === "string" && accounts.papeles.includes(raw) ? raw : false;
}

/** A dónde volver después de entrar: una ruta de ESTA página. Nada que empiece
 *  por `//` o `/\` (el navegador lo lee como otro host), nada con esquema. */
export function safeBackPath(raw: unknown): string {
  if (typeof raw !== "string" || !raw.startsWith("/")) return "/";
  if (raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  if (/[\u0000-\u001f]/.test(raw)) return "/";
  return raw.slice(0, 512);
}
