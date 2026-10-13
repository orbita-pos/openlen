import { describe, expect, it, vi } from "vitest";
import { installPackagesAfterSave } from "@/lib/agent/npm-after-save";
import type { AgentDeps, AgentSession } from "@/lib/agent/tools";
import { ESM_LOCK_PATH, PACKAGE_JSON_PATH } from "@/lib/apps/npm/paths";

const APP = { catalogo: "2026-11", entrada: "/src/main.tsx" };
const session = (app: typeof APP | null) => ({ projectId: "p1", userId: "u1", app, autor: "len" }) as unknown as AgentSession;
const label = (detail: string) => ({ label: `npm ${detail}`, source: "chat" as const });

function depsWith(files: Record<string, string>) {
  const saveProjectFile = vi.fn(async () => ({ versionPrevia: null }));
  const installPackages = vi.fn(async () => ({
    files: { [PACKAGE_JSON_PATH]: '{"dependencies":{"tiny":"^1.0.0"}}\n', [ESM_LOCK_PATH]: '{"lockfileVersion":1,"packages":{}}\n' },
    notes: [{ severity: "Info" as const, message: "Installed tiny@1.0.0 from npm (esm.sh)." }],
    installed: ["tiny@1.0.0"],
  }));
  const deps = { projectFiles: vi.fn(async () => files), saveProjectFile, installPackages } as unknown as AgentDeps;
  return { deps, saveProjectFile, installPackages };
}

describe("installPackagesAfterSave", () => {
  it("installs what a saved source imports, saves package.json and the lock as versions, and tells Len", async () => {
    const { deps, saveProjectFile, installPackages } = depsWith({ "/src/main.tsx": `import tiny from "tiny";\nexport default tiny;` });
    const r = await installPackagesAfterSave(session(APP), deps, label);
    expect(installPackages).toHaveBeenCalledWith(expect.any(Object), APP, { add: [{ name: "tiny", range: null, subpaths: [""] }], remove: [] });
    expect(saveProjectFile.mock.calls.map((c) => (c as unknown[])[1])).toEqual([PACKAGE_JSON_PATH, ESM_LOCK_PATH]);
    expect((saveProjectFile.mock.calls[0] as unknown[])[3]).toMatchObject({ label: "npm install tiny" });
    expect(r.notes).toEqual([{ ruta: PACKAGE_JSON_PATH, linea: 1, columna: 1, gravedad: "Info", mensaje: "Installed tiny@1.0.0 from npm (esm.sh).", codigo: "npm", fuente: "npm" }]);
    expect(r.packageJson).toContain("tiny");
  });

  it("nothing pending → nothing called", async () => {
    const { deps, installPackages } = depsWith({ "/src/main.tsx": `import { useState } from "react";\nexport default useState;` });
    expect(await installPackagesAfterSave(session(APP), deps, label)).toEqual({ notes: [], packageJson: null });
    expect(installPackages).not.toHaveBeenCalled();
  });

  it("a page (no app) never installs", async () => {
    const { deps, installPackages } = depsWith({ "/js/a.js": `import x from "tiny";` });
    await installPackagesAfterSave(session(null), deps, label);
    expect(installPackages).not.toHaveBeenCalled();
  });
});
