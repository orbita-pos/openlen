// THE PRIVATE HOST OF AN AGENT'S TOOL (spec local 2026-11-22-herramienta-dentro-del-agente, §3): the same shape as the
// canvas label (`lienzo-` + 32 hex), so Caddy's `lienzo-*` handle and the canvas rewrites already reach Next with no
// infra change — but keyed by the tool's row and looked up in `agentTools`, never recomputed from a live document. An HMAC
// with Auth.js's secret: it can't be guessed. Each label has a domain of its own, apart from the installed tool's
// (`lib/tools/host.ts`: `openlen-tool:`), so one id can never be two hosts of two kinds of tool.
import "server-only";

import { createHmac } from "node:crypto";

import { toolFrameUrl } from "@/lib/tools/host";
import { LIENZO_PREFIJO } from "@/lib/lienzo/host";

type Env = Readonly<Record<string, string | undefined>>;

function labelOf(domain: string, toolId: string, env: Env): string | null {
  const secret = env.AUTH_SECRET?.trim() || env.NEXTAUTH_SECRET?.trim();
  if (!secret) return null;
  const mark = createHmac("sha256", secret).update(`${domain}${toolId.toLowerCase()}`).digest("hex");
  return LIENZO_PREFIJO + mark.slice(0, 32);
}

/** The label the workspace frames the tool on: framed only by openlen.com. */
export function agentToolHostLabel(toolId: string, env: Env = process.env): string | null {
  return labelOf("openlen-agent-tool:", toolId, env);
}

/** The phone's own label for the same tool: framed only by the phone app's origins, so the workspace's label stays framed
 *  only by openlen.com. */
export function agentToolPhoneHostLabel(toolId: string, env: Env = process.env): string | null {
  return labelOf("openlen-agent-tool-phone:", toolId, env);
}

/** Where a screen frames the tool: its private host, with the published version in the query so a republish never shows
 *  a cached older one. `null` = no isolated host here (the canvas origin is switched off). */
export function agentToolFrameUrl(
  i: { readonly hostLabel: string; readonly releaseSha: string; readonly requestHost: string | null },
  env: Env = process.env,
): string | null {
  return toolFrameUrl(i, env);
}
