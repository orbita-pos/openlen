import { timingSafeEqual } from "node:crypto";

/** Guard compartido de las rutas internas máquina-a-máquina (live-republish,
 *  republish). Fail-closed: sin OPENLEN_INTERNAL_SECRET en el entorno, SIEMPRE
 *  rechaza. Comparación de tiempo constante; longitudes distintas rechazan sin
 *  comparar (timingSafeEqual lanza sobre buffers desiguales). */
export function internalSecretOk(req: Request): boolean {
  const secret = process.env.OPENLEN_INTERNAL_SECRET;
  if (!secret) return false;
  const given = req.headers.get("x-internal-secret") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
