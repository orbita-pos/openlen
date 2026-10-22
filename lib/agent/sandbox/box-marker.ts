// The box's marker (plan local 2026-10-21-playwright-in-the-box): what E2B's egress proxy adds to every
// request the box makes to OpenLen's hosts of its project (a network rule; the box never sees it).
//
// With a VALID marker, the canvas host serves the box the draft site, saved, at any page's path (the
// same document Len's eyes see). With the header merely PRESENT, production is read-only: the backend
// answers reads only, functions don't run, and Caddy cuts the published page's own routes (forms,
// chat, analytics). Len never writes to production, also not from a test.
//
// `<projectId>.<HMAC(AUTH_SECRET, "openlen-caja:" + id), 32 hex>`: without the secret it can't be made.

import { createHmac, timingSafeEqual } from "node:crypto";

type Env = Readonly<Record<string, string | undefined>>;

/** Lowercase: as Node's Headers and Caddy's matchers compare it. */
export const BOX_MARKER_HEADER = "x-openlen-caja";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function secretOf(env: Env): string | null {
  return env.AUTH_SECRET?.trim() || env.NEXTAUTH_SECRET?.trim() || null;
}

function mac(secret: string, projectId: string): string {
  return createHmac("sha256", secret).update(`openlen-caja:${projectId.toLowerCase()}`).digest("hex").slice(0, 32);
}

export function boxMarker(projectId: string, env: Env = process.env): string | null {
  const secret = secretOf(env);
  if (!secret || !UUID.test(projectId)) return null;
  return `${projectId.toLowerCase()}.${mac(secret, projectId)}`;
}

/** The project a valid marker is for; `null` for anything else. */
export function projectOfBoxMarker(value: string | null | undefined, env: Env = process.env): string | null {
  const secret = secretOf(env);
  if (!secret || !value) return null;
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const projectId = value.slice(0, dot).toLowerCase();
  const given = value.slice(dot + 1);
  if (!UUID.test(projectId) || !/^[0-9a-f]{32}$/.test(given)) return null;
  const expected = Buffer.from(mac(secret, projectId));
  return timingSafeEqual(expected, Buffer.from(given)) ? projectId : null;
}
