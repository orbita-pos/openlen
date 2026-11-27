// @vitest-environment node
// The gates an install goes through, shared by a tool's install and a plain app's install on the desktop
// (spec local 2026-11-26-apps-en-el-escritorio, §4.2). Fake dependencies write down the order of the calls.
import { describe, expect, it, vi } from "vitest";

import { AppNoCompilaError } from "@/lib/apps/compilador";
import { DataChangesNeedConfirmationError } from "@/lib/backend/data-changes";

import { installThroughGates, type CoreDeps } from "./install-core";

const RELEASE_FILES = { "/index.html": { content: "x", contentType: "text/html" } };
const MCP = { serverName: "calc", function: "mcp", tools: [] };

function setup(over: Partial<CoreDeps> = {}) {
  const order: string[] = [];
  const mark =
    <A extends unknown[], R>(name: string, result: R) =>
    async (..._args: A): Promise<R> => {
      order.push(name);
      return result;
    };
  const d: CoreDeps = {
    securityGate: vi.fn(mark("gate", { fingerprint: "fp1" })),
    entorno: vi.fn(mark("entorno", { PUBLIC_X: "1" })),
    build: vi.fn(mark("build", { sha: "sha1", files: RELEASE_FILES, jobFiles: { "/jobs/a.py": "print(1)" } })),
    prepareFunctions: vi.fn(
      mark("functions", {
        deploy: async () => void order.push("deploy"),
      }),
    ),
    dataChanges: vi.fn(mark("data", undefined)),
    saveRelease: vi.fn(mark("save", undefined)),
    markPublished: vi.fn(mark("markPublished", undefined)),
    ...over,
  };
  return { d, order };
}

const INPUT = {
  projectId: "p1",
  actorId: "u1",
  locale: "es",
  html: "<div id=root></div>",
  files: { "/src/main.tsx": "x" },
  app: { catalogo: "2026-11", entrada: "/src/main.tsx" },
  iconPath: "/icon.svg",
};

