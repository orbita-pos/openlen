// @vitest-environment node
//
// LEN'S EYES RUN A TOOL WITH ITS BRIDGE (spec local 2026-11-04-herramientas-hechas-por-len, §4.4, §4.8): without a
// parent, `window.openlen` calls the function Puppeteer exposes. Reads are answered for real; writes never are —
// in draft (the canvas) nor installed; and there is no chat to write in.
import { describe, expect, it, vi } from "vitest";

import type { ToolInstallationRow } from "../store";
import { installEyesBridge } from "./eyes";
import type { BridgeCaller } from "./handlers";

const base = { personId: "u1", personEmail: "ana@example.com", locale: "es", timeZone: "UTC" };
const draft: BridgeCaller = { ...base, mode: "draft", toolProjectId: "tool" };
const installed: BridgeCaller = { ...base, mode: "installed", installation: { id: "i1", projectId: "tool", releaseSha: "sha1" } as ToolInstallationRow };

async function exposed(caller: BridgeCaller, handle = vi.fn(async () => ({ result: [{ id: "p1" }] }))) {
  let fn: ((json: string) => Promise<string>) | null = null;
  await installEyesBridge({ exposeFunction: async (_name, f) => void (fn = f) }, caller, { handle });
  const call = async (method: string, params?: unknown) =>
    JSON.parse(await fn!(JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}), channel: "openlen-tool" }))) as Record<string, unknown>;
  return { call, handle };
}

describe("installEyesBridge", () => {
  it("update is always refused: draft_no_production in draft, eyes_never_write installed", async () => {
    const d = await exposed(draft);
    expect((await d.call("update", { projectId: "p1", table: "t", key: { id: 1 }, set: { a: 1 }, before: { a: 0 } })).result).toEqual({ status: "refused", reason: "draft_no_production" });
    const i = await exposed(installed);
    expect((await i.call("update", {})).result).toEqual({ status: "refused", reason: "eyes_never_write" });
    expect(d.handle).not.toHaveBeenCalled();
  });

  it("reads go to the bridge's handlers, for this caller", async () => {
    const d = await exposed(draft);
    expect((await d.call("projects")).result).toEqual([{ id: "p1" }]);
    expect(d.handle).toHaveBeenCalledWith(draft, "projects", undefined);
  });

  it("context: the person, a light theme, the tool and its mode", async () => {
    const i = await exposed(installed);
    expect((await i.call("context")).result).toMatchObject({ person: { locale: "es" }, theme: { mode: "light" }, tool: { id: "i1", version: "sha1" }, environment: "installed" });
  });

  it("context in dark: the workspace's dark colours, when the eyes ask for dark", async () => {
    const i = await exposed({ ...installed, theme: "dark" });
    const theme = ((await i.call("context")).result as { theme: { mode: string; tokens: Record<string, string> } }).theme;
    expect(theme.mode).toBe("dark");
    expect(theme.tokens["--bg"]).toBe("oklch(11% 0.01 12)");
    expect(theme.tokens["--fg"]).toBe("oklch(96% 0.005 12)");
  });

  it("the caller is read on every call, so the same tab can look in light and then in dark", async () => {
    let caller: BridgeCaller = installed;
    let fn: ((json: string) => Promise<string>) | null = null;
    await installEyesBridge({ exposeFunction: async (_name, f) => void (fn = f) }, () => caller, { handle: vi.fn() });
    const mode = async () => (JSON.parse(await fn!(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "context", channel: "openlen-tool" }))).result as { theme: { mode: string } }).theme.mode;
    expect(await mode()).toBe("light");
    caller = { ...installed, theme: "dark" };
    expect(await mode()).toBe("dark");
  });

  it("sendPrompt: there is no chat here", async () => {
    expect((await (await exposed(draft)).call("sendPrompt", { text: "hola" })).result).toEqual({ status: "unavailable" });
  });

  it("anything else is JSON-RPC's method not found", async () => {
    expect((await (await exposed(draft)).call("eval")).error).toMatchObject({ code: -32601 });
  });
});
