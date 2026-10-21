// @vitest-environment node
import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { BridgeHandlers } from "./bridge";
import type { SandboxHandle } from "./driver";
import { fakeDriver, type FakeRun } from "./fake-driver";
import { NEVER_IN_BOX } from "./paths";
import { SandboxTerminal, readOnlySource } from "./sandbox-terminal";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

async function open(o: {
  projectFiles: Record<string, string>;
  boxFiles?: Record<string, string>;
  syncedManifest?: Record<string, string>;
  onRun?: FakeRun;
  bridge?: BridgeHandlers;
  readOnly?: Record<string, string> | (() => Record<string, string>);
  signal?: AbortSignal;
}) {
  const readOnly = o.readOnly;
  const d = fakeDriver({ onRun: o.onRun });
  const handle: SandboxHandle = await d.create({ template: "t", metadata: {} });
  for (const [p, t] of Object.entries(o.boxFiles ?? {})) d.files(handle.id).set(p, t);
  const terminal = new SandboxTerminal({
    handle,
    projectFiles: o.projectFiles,
    syncedManifest: o.syncedManifest ?? {},
    bridge: o.bridge ?? {},
    readOnly: async () => (typeof readOnly === "function" ? readOnly() : (readOnly ?? {})),
    startedAt: Date.now(),
    signal: o.signal,
  });
  return { d, handle, terminal, box: () => d.files(handle.id) };
}

