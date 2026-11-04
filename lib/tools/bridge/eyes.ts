// LEN'S EYES RUN A TOOL WITH ITS BRIDGE (spec local 2026-11-04-herramientas-hechas-por-len, §4.4, §4.8). The eyes open
// the tool top-level in Chromium, with no workspace around it, so `window.openlen` calls `__openlenBridge`, which
// Puppeteer exposes and this answers in Node: reads through the same handlers as the bridge's server; writes never
// — the canvas's draft never writes production (`draft_no_production`) and the eyes never write an installed tool
// either (`eyes_never_write`); there is no chat to put text in; and the theme is the light one by default.
import "server-only";

import { BRIDGE_CHANNEL, BRIDGE_METHODS, METHOD_NOT_FOUND, type BridgeError, type BridgeRequest, type ToolContext } from "./protocol";
import { handleBridgeCall, SERVER_METHODS, toolProjectOf, type BridgeCaller, type ServerMethod } from "./handlers";

export const EYES_BRIDGE_FUNCTION = "__openlenBridge";

/** The workspace's light colours (app/[locale]/new/tokens.css), what a tool sees in the eyes. */
const LIGHT_TOKENS: Readonly<Record<string, string>> = {
  "--bg": "#ffffff",
  "--bg-elev": "#ffffff",
  "--fg": "#18181b",
  "--fg-muted": "#52525b",
  "--fg-faint": "#a1a1aa",
  "--border": "#e4e4e7",
  "--accent": "#e8613a",
};

export interface EyesDeps {
  handle(caller: BridgeCaller, method: ServerMethod, params: unknown): Promise<{ result: unknown } | { error: BridgeError }>;
}

function contextOf(caller: BridgeCaller): ToolContext {
  return {
    person: { name: "", locale: caller.locale },
    theme: { mode: "light", tokens: LIGHT_TOKENS },
    project: null,
    tool: caller.mode === "installed" ? { id: caller.installation.id, version: caller.installation.releaseSha } : { id: toolProjectOf(caller), version: "draft" },
    environment: caller.mode,
  };
}

async function answer(caller: BridgeCaller, req: BridgeRequest, d: EyesDeps): Promise<{ result: unknown } | { error: BridgeError }> {
  switch (req.method) {
    case "context":
      return { result: contextOf(caller) };
    case "update":
      return { result: { status: "refused", reason: caller.mode === "draft" ? "draft_no_production" : "eyes_never_write" } };
    case "sendPrompt":
      return { result: { status: "unavailable" } };
    default:
      return (SERVER_METHODS as readonly string[]).includes(req.method)
        ? d.handle(caller, req.method as ServerMethod, req.params)
        : { error: { code: METHOD_NOT_FOUND, message: "method_not_found" } };
  }
}

export async function installEyesBridge(
  page: { exposeFunction(name: string, fn: (json: string) => Promise<string>): Promise<void> },
  caller: BridgeCaller,
  deps: EyesDeps = { handle: (c, m, p) => handleBridgeCall(c, m, p) },
): Promise<void> {
  await page.exposeFunction(EYES_BRIDGE_FUNCTION, async (json: string) => {
    let req: Partial<BridgeRequest> = {};
    try {
      req = JSON.parse(json) as BridgeRequest;
    } catch {
      /* answered below as not found */
    }
    const id = typeof req.id === "number" ? req.id : 0;
    const known = (BRIDGE_METHODS as readonly unknown[]).includes(req.method);
    const r = known ? await answer(caller, req as BridgeRequest, deps) : { error: { code: METHOD_NOT_FOUND, message: "method_not_found" } };
    return JSON.stringify({ jsonrpc: "2.0", id, ...r, channel: BRIDGE_CHANNEL });
  });
}
