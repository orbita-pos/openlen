// @vitest-environment node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { BridgeHandlers } from "./bridge";
import type { SandboxHandle } from "./driver";
import { fakeDriver, type FakeRun } from "./fake-driver";
import { NEVER_IN_BOX } from "./paths";
import { BASE_ENV_FILE, SandboxTerminal, readOnlySource } from "./sandbox-terminal";
import { PLAYWRIGHT_RESOLVER } from "./template-files";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
// A POSIX shell, as the box's (Git's on Windows); without one, the shell test is skipped.
const SH = spawnSync("sh", ["-c", "printf ok"], { encoding: "utf8" }).stdout === "ok" ? "sh" : null;

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

describe("SandboxTerminal — what every opening sets up for Playwright", () => {
  it("puts E2B's proxy authority in Chromium's own store, only when its fingerprint changed", async () => {
    const { terminal, d, handle } = await open({ projectFiles: { "/index.html": "a" } });
    await terminal.ejecutar("true");
    const ran = d.commands(handle.id);
    const before = ran.slice(0, ran.findIndex((c) => c.includes("bash-tasks")));
    const ca = before.find((c) => c.includes("certutil"));
    expect(ca).toBeDefined();
    expect(ca).toContain("/usr/local/share/ca-certificates/e2b-ca.crt");
    expect(ca).toContain("sha256sum");
    expect(ca).toContain("sql:$HOME/.pki/nssdb");
  });

  it("the base environment: Playwright's browsers and package, the authority for Node and Python, BASE_URL", async () => {
    const d = fakeDriver();
    const handle = await d.create({ template: "t", metadata: {} });
    const terminal = new SandboxTerminal({
      handle,
      projectFiles: { "/index.html": "a" },
      syncedManifest: {},
      bridge: {},
      readOnly: async () => ({}),
      startedAt: Date.now(),
      baseEnv: { BASE_URL: "https://lienzo-x.openlen.app" },
    });
    await terminal.ejecutar("true");
    const env = d.files(handle.id).get(BASE_ENV_FILE)!;
    expect(env).toContain("export PLAYWRIGHT_BROWSERS_PATH='/opt/openlen/ms-playwright'");
    expect(env).toContain("export NODE_PATH='/opt/openlen/playwright/node_modules'");
    expect(env).toContain("export REQUESTS_CA_BUNDLE='/etc/ssl/certs/ca-certificates.crt'");
    expect(env).toContain("NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/e2b-ca.crt");
    expect(env).toContain("export BASE_URL='https://lienzo-x.openlen.app'");
    expect(env).toContain(`--require=${PLAYWRIGHT_RESOLVER}`);
    const run = d.commands(handle.id).find((c) => c.includes("bash-tasks") && c.includes("true"))!;
    // The platform's values win over the shell's carried ones.
    expect(run.indexOf(`. ${BASE_ENV_FILE}`)).toBeGreaterThan(run.indexOf("/run/openlen/env"));
  });

  // Every command sources it after the shell's carried variables, which already hold the last value.
  it.skipIf(!SH)("🔴 NODE_OPTIONS gets Playwright's resolver once, after what the shell had, and only if the template has it", async () => {
    const d = fakeDriver();
    const handle = await d.create({ template: "t", metadata: {} });
    const terminal = new SandboxTerminal({ handle, projectFiles: {}, syncedManifest: {}, bridge: {}, readOnly: async () => ({}), startedAt: Date.now() });
    await terminal.ejecutar("true");
    const dir = mkdtempSync(join(tmpdir(), "openlen-base-env-"));
    const here = join(dir, "resolver.cjs").replace(/\\/g, "/");
    writeFileSync(here, "");
    const envFile = join(dir, "base.env");
    const source = (resolver: string) => {
      writeFileSync(envFile, d.files(handle.id).get(BASE_ENV_FILE)!.split(PLAYWRIGHT_RESOLVER).join(resolver));
      const f = envFile.replace(/\\/g, "/");
      return spawnSync(SH!, ["-c", `NODE_OPTIONS=--max-old-space-size=99; . '${f}'; . '${f}'; printf %s "$NODE_OPTIONS"`], { encoding: "utf8" }).stdout;
    };
    expect(source(here)).toBe(`--max-old-space-size=99 --require=${here}`);
    expect(source(`${dir.replace(/\\/g, "/")}/missing.cjs`)).toBe("--max-old-space-size=99");
  });
});