describe("SandboxTerminal", () => {
  it("a new box gets the project's files before the first command", async () => {
    const { terminal, box } = await open({ projectFiles: { "/index.html": "<h1>a</h1>", "/home/user/.len/LEN.md": "yo" } });
    await terminal.ejecutar("ls");
    expect(box().get("/index.html")).toBe("<h1>a</h1>");
    expect(box().get("/home/user/.len/LEN.md")).toBe("yo");
  });

  it("a file a command writes comes back in ficheros, and the next command sees what the guards left", async () => {
    const { terminal, box } = await open({
      projectFiles: { "/index.html": "<h1>a</h1>" },
      onRun: (cmd, files) => {
        if (cmd.includes("echo hola > /nota.txt")) files.set("/nota.txt", "hola\n");
        if (cmd.includes("rm /index.html")) files.delete("/index.html");
      },
    });
    const r = await terminal.ejecutar("echo hola > /nota.txt");
    expect(r.ficheros).toEqual({ "/index.html": "<h1>a</h1>", "/nota.txt": "hola\n" });
    const r2 = await terminal.ejecutar("rm /index.html");
    expect(r2.ficheros).toEqual({ "/nota.txt": "hola\n" });
    // The guard refused the delete: herramienta.ts puts the page back.
    await terminal.poner({ "/index.html": "<h1>a</h1>" });
    expect(box().get("/index.html")).toBe("<h1>a</h1>");
    const r3 = await terminal.ejecutar("ls");
    expect(r3.ficheros).toEqual({ "/index.html": "<h1>a</h1>", "/nota.txt": "hola\n" });
  });

  it("what changed in the box before it paused comes back in the first command", async () => {
    const { terminal } = await open({
      projectFiles: { "/index.html": "a" },
      boxFiles: { "/index.html": "a", "/log.txt": "from a background job" },
      syncedManifest: { "/index.html": sha("a") },
    });
    const r = await terminal.ejecutar("true");
    expect(r.ficheros).toEqual({ "/index.html": "a", "/log.txt": "from a background job" });
  });

  it("a file changed in the saved copy and in the box since the last sync keeps the saved version and says so", async () => {
    const { terminal, box } = await open({
      projectFiles: { "/index.html": "user-edit" },
      boxFiles: { "/index.html": "box-edit" },
      syncedManifest: { "/index.html": sha("v1") },
    });
    const r = await terminal.ejecutar("cat /index.html");
    expect(box().get("/index.html")).toBe("user-edit");
    expect(r.ficheros).toEqual({ "/index.html": "user-edit" });
    expect(r.stderr).toContain("/index.html: kept the saved version; the box's change was dropped");
  });

  it("a binary or oversized file is not saved, is listed in noGuardados, and the rest still syncs", async () => {
    const big = "x".repeat(1024 * 1024 + 1);
    const { terminal, d, handle } = await open({
      projectFiles: { "/index.html": "a" },
      onRun: (cmd, files) => {
        if (cmd.includes("make")) {
          files.set("/data/x.zip", "PK\u0003\u0004");
          files.set("/data/big.csv", big);
          files.set("/data/ok.csv", "a,b\n");
        }
      },
    });
    const ran = terminal.ejecutar("make");
    // The fake has to know which files are binary before they are read.
    d.binary(handle.id, "/data/x.zip", 4);
    const r = await ran;
    expect(r.ficheros).toEqual({ "/index.html": "a", "/data/ok.csv": "a,b\n" });
    expect(r.noGuardados).toEqual([
      { ruta: "/data/big.csv", motivo: "too_large" },
      { ruta: "/data/x.zip", motivo: "binary" },
    ]);
    // A file over the cap is never downloaded into the app's process: one of gigabytes would take it down.
    expect(d.reads(handle.id)).not.toContain("/data/big.csv");
  });

  it("the read-only folder goes up once; after that only what changed, and what is gone is removed", async () => {
    let ro: Record<string, string> = { "/.openlen/docs/a.md": "a", "/.openlen/versiones/v1/index.html": "v1" };
    const { terminal, handle, box } = await open({ projectFiles: { "/index.html": "x" }, readOnly: () => ro });
    await terminal.ejecutar("true");
    expect(box().get(readOnlySource("/.openlen/versiones/v1/index.html"))).toBe("v1");
    const write = vi.spyOn(handle, "write");
    const written = () => write.mock.calls.flatMap((c) => Object.keys(c[0]));
    await terminal.refrescarPerezosos();
    expect(written()).toEqual([]);
    ro = { "/.openlen/docs/a.md": "a", "/.openlen/versiones/v2/index.html": "v2" };
    await terminal.refrescarPerezosos();
    expect(written()).toEqual([readOnlySource("/.openlen/versiones/v2/index.html")]);
    expect(box().has(readOnlySource("/.openlen/versiones/v1/index.html"))).toBe(false);
  });

  it("visitor data is never written to the box; its folders say how to read it", async () => {
    const { terminal, box } = await open({
      projectFiles: { "/index.html": "a" },
      readOnly: {
        "/.openlen/docs/apps.md": "docs",
        "/.openlen/bandeja/formularios.jsonl": '{"nombre":"Ana"}',
        "/.openlen/resultados/visitas.json": "{}",
      },
    });
    await terminal.ejecutar("ls");
    const source = readOnlySource("");
    const visitor = [...box().keys()].filter((p) => p.startsWith(source) && NEVER_IN_BOX.test(p.slice(source.length)));
    expect(visitor.sort()).toEqual([readOnlySource("/.openlen/bandeja/README.txt"), readOnlySource("/.openlen/resultados/README.txt")]);
    expect(box().get(readOnlySource("/.openlen/docs/apps.md"))).toBe("docs");
    expect(box().get(readOnlySource("/.openlen/bandeja/README.txt"))).toContain("list_form_submissions");
  });

  it("/.openlen is a read-only mount of what goes up, like the sandbox's ro-bind: writing there fails with EROFS", async () => {
    const { terminal, d, handle, box } = await open({ projectFiles: { "/index.html": "a" }, readOnly: { "/.openlen/docs/a.md": "a" } });
    await terminal.ejecutar("true");
    await terminal.refrescarPerezosos();
    const mounts = d.commands(handle.id).filter((c) => c.includes("mount --bind"));
    expect(mounts).toHaveLength(1);
    expect(mounts[0]).toContain(`mount --bind ${readOnlySource("/.openlen")} /.openlen`);
    expect(mounts[0]).toContain("remount,bind,ro /.openlen");
    expect([...box().keys()].some((p) => p.startsWith("/.openlen/"))).toBe(false);
  });

  it("in an app, /node_modules (its types, read-only today) is mounted the same way", async () => {
    const { terminal, d, handle } = await open({
      projectFiles: { "/index.html": "a" },
      readOnly: { "/.openlen/docs/a.md": "a", "/node_modules/react/package.json": "{}" },
    });
    await terminal.ejecutar("true");
    expect(d.commands(handle.id).some((c) => c.includes("remount,bind,ro /node_modules"))).toBe(true);
  });

  it("if the box refuses the mount, the files go where Len reads them, as before", async () => {
    const { terminal, box } = await open({
      projectFiles: { "/index.html": "a" },
      readOnly: { "/.openlen/docs/a.md": "a" },
      onRun: (cmd) => (cmd.includes("mount --bind") ? { exitCode: 32, stderr: "mount: permission denied" } : undefined),
    });
    await terminal.ejecutar("true");
    expect(box().get("/.openlen/docs/a.md")).toBe("a");
  });

  it("a bridge request is answered while the command runs, and its files are in the box before the response", async () => {
    const git = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0, write: { "/index.html": "<h1>vieja</h1>" } }));
    let seenBeforeAnswer: string | undefined;
    const { terminal } = await open({
      projectFiles: { "/index.html": "<h1>nueva</h1>" },
      bridge: { git },
      onRun: async (cmd, files) => {
        if (!cmd.includes("git restore")) return;
        files.set("/run/openlen/requests/r1.json", JSON.stringify({ id: "r1", program: "git", args: ["restore", "index.html"], cwd: "/" }));
        for (let i = 0; i < 200 && !files.has("/run/openlen/responses/r1.json"); i++) await new Promise((r) => setTimeout(r, 10));
        seenBeforeAnswer = files.get("/index.html");
        const answer = JSON.parse(files.get("/run/openlen/responses/r1.json")!);
        return { stdout: answer.stdout, exitCode: answer.exitCode };
      },
    });
    const r = await terminal.ejecutar("git restore index.html");
    expect(git).toHaveBeenCalledWith(["restore", "index.html"], "/", { "/index.html": "<h1>nueva</h1>" });
    expect(seenBeforeAnswer).toBe("<h1>vieja</h1>");
    expect(r.ficheros).toEqual({ "/index.html": "<h1>vieja</h1>" });
  });

  it("an unreadable request is answered with an error, and the bridge keeps serving the next one", async () => {
    const git = vi.fn(async () => ({ stdout: "On branch main\n", stderr: "", exitCode: 0 }));
    const answers: Record<string, { stderr?: string; stdout?: string; exitCode: number }> = {};
    const { terminal } = await open({
      projectFiles: { "/index.html": "a" },
      bridge: { git },
      onRun: async (cmd, files) => {
        if (!cmd.includes("two")) return;
        files.set("/run/openlen/requests/bad.json", "{not json");
        files.set("/run/openlen/requests/r2.json", JSON.stringify({ id: "r2", program: "git", args: ["status"], cwd: "/" }));
        for (let i = 0; i < 200 && !(files.has("/run/openlen/responses/bad.json") && files.has("/run/openlen/responses/r2.json")); i++)
          await new Promise((r) => setTimeout(r, 10));
        for (const id of ["bad", "r2"]) answers[id] = JSON.parse(files.get(`/run/openlen/responses/${id}.json`)!);
      },
    });
    await terminal.ejecutar("two requests");
    expect(answers.bad).toMatchObject({ exitCode: 1 });
    expect(answers.bad!.stderr).toMatch(/unreadable/);
    expect(answers.r2).toMatchObject({ stdout: "On branch main\n", exitCode: 0 });
  });

  it("a handler that fails answers its own command with the error; the bridge goes on", async () => {
    const answers: Record<string, { stderr?: string; exitCode: number }> = {};
    const { terminal } = await open({
      projectFiles: { "/index.html": "a" },
      bridge: { git: async () => Promise.reject(new Error("repository locked")) },
      onRun: async (cmd, files) => {
        if (!cmd.includes("git log")) return;
        files.set("/run/openlen/requests/r1.json", JSON.stringify({ id: "r1", program: "git", args: ["log"], cwd: "/" }));
        for (let i = 0; i < 200 && !files.has("/run/openlen/responses/r1.json"); i++) await new Promise((r) => setTimeout(r, 10));
        answers.r1 = JSON.parse(files.get("/run/openlen/responses/r1.json")!);
      },
    });
    await terminal.ejecutar("git log");
    expect(answers.r1).toMatchObject({ exitCode: 1 });
    expect(answers.r1!.stderr).toContain("repository locked");
  });

  it("aborting the turn ends a command that waits on the bridge, without hanging", async () => {
    const ctrl = new AbortController();
    const { terminal } = await open({
      projectFiles: { "/index.html": "a" },
      bridge: { git: () => new Promise<never>(() => {}) },
      signal: ctrl.signal,
      onRun: async (cmd, files) => {
        if (!cmd.includes("git status")) return;
        files.set("/run/openlen/requests/r1.json", JSON.stringify({ id: "r1", program: "git", args: ["status"], cwd: "/" }));
        await new Promise(() => {});
      },
    });
    const started = Date.now();
    const ran = terminal.ejecutar("git status");
    setTimeout(() => ctrl.abort(), 50);
    const r = await ran;
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(r.exitCode).toBe(130);
    expect(r.ficheros).toBeNull();
  });

  it("the working directory and the variables carry to the next command", async () => {
    const scripts: string[] = [];
    const { terminal } = await open({
      projectFiles: {},
      onRun: (cmd, files) => {
        scripts.push(cmd);
        if (cmd.includes("cd /src")) files.set("/run/openlen/cwd", "/src\n");
      },
    });
    await terminal.ejecutar("cd /src");
    await terminal.ejecutar("pwd");
    const last = scripts.filter((s) => s.includes("pwd")).at(-1)!;
    expect(last).toContain(`cd '/src'`);
    expect(last).toContain(". /run/openlen/env");
    expect(last).toContain("export PATH=/opt/openlen/bin:");
  });

  it("counts the seconds the box ran and pauses on close", async () => {
    const { terminal, d, handle } = await open({ projectFiles: {} });
    await terminal.ejecutar("true");
    await terminal.cerrar();
    expect(d.paused(handle.id)).toBe(true);
    expect(terminal.runningSeconds()).toBeGreaterThanOrEqual(0);
    expect(terminal.runningSeconds()).toBeLessThan(5);
  });

  it("pendingChanges gives what the box changed since the last command without running anything", async () => {
    const { terminal, box } = await open({ projectFiles: { "/index.html": "a" } });
    await terminal.ejecutar("true");
    box().set("/out.txt", "written in the background");
    box().delete("/index.html");
    expect(await terminal.pendingChanges()).toEqual({ "/index.html": null, "/out.txt": "written in the background" });
  });
});
