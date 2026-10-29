// «QUITAR ESTA TAREA» FROM THE EMAIL (spec local 2026-10-29-tareas-programadas, §7.8): a weekly email
// has to be stoppable from the email itself. The link carries an HMAC of the task id with Auth.js's
// secret, like Len's email address (lib/len-email/address.ts): whoever has the email can remove that
// one task and nothing else. The page it opens asks first; a GET never removes (mail scanners open links).
import { createHmac, timingSafeEqual } from "node:crypto";

type Env = Readonly<Record<string, string | undefined>>;

function secret(env: Env): string | null {
  return env.AUTH_SECRET || env.NEXTAUTH_SECRET || null;
}

function sign(taskId: string, key: string): string {
  return createHmac("sha256", key).update(`openlen-scheduled-task:${taskId}`).digest("hex").slice(0, 24);
}

export function removalToken(taskId: string, env: Env = process.env): string | null {
  const key = secret(env);
  return key ? sign(taskId, key) : null;
}

export function verifyRemovalToken(taskId: string, token: string, env: Env = process.env): boolean {
  const key = secret(env);
  if (!key || !/^[0-9a-f]{24}$/.test(token)) return false;
  return timingSafeEqual(Buffer.from(sign(taskId, key)), Buffer.from(token));
}

/** The localized confirmation page, or null without a secret to sign with. */
export function removeUrl(o: { readonly siteUrl: string; readonly locale: string; readonly taskId: string }, env: Env = process.env): string | null {
  const token = removalToken(o.taskId, env);
  if (!token) return null;
  return `${o.siteUrl}/${encodeURIComponent(o.locale)}/scheduled-tasks/remove?task=${encodeURIComponent(o.taskId)}&token=${token}`;
}
