// THE PRIVATE HOST OF AN AGENT'S TOOL (spec local 2026-11-22-herramienta-dentro-del-agente, §2): the same shape as the
// canvas label (`lienzo-` + 32 hex), so Caddy's `lienzo-*` handle and the canvas rewrites already reach Next with no
// infra change — but keyed by the tool's row and looked up in `lenArtifacts`, never recomputed from a live document. An HMAC
// with Auth.js's secret: it can't be guessed. Each label has a domain of its own, apart from the installed tool's
// (`lib/tools/host.ts`: `openlen-tool:`), so one id can never be two hosts of two kinds of tool.
import "server-only";

import { hmacHostLabel, toolFrameUrl } from "@/lib/tools/host";

type Env = Readonly<Record<string, string | undefined>>;

/** The label the workspace frames the tool on: framed only by openlen.com. */
export function lenArtifactHostLabel(toolId: string, env: Env = process.env): string | null {
  return hmacHostLabel("openlen-artifact:", toolId, env);
}

/** The phone's own label for the same tool: framed only by the phone app's origins, so the workspace's label stays framed
 *  only by openlen.com. */
export function lenArtifactPhoneHostLabel(toolId: string, env: Env = process.env): string | null {
  return hmacHostLabel("openlen-artifact-phone:", toolId, env);
}

/** Where a screen frames the tool: its private host, with the published version in the query so a republish never shows
 *  a cached older one. `null` = no isolated host here (the canvas origin is switched off). */
export function lenArtifactFrameUrl(
  i: { readonly hostLabel: string; readonly releaseSha: string; readonly requestHost: string | null },
  env: Env = process.env,
): string | null {
  return toolFrameUrl(i, env);
}
