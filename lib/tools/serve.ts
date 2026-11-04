// SERVING AN INSTALLED TOOL ON ITS PRIVATE HOST (spec local 2026-11-04-herramientas-hechas-por-len, §4.4): the
// release exactly as installed, the shell with `window.openlen` first in its <head>, and the bridge script for
// the app's origins. Framed only by the workspace (`frame-ancestors`), never cached. Switched off, removed or
// with its release gone, it doesn't exist; on the Free plan it says a paid plan is needed (§4.13).
import "server-only";

import { isBlobPointer } from "@/lib/files/blob-pointer";
import { esPeticionLocal, esProduccion, frameAncestors, origenDeLaApp } from "@/lib/lienzo/host";
import type { Plan } from "@/lib/plan";

import { toolBridgeClientSource } from "./bridge/client-source";
import { injectToolBridge, TOOL_BRIDGE_PATH } from "./bridge/inject";
import type { ToolInstallationRow } from "./store";
import type { ToolReleaseFile } from "./types";

export { injectToolBridge, TOOL_BRIDGE_PATH };
const LOCALES = ["en", "es", "pt", "fr", "de", "it", "ja", "ko", "zh", "nl"] as const;

type Env = Readonly<Record<string, string | undefined>>;

export interface ServeDeps {
  readRelease(sha: string): Promise<Record<string, ToolReleaseFile> | null>;
  plan(personId: string): Promise<Plan>;
  getBlob(pointer: string): Promise<Uint8Array>;
  planRequiredText(locale: string): Promise<string>;
}

async function realServeDeps(): Promise<ServeDeps> {
  const [store, limits, blob] = await Promise.all([import("./store"), import("@/lib/limits"), import("@/lib/files/blob")]);
  return {
    readRelease: store.readRelease,
    plan: limits.getUserPlan,
    getBlob: (p) => blob.getBlob(p),
    planRequiredText: async (locale) => {
      const messages = (await import(`@/messages/${locale}/wsChrome.json`)) as { default?: { tools?: { planRequired?: string } } };
      return messages.default?.tools?.planRequired ?? "You need a paid plan to open this tool.";
    },
  };
}

/** The origins a tool takes answers from: the app, and locally the workspace on localhost at the request's port
 *  (the same rule as Len's visuals frame). */
export function toolParentOrigins(requestHost: string | null, env: Env = process.env): string[] {
  const origins = [origenDeLaApp(env)];
  if (!esProduccion(env) || esPeticionLocal(requestHost)) {
    const port = /:(\d+)$/.exec(String(requestHost ?? ""))?.[1];
    const suffix = port ? `:${port}` : "";
    origins.push(`http://localhost${suffix}`, `http://127.0.0.1${suffix}`);
  }
  return [...new Set(origins)];
}

/** The bridge script itself, for whoever serves a tool (its installed host, or its project's canvas). */
export function toolBridgeScriptResponse(requestHost: string | null, env: Env = process.env): Response {
  return new Response(toolBridgeClientSource(toolParentOrigins(requestHost, env)), {
    status: 200,
    headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}

function localeOf(acceptLanguage: string | null): string {
  for (const part of String(acceptLanguage ?? "").split(",")) {
    const tag = part.split(";")[0]!.trim().toLowerCase().slice(0, 2);
    if ((LOCALES as readonly string[]).includes(tag)) return tag;
  }
  return "en";
}

const notFound = () => new Response("Not found", { status: 404, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });

export async function serveToolRelease(
  row: ToolInstallationRow,
  path: string,
  o: { readonly requestHost: string | null; readonly acceptLanguage: string | null; readonly env?: Env },
  deps?: ServeDeps,
): Promise<Response> {
  if (!row.enabled || row.removedAt) return notFound();
  const d = deps ?? (await realServeDeps());
  const env = o.env ?? process.env;
  const frame = { "content-security-policy": `frame-ancestors ${frameAncestors(env)}`, "referrer-policy": "no-referrer", "x-content-type-options": "nosniff", "cache-control": "no-store" };

  if ((await d.plan(row.personId)) === "free") {
    const text = await d.planRequiredText(localeOf(o.acceptLanguage));
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0"><p>${text.replace(/[<>&]/g, "")}</p></body></html>`;
    return new Response(html, { status: 402, headers: { ...frame, "content-type": "text/html; charset=utf-8" } });
  }
  if (path === TOOL_BRIDGE_PATH) return toolBridgeScriptResponse(o.requestHost, env);

  const release = await d.readRelease(row.releaseSha);
  if (!release) return notFound();
  const file = release[path === "/" ? "/index.html" : path];
  if (!file) return notFound();
  if (path === "/" || path === "/index.html") {
    return new Response(injectToolBridge(file.content), { status: 200, headers: { ...frame, "content-type": "text/html; charset=utf-8" } });
  }
  const body = isBlobPointer(file.content) ? new Uint8Array(await d.getBlob(file.content)) : file.content;
  return new Response(body, {
    status: 200,
    headers: { "content-type": file.contentType, "cache-control": "no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" },
  });
}
