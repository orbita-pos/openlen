// lib/project-email/unsubscribe.ts — THE UNSUBSCRIBE LINK OF AN APP OR FORM EMAIL (spec
// local 2026-10-22-email-integration, 6.7): `<payload>.<hmac>`, the payload being
// the project and the address, signed with the server's secret, so a link only
// takes that address off that project's emails. Pure.

import { createHmac, timingSafeEqual } from "node:crypto";

import { normalizeAddress } from "./types";

const mac = (payload: string, secret: string) => createHmac("sha256", secret).update(`unsubscribe:${payload}`).digest("base64url");

export function unsubscribeToken(projectId: string, address: string, secret: string): string {
  const payload = Buffer.from(JSON.stringify({ p: projectId, a: normalizeAddress(address) })).toString("base64url");
  return `${payload}.${mac(payload, secret)}`;
}

export function readUnsubscribeToken(token: string, secret: string): { projectId: string; address: string } | null {
  const [payload, sig, ...rest] = token.split(".");
  if (!payload || !sig || rest.length > 0) return null;
  const want = Buffer.from(mac(payload, secret));
  const given = Buffer.from(sig);
  if (want.length !== given.length || !timingSafeEqual(want, given)) return null;
  try {
    const j = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { p?: unknown; a?: unknown };
    return typeof j.p === "string" && typeof j.a === "string" ? { projectId: j.p, address: j.a } : null;
  } catch {
    return null;
  }
}
