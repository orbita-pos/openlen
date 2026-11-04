// @vitest-environment node
//
// THE LOAD TEST AFTER INSTALLING (spec local 2026-11-04-herramientas-hechas-por-len, §4.10): DeepSeek's «a successful
// registration alone does not prove that the user can open it». The installed release opens in the measuring Chromium
// with its bridge in installed mode; a JS error means it doesn't load.
import { describe, expect, it, vi } from "vitest";

import type { BridgeCaller } from "../bridge/handlers";
import type { ToolInstallationRow } from "../store";

vi.mock("server-only", () => ({}));

const { loadTestInstalled } = await import("./load-test");

const installation = { id: "i1", projectId: "t1", releaseSha: "sha1", personId: "u1" } as ToolInstallationRow;
const caller: BridgeCaller = { personId: "u1", personEmail: "a@example.com", locale: "es", timeZone: "UTC", mode: "installed", installation };
const release = {
  "/index.html": { content: "<!doctype html><html><head><title>T</title></head><body><div id=\"root\"></div></body></html>", contentType: "text/html" },
  "/src/main.tsx": { content: "console.log(1)", contentType: "text/javascript" },
};

function deps(runtimeErrors: string[] | null) {
  const seen: { html?: string; opts?: { carpeta?: { files?: Record<string, string>; platformFiles?: Record<string, string> }; preparePage?: (p: unknown) => Promise<void> } } = {};
  return {
    seen,
    deps: {
      readRelease: vi.fn(async () => release),
      measure: vi.fn(async (html: string, _i: unknown, opts: unknown) => {
        seen.html = html;
        seen.opts = opts as typeof seen.opts;
        return runtimeErrors === null ? null : ({ runtimeErrors } as never);
      }),
    },
  };
}

describe("loadTestInstalled", () => {
  it("no JS error: it loads", async () => {
    const d = deps([]);
    expect(await loadTestInstalled(installation, caller, d.deps)).toEqual({ ok: true });
  });

  it("a JS error: it doesn't, with the errors", async () => {
    const d = deps(["TypeError: x is undefined (/src/App.tsx:3)"]);
    expect(await loadTestInstalled(installation, caller, d.deps)).toEqual({ ok: false, errors: ["TypeError: x is undefined (/src/App.tsx:3)"] });
  });

  it("measures the installed release with its bridge, its files, the bridge script and the eyes' bridge exposed first", async () => {
    const d = deps([]);
    await loadTestInstalled(installation, caller, d.deps);
    expect(d.deps.readRelease).toHaveBeenCalledWith("sha1");
    expect(d.seen.html).toContain("/openlen/tool-bridge.js");
    expect(d.seen.opts?.carpeta?.files?.["/src/main.tsx"]).toBe("console.log(1)");
    expect(d.seen.opts?.carpeta?.platformFiles?.["/openlen/tool-bridge.js"]).toBeTruthy();
    const exposed: string[] = [];
    await d.seen.opts!.preparePage!({ exposeFunction: async (name: string) => void exposed.push(name) });
    expect(exposed).toEqual(["__openlenBridge"]);
  });

  it("a measure that couldn't run is not a failure (it couldn't check, it didn't see an error)", async () => {
    const d = deps(null);
    expect(await loadTestInstalled(installation, caller, d.deps)).toEqual({ ok: true });
  });

  it("a release that is gone fails", async () => {
    const d = deps([]);
    d.deps.readRelease.mockResolvedValueOnce(null as never);
    expect(await loadTestInstalled(installation, caller, d.deps)).toEqual({ ok: false, errors: ["The installed version is gone."] });
  });
});