describe("installThroughGates", () => {
  it("runs gate, build, functions, data, deploy, afterDeploy, save, markPublished in order", async () => {
    const { d, order } = setup();
    const afterDeploy = vi.fn(async (_deployed: boolean) => (order.push("afterDeploy"), MCP));

    const r = await installThroughGates({ ...INPUT, afterDeploy }, d);

    expect(r).toEqual({ ok: true, releaseSha: "sha1", files: RELEASE_FILES });
    expect(order).toEqual(["gate", "entorno", "build", "functions", "data", "deploy", "afterDeploy", "save", "markPublished"]);
    expect(afterDeploy).toHaveBeenCalledWith(true);
    expect(d.build).toHaveBeenCalledWith({
      projectId: "p1",
      html: INPUT.html,
      files: INPUT.files,
      app: INPUT.app,
      entorno: { PUBLIC_X: "1" },
      iconPath: "/icon.svg",
    });
    expect(d.saveRelease).toHaveBeenCalledWith("sha1", "p1", RELEASE_FILES, { "/jobs/a.py": "print(1)" }, MCP);
    expect(d.markPublished).toHaveBeenCalledWith("p1", "fp1");
  });

  it("the options reach their gates: accept, wait, confirm, copy, skip", async () => {
    const { d } = setup();
    await installThroughGates(
      { ...INPUT, acceptSecurityFingerprint: "afp", waitWhenPending: true, confirmFingerprint: "cfp", copyDraftData: false, skipMissingSecrets: true },
      d,
    );
    expect(d.securityGate).toHaveBeenCalledWith({ projectId: "p1", actorId: "u1", locale: "es", accept: "afp", waitWhenPending: true });
    expect(d.prepareFunctions).toHaveBeenCalledWith("p1", { skipMissingSecrets: true });
    expect(d.dataChanges).toHaveBeenCalledWith({ projectId: "p1", confirmFingerprint: "cfp", copyDraftData: false });
  });

  it("without options, the gates get only what was asked", async () => {
    const { d } = setup();
    await installThroughGates(INPUT, d);
    expect(d.securityGate).toHaveBeenCalledWith({ projectId: "p1", actorId: "u1", locale: "es" });
    expect(d.prepareFunctions).toHaveBeenCalledWith("p1", { skipMissingSecrets: false });
    expect(d.dataChanges).toHaveBeenCalledWith({ projectId: "p1" });
  });

  it("the functions off: afterDeploy hears it was not deployed, and the release is saved with no mcp", async () => {
    const { d } = setup({ prepareFunctions: vi.fn(async () => null) });
    const afterDeploy = vi.fn(async (_deployed: boolean) => null);
    const r = await installThroughGates({ ...INPUT, afterDeploy }, d);
    expect(r.ok).toBe(true);
    expect(afterDeploy).toHaveBeenCalledWith(false);
    expect(d.saveRelease).toHaveBeenCalledWith("sha1", "p1", RELEASE_FILES, { "/jobs/a.py": "print(1)" }, null);
  });

  it("without afterDeploy and without job files: saved with no mcp and no jobs", async () => {
    const { d } = setup({ build: vi.fn(async () => ({ sha: "sha2", files: RELEASE_FILES })) });
    await installThroughGates(INPUT, d);
    expect(d.saveRelease).toHaveBeenCalledWith("sha2", "p1", RELEASE_FILES, {}, null);
  });

  it("no fingerprint from the gate: markPublished is not called", async () => {
    const { d } = setup({ securityGate: vi.fn(async () => ({ fingerprint: null })) });
    const r = await installThroughGates(INPUT, d);
    expect(r.ok).toBe(true);
    expect(d.markPublished).not.toHaveBeenCalled();
  });

  it("markPublished failing only warns: the install is still ok", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const { d } = setup({ markPublished: vi.fn(async () => { throw new Error("db down"); }) });
      const r = await installThroughGates(INPUT, d);
      expect(r).toEqual({ ok: true, releaseSha: "sha1", files: RELEASE_FILES });
      expect(warn).toHaveBeenCalledWith("[tools] could not keep the installed version as the security review's base", expect.any(Error));
    } finally {
      warn.mockRestore();
    }
  });

  // A desktop app's install uses these gates too: its log lines name it, so a failure is not read as a tool's.
  it("a log tag names who installs: the failure and the warning carry it", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const failing = setup({ saveRelease: vi.fn(async () => { throw new Error("disk full"); }) });
      await installThroughGates({ ...INPUT, logTag: "[desktop-apps]" }, failing.d);
      expect(error).toHaveBeenCalledWith("[desktop-apps] install failed:", expect.any(Error));
      const warned = setup({ markPublished: vi.fn(async () => { throw new Error("db down"); }) });
      await installThroughGates({ ...INPUT, logTag: "[desktop-apps]" }, warned.d);
      expect(warn).toHaveBeenCalledWith("[desktop-apps] could not keep the installed version as the security review's base", expect.any(Error));
    } finally {
      error.mockRestore();
      warn.mockRestore();
    }
  });

  it("security stop returns its status and builds nothing", async () => {
    const stop = { status: 428, body: { error: "security_findings", fingerprint: "fp" } };
    const { d } = setup({ securityGate: vi.fn(async () => ({ stop })) });
    const r = await installThroughGates(INPUT, d);
    expect(r).toEqual({ ok: false, status: 428, body: stop.body });
    expect(d.entorno).not.toHaveBeenCalled();
    expect(d.build).not.toHaveBeenCalled();
    expect(d.prepareFunctions).not.toHaveBeenCalled();
    expect(d.dataChanges).not.toHaveBeenCalled();
    expect(d.saveRelease).not.toHaveBeenCalled();
    expect(d.markPublished).not.toHaveBeenCalled();
  });

  it("AppNoCompilaError becomes 422 app_does_not_compile and migrates nothing", async () => {
    const { d } = setup({
      build: vi.fn(async () => {
        throw new AppNoCompilaError([{ ruta: "/src/App.tsx", linea: 3, columna: 1, mensaje: "boom" }]);
      }),
    });
    const r = await installThroughGates(INPUT, d);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(422);
    expect(r.body.error).toBe("app_does_not_compile");
    expect(r.body.errors).toEqual([expect.stringContaining("boom")]);
    expect(d.prepareFunctions).not.toHaveBeenCalled();
    expect(d.dataChanges).not.toHaveBeenCalled();
    expect(d.saveRelease).not.toHaveBeenCalled();
  });

  it("a data-change 428 saves no release", async () => {
    const { d, order } = setup({
      dataChanges: vi.fn(async () => {
        throw new DataChangesNeedConfirmationError([], "dfp");
      }),
    });
    const afterDeploy = vi.fn(async () => null);
    const r = await installThroughGates({ ...INPUT, afterDeploy }, d);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(428);
    expect(d.saveRelease).not.toHaveBeenCalled();
    expect(d.markPublished).not.toHaveBeenCalled();
    expect(afterDeploy).not.toHaveBeenCalled();
    expect(order).not.toContain("deploy");
  });

  it("any other failure is a 500 install_failed, logged", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const { d } = setup({ saveRelease: vi.fn(async () => { throw new Error("disk full"); }) });
      const r = await installThroughGates(INPUT, d);
      expect(r).toEqual({ ok: false, status: 500, body: { error: "install_failed" } });
      expect(d.markPublished).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledWith("[tools] install failed:", expect.any(Error));
    } finally {
      error.mockRestore();
    }
  });
});
