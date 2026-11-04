// LEN'S EYES RUN A TOOL WITH ITS BRIDGE (spec local 2026-11-04-herramientas-hechas-por-len, §4.4, §4.8). The eyes open
// the tool top-level in Chromium, with no workspace around it, so `window.openlen` calls `__openlenBridge`, which
// Puppeteer exposes and this answers in Node: reads through the same handlers as the bridge's server; `update` (a
// production row of another project, which needs the person's press) never — `draft_no_production` in the draft,
// `eyes_never_write` installed. The tool's OWN backend is its draft in the draft and its production installed, as
// for the person (Jesús, 04/11: Len may write the installed tool's own data when asked). There is no chat to put text
// in; the theme is light unless the eyes ask for dark.
import "server-only";

import { BRIDGE_CHANNEL, BRIDGE_METHODS, METHOD_NOT_FOUND, type BridgeError, type BridgeRequest, type ToolContext } from "./protocol";
import { handleBridgeCall, SERVER_METHODS, toolProjectOf, type BridgeCaller, type ServerMethod } from "./handlers";

export const EYES_BRIDGE_FUNCTION = "__openlenBridge";

/** The workspace's colours (app/[locale]/new/tokens.css), light and dark: what a tool sees in the eyes. */
const LIGHT_TOKENS: Readonly<Record<string, string>> = {
  "--bg": "oklch(97.2% 0.004 12)",
  "--bg-elev": "oklch(99.2% 0.003 12)",
  "--fg": "oklch(15% 0.01 12)",
  "--fg-muted": "oklch(45% 0.01 12)",
  "--fg-faint": "oklch(48% 0.01 12)",
  "--border": "oklch(85% 0.005 12 / 0.6)",
  "--border-strong": "oklch(78% 0.005 12 / 0.8)",
  "--hover": "oklch(93.2% 0.006 12)",
  "--accent": "#FF5A36",
  "--accent-strong": "#D63916",
};
const DARK_TOKENS: Readonly<Record<string, string>> = {
  ...LIGHT_TOKENS,
  "--bg": "oklch(11% 0.01 12)",
  "--bg-elev": "oklch(15% 0.01 12)",
  "--fg": "oklch(96% 0.005 12)",
  "--fg-muted": "oklch(65% 0.01 12)",
  "--fg-faint": "oklch(64% 0.01 12)",
  "--border": "oklch(25% 0.01 12 / 0.7)",
  "--border-strong": "oklch(32% 0.01 12 / 0.9)",
  "--hover": "oklch(18% 0.01 12)",
};

export interface EyesDeps {
  handle(caller: BridgeCaller, method: ServerMethod, params: unknown): Promise<{ result: unknown } | { error: BridgeError }>;
}

function contextOf(caller: BridgeCaller): ToolContext {
  return {
    person: { name: "", locale: caller.locale },
    theme: caller.theme === "dark" ? { mode: "dark", tokens: DARK_TOKENS } : { mode: "light", tokens: LIGHT_TOKENS },
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
  /** The caller, or a getter read on every call: a tab is bridged once and looks again in dark, or as another person. */
  callerOf: BridgeCaller | (() => BridgeCaller),
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
    const caller = typeof callerOf === "function" ? callerOf() : callerOf;
    const r = known ? await answer(caller, req as BridgeRequest, deps) : { error: { code: METHOD_NOT_FOUND, message: "method_not_found" } };
    return JSON.stringify({ jsonrpc: "2.0", id, ...r, channel: BRIDGE_CHANNEL });
  });
}
