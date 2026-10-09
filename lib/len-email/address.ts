/**
 * LEN POR CORREO — la dirección de un proyecto.
 *
 * `len-<id sin guiones>-<12 hex de HMAC>@<LEN_EMAIL_DOMAIN>`. Lo que llega a
 * ella es un mensaje a Len en ESE proyecto (`app/api/len-email/inbound`). La
 * firma (HMAC con el secreto de Auth.js, como `etiquetaDeLienzo`) hace que no
 * se pueda escribir a un proyecto sabiendo sólo su id, que la analítica de
 * cualquier página publicada enseña. No basta con ella: además, el remitente
 * tiene que ser el dueño o un editor del proyecto, autenticado (DKIM/DMARC).
 *
 * Sin `LEN_EMAIL_DOMAIN` (o sin secreto) no hay dirección: la función está
 * apagada y la interfaz no la enseña.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

type Env = Readonly<Record<string, string | undefined>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCAL_PART = /^len-([0-9a-f]{32})-([0-9a-f]{12})$/;

export function lenEmailDomain(env: Env = process.env): string | null {
  const d = env.LEN_EMAIL_DOMAIN?.trim().toLowerCase();
  return d || null;
}

function secret(env: Env): string | null {
  return env.AUTH_SECRET?.trim() || env.NEXTAUTH_SECRET?.trim() || null;
}

function signature(projectId: string, key: string): string {
  return createHmac("sha256", key).update(`openlen-len-email:${projectId.toLowerCase()}`).digest("hex").slice(0, 12);
}

/** La dirección de Len en el proyecto, o `null` si la función está apagada. */
export function lenEmailAddress(projectId: string, env: Env = process.env): string | null {
  const domain = lenEmailDomain(env);
  const key = secret(env);
  if (!domain || !key || !UUID.test(projectId)) return null;
  return `len-${projectId.replace(/-/g, "").toLowerCase()}-${signature(projectId, key)}@${domain}`;
}

/** El proyecto de una dirección, si es nuestra y su firma vale. */
export function projectIdFromAddress(address: string, env: Env = process.env): string | null {
  const domain = lenEmailDomain(env);
  const key = secret(env);
  if (!domain || !key) return null;
  const at = address.trim().toLowerCase().lastIndexOf("@");
  if (at < 0 || address.trim().toLowerCase().slice(at + 1) !== domain) return null;
  const m = LOCAL_PART.exec(address.trim().toLowerCase().slice(0, at));
  if (!m) return null;
  const hex = m[1]!;
  const projectId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  const expected = Buffer.from(signature(projectId, key));
  const given = Buffer.from(m[2]!);
  return expected.length === given.length && timingSafeEqual(expected, given) ? projectId : null;
}
