// THE PRIVATE HOST OF AN INSTALLED TOOL (spec local 2026-11-04-herramientas-hechas-por-len, §4.4): the same shape as
// the canvas label (`lienzo-` + 32 hex), so Caddy's `lienzo-*` handle and the canvas rewrites already reach Next
// with no infra change — but keyed by the installation, not the project, and looked up in `toolInstallations`
// (the canvas recomputes its label from live documents). An HMAC with Auth.js's secret: it can't be guessed.
import "server-only";

import { createHmac } from "node:crypto";

import { esPeticionLocal, esProduccion, lienzoApagado, lienzoBaseHost, LIENZO_PREFIJO } from "@/lib/lienzo/host";

type Env = Readonly<Record<string, string | undefined>>;

/** The server's own secret (Auth.js's, then NextAuth's), trimmed; null when it has none. What every HMAC of this server is
 *  keyed with: a private host label (below), the version of an app on the desktop (`lib/desktop-apps/deps.ts`). */
export function serverSecret(env: Env = process.env): string | null {
  return env.AUTH_SECRET?.trim() || env.NEXTAUTH_SECRET?.trim() || null;
}

/** A private host label: `lienzo-` + 32 hex of an HMAC with Auth.js's secret over `domain` + the id (lowercase). One
 *  domain per kind of host — an installed tool's, its phone's, an agent's tool's, its phone's — so two kinds never meet.
 *  Null when the server has no secret. */
export function hmacHostLabel(domain: string, id: string, env: Env = process.env): string | null {
  const secret = serverSecret(env);
  if (!secret) return null;
  const mark = createHmac("sha256", secret).update(`${domain}${id.toLowerCase()}`).digest("hex");
  return LIENZO_PREFIJO + mark.slice(0, 32);
}

export function toolHostLabel(installationId: string, env: Env = process.env): string | null {
  return hmacHostLabel("openlen-tool:", installationId, env);
}

/** THE PHONE'S OWN LABEL for the same installation (phase 5, §4.14): framed only by the phone app's origins, so the
 *  workspace's label stays framed only by openlen.com — what `/api/movil/canvas` does with `framedBy` on its document. */
export function toolPhoneHostLabel(installationId: string, env: Env = process.env): string | null {
  return hmacHostLabel("openlen-tool-phone:", installationId, env);
}

/** THE PRIVATE HOST OF AN APP INSTALLED ON THE DESKTOP (spec local 2026-11-26-apps-en-el-escritorio, §4.2): a domain of its
 *  own, looked up in `desktopApps`, so one id is never a tool's host and a desktop app's at once. Null without a secret. */
export function desktopHostLabel(id: string, env: Env = process.env): string | null {
  return hmacHostLabel("openlen-desktop:", id, env);
}

/** Where the workspace frames the tool: its private host, with the release in the query so a reinstall
 *  never shows a cached older one. `null` = no isolated host here (the canvas origin is switched off). */
export function toolFrameUrl(
  i: { readonly hostLabel: string; readonly releaseSha: string; readonly requestHost: string | null },
  env: Env = process.env,
): string | null {
  if (lienzoApagado(env)) return null;
  const path = `/?v=${encodeURIComponent(i.releaseSha)}`;
  if (esProduccion(env) && !esPeticionLocal(i.requestHost)) {
    const base = lienzoBaseHost(env);
    return base ? `https://${i.hostLabel}.${base}${path}` : null;
  }
  const port = /:(\d+)$/.exec(String(i.requestHost ?? ""))?.[1];
  return `http://${i.hostLabel}.localhost${port ? `:${port}` : ""}${path}`;
}
