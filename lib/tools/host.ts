// THE PRIVATE HOST OF AN INSTALLED TOOL (spec local 2026-11-04-herramientas-hechas-por-len, §4.4): the same shape as
// the canvas label (`lienzo-` + 32 hex), so Caddy's `lienzo-*` handle and the canvas rewrites already reach Next
// with no infra change — but keyed by the installation, not the project, and looked up in `toolInstallations`
// (the canvas recomputes its label from live documents). An HMAC with Auth.js's secret: it can't be guessed.
import "server-only";

import { createHmac } from "node:crypto";

import { esPeticionLocal, esProduccion, lienzoApagado, lienzoBaseHost, LIENZO_PREFIJO } from "@/lib/lienzo/host";

type Env = Readonly<Record<string, string | undefined>>;

export function toolHostLabel(installationId: string, env: Env = process.env): string | null {
  const secret = env.AUTH_SECRET?.trim() || env.NEXTAUTH_SECRET?.trim();
  if (!secret) return null;
  const mark = createHmac("sha256", secret).update(`openlen-tool:${installationId.toLowerCase()}`).digest("hex");
  return LIENZO_PREFIJO + mark.slice(0, 32);
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
