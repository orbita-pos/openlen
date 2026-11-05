// «RESTAURAR» (spec local 2026-11-04-herramientas-hechas-por-len, §4.2): DeepSeek's Restore checks the retained copy
// again and reinstalls it without running the Creator — from the Tools page and from a «Crear» card alike.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { restoreInstallation } = await import("./restore");

const row = { id: "inst-1", personId: "u1", releaseSha: "sha", iconPath: "/icon.svg" };

function deps(over: Partial<Parameters<typeof restoreInstallation>[2] & object> = {}) {
  return {
    installationById: vi.fn(async () => row as never),
    readRelease: vi.fn(async () => ({ "/index.html": { content: "<html>" }, "/icon.svg": { content: "<svg/>" } }) as never),
    markRestored: vi.fn(async () => true),
    ...over,
  };
}

describe("restoreInstallation", () => {
  it("its release still whole: restored", async () => {
    const d = deps();
    expect(await restoreInstallation("inst-1", "u1", d)).toBe("restored");
    expect(d.markRestored).toHaveBeenCalledWith("inst-1", "u1");
  });

  it("someone else's, or gone: not_found, nothing restored", async () => {
    const d = deps();
    expect(await restoreInstallation("inst-1", "u2", d)).toBe("not_found");
    expect(await restoreInstallation("inst-1", "u1", deps({ installationById: vi.fn(async () => null) }))).toBe("not_found");
    expect(d.markRestored).not.toHaveBeenCalled();
  });

  it("its release lost its shell or its icon: release_gone, nothing restored", async () => {
    const d = deps({ readRelease: vi.fn(async () => ({ "/index.html": { content: "<html>" } }) as never) });
    expect(await restoreInstallation("inst-1", "u1", d)).toBe("release_gone");
    expect(d.markRestored).not.toHaveBeenCalled();
  });
});
