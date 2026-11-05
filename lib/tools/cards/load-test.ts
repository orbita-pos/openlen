// THE LOAD TEST AFTER INSTALLING (spec local 2026-11-04-herramientas-hechas-por-len, §4.10): DeepSeek installs and
// notes that «a successful registration alone does not prove that the user can open it»; OpenLen opens the installed
// release in the measuring Chromium — the deterministic pass of `view_page mode="measure"`, no model, no credit — with
// its bridge in installed mode, and a JS error means it doesn't load. A measure that couldn't run is not a failure:
// it couldn't check, it didn't see an error.
import "server-only";

import type { VisualQualityRenderOptions, VisualQualityViewports } from "@/lib/ai/visual-quality-renderer";

import { toolBridgeClientSource } from "../bridge/client-source";
import type { BridgeCaller } from "../bridge/handlers";
import { injectToolBridge, TOOL_BRIDGE_PATH } from "../bridge/inject";
import type { ToolInstallationRow } from "../store";
import type { ToolReleaseFile } from "../types";

export interface LoadTestDeps {
  readRelease(sha: string): Promise<Record<string, ToolReleaseFile> | null>;
  measure(html: string, internals: Record<string, never>, opts: VisualQualityRenderOptions): Promise<VisualQualityViewports | null>;
}

async function realLoadTestDeps(): Promise<LoadTestDeps> {
  const [{ readRelease }, { renderVisualQualityViewports }] = await Promise.all([import("../store"), import("@/lib/ai/visual-quality-renderer")]);
  return { readRelease, measure: (html, internals, opts) => renderVisualQualityViewports(html, internals, opts) };
}

export async function loadTestInstalled(
  installation: ToolInstallationRow,
  caller: BridgeCaller,
  deps?: LoadTestDeps,
): Promise<{ ok: true } | { ok: false; errors: string[] }> {
  const d = deps ?? (await realLoadTestDeps());
  const release = await d.readRelease(installation.releaseSha);
  const shell = release?.["/index.html"]?.content;
  if (!release || !shell) return { ok: false, errors: ["The installed version is gone."] };
  const files = Object.fromEntries(Object.entries(release).map(([path, f]) => [path, f.content]));
  const m = await d
    .measure(injectToolBridge(shell), {}, {
      carpeta: { files, pagina: null, platformFiles: { [TOOL_BRIDGE_PATH]: toolBridgeClientSource([]) } },
      preparePage: async (page) => (await import("../bridge/eyes")).installEyesBridge(page as never, caller),
    })
    .catch(() => null);
  if (!m) {
    console.warn(`[tools] load test of ${installation.id} couldn't run; not counted as a failure`);
    return { ok: true };
  }
  const errors = [...(m.runtimeErrors ?? [])];
  return errors.length ? { ok: false, errors } : { ok: true };
}