describe("SandboxTerminal — opening fast", () => {
  // OFFICE FILES (spec local 2026-10-26-len-skills, §4.8): what the person attached is in the box,
  // read-only, at the path the message names, so a skill's Python opens it.
  it("the box gets the session's attachments as read-only bytes at their path", async () => {
    const d = fakeDriver();
    const handle = await d.create({ template: "t", metadata: {} });
    const bytes = new Uint8Array([0x50, 0x4b, 3, 4, 9, 9]);
    const terminal = new SandboxTerminal({
      handle,
      projectFiles: { "/index.html": "a" },
      syncedManifest: {},
      bridge: {},
      readOnly: async () => ({}),
      readOnlyBytes: async () => ({ "/.openlen/attachments/abc123/ventas.xlsx": bytes }),
      startedAt: Date.now(),
      fresh: true,
    });
    await terminal.ejecutar("true");
    const at = [...d.bytesOf(handle.id).keys()].find((p) => p.endsWith("/.openlen/attachments/abc123/ventas.xlsx"));
    expect(at).toBeDefined();
    expect([...d.bytesOf(handle.id).get(at!)!]).toEqual([...bytes]);
    // A second command does not upload it again.
    const writeBytes = vi.spyOn(handle, "writeBytes" as never);
    await terminal.ejecutar("true");
    expect(writeBytes).not.toHaveBeenCalled();
  });

  it("readFileBytes gives a file the box made, as bytes; nothing for one that is not there", async () => {
    const { terminal, d, handle } = await open({ projectFiles: { "/index.html": "a" } });
    await terminal.ejecutar("true");
    await handle.writeBytes!({ "/tmp/office/a.xlsx": new Uint8Array([1, 2, 3]) });
    expect([...(await terminal.readFileBytes("/tmp/office/a.xlsx"))!]).toEqual([1, 2, 3]);
    expect(await terminal.readFileBytes("/tmp/office/nada.xlsx")).toBeNull();
    expect(d.reads(handle.id)).toBeDefined();
  });

  // Claude Code's Read reads the real disk; Len's reads the box, so reading a file of it starts it
  // as a command would (spec local 2026-10-27-len-pdf-skill). Before, a file left by an earlier turn
  // "did not exist" until the first command.
  it("readFileBytes and fileSize open the box when no command has run yet", async () => {
    const { terminal, handle } = await open({ projectFiles: { "/index.html": "a" } });
    await handle.writeBytes!({ "/tmp/office/crop.png": new Uint8Array([1, 2, 3, 4]) });
    expect(terminal.arrancada).toBe(false);
    expect(await terminal.fileSize("/tmp/office/crop.png")).toBe(4);
    expect(terminal.arrancada).toBe(true);
    expect([...(await terminal.readFileBytes("/tmp/office/crop.png"))!]).toEqual([1, 2, 3, 4]);
    expect(await terminal.fileSize("/tmp/office/nada.png")).toBeNull();
  });

  it("a box just created from the template has nothing of the project: no manifest before the first command", async () => {
    const d = fakeDriver();
    const handle = await d.create({ template: "t", metadata: {} });
    const terminal = new SandboxTerminal({
      handle,
      projectFiles: { "/index.html": "a" },
      syncedManifest: {},
      bridge: {},
      readOnly: async () => ({ "/.openlen/docs/a.md": "a" }),
      startedAt: Date.now(),
      fresh: true,
    });
    await terminal.ejecutar("true");
    const ran = d.commands(handle.id);
    const firstRun = ran.findIndex((c) => c.includes("bash-tasks"));
    expect(ran.slice(0, firstRun).some((c) => c.endsWith("openlen-manifest"))).toBe(false);
    expect(d.files(handle.id).get("/index.html")).toBe("a");
  });

  it("a large read-only set (an app's types) goes up as one compressed bundle, unpacked in the box", async () => {
    const ro: Record<string, string> = {};
    for (let i = 0; i < 120; i++) ro[`/node_modules/pkg${i}/index.d.ts`] = `export declare const v${i}: number;\n`;
    const { terminal, handle, box } = await open({ projectFiles: { "/index.html": "a" }, readOnly: ro });
    const write = vi.spyOn(handle, "write");
    await terminal.ejecutar("true");
    const readOnlyWrites = write.mock.calls.flatMap((c) => Object.keys(c[0])).filter((p) => p.includes("/node_modules/"));
    expect(readOnlyWrites).toEqual([]);
    expect(box().get(readOnlySource("/node_modules/pkg7/index.d.ts"))).toBe("export declare const v7: number;\n");
  });

  it("a resumed box only gets what changed in the read-only folder since the last turn", async () => {
    const d = fakeDriver();
    const handle = await d.create({ template: "t", metadata: {} });
    const ro = { "/.openlen/docs/a.md": "a", "/.openlen/docs/b.md": "b" };
    const opts = { handle, projectFiles: { "/index.html": "a" }, bridge: {}, readOnly: async () => ro, startedAt: Date.now() };
    const first = new SandboxTerminal({ ...opts, syncedManifest: {}, fresh: true });
    await first.ejecutar("true");
    const next = new SandboxTerminal({ ...opts, syncedManifest: first.syncedManifest() });
    const write = vi.spyOn(handle, "write");
    await next.ejecutar("true");
    const written = write.mock.calls.flatMap((c) => Object.keys(c[0])).filter((p) => p.includes("/.openlen/"));
    expect(written).toEqual([]);
  });

  it("a resumed box prepares the mailbox and reads its manifest in one command", async () => {
    const { terminal, d, handle } = await open({ projectFiles: { "/index.html": "a" }, boxFiles: { "/index.html": "a" } });
    await terminal.ejecutar("true");
    const ran = d.commands(handle.id);
    const firstRun = ran.findIndex((c) => c.includes("bash-tasks"));
    const before = ran.slice(0, firstRun).filter((c) => !c.includes("mount --bind"));
    expect(before).toHaveLength(1);
    expect(before[0]).toContain("mkdir -p /run/openlen/requests");
    expect(before[0]).toContain("openlen-manifest");
  });
});

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
    // The box's own list of what it has (.uploaded.json) is written with each change; not a read-only file.
    const written = () => write.mock.calls.flatMap((c) => Object.keys(c[0])).filter((p) => !p.endsWith("/.uploaded.json"));
    await terminal.refrescarPerezosos();
    expect(written()).toEqual([]);
    ro = { "/.openlen/docs/a.md": "a", "/.openlen/versiones/v2/index.html": "v2" };
    await terminal.refrescarPerezosos();
    expect(written()).toEqual([readOnlySource("/.openlen/versiones/v2/index.html")]);
    expect(box().has(readOnlySource("/.openlen/versiones/v1/index.html"))).toBe(false);
  });

  // Measured 21/10 in a real box: the files of a version that rolled off went, its folders stayed, and
  // `ls /.openlen/versiones` listed a v1 that no longer exists.
  it("🔴 a folder none of whose files stays goes whole: no empty v1 for Len to list, and never a tree's root", async () => {
    let ro: Record<string, string> = {
      "/.openlen/docs/a.md": "a",
      "/.openlen/versiones/v1/index.html": "v1",
      "/.openlen/versiones/v1/sobre/index.html": "v1s",
      "/.openlen/versiones/v2/index.html": "v2",
      "/.openlen/versiones/v2/a.css": "c",
      "/node_modules/react/index.d.ts": "d",
    };
    const { terminal, handle, box } = await open({ projectFiles: { "/index.html": "x" }, readOnly: () => ro });
    await terminal.ejecutar("true");
    const remove = vi.spyOn(handle, "remove");
    ro = { "/.openlen/docs/a.md": "a", "/.openlen/versiones/v2/index.html": "v2", "/.openlen/versiones/v3/index.html": "v3" };
    await terminal.refrescarPerezosos();
    expect(remove.mock.calls.flatMap((c) => c[0]).sort()).toEqual(
      [readOnlySource("/.openlen/versiones/v1"), readOnlySource("/.openlen/versiones/v2/a.css"), readOnlySource("/node_modules/react")].sort(),
    );
    expect([...box().keys()].filter((p) => p.includes("/versiones/v1"))).toEqual([]);
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
