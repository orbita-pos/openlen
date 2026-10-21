// @vitest-environment node
import { describe, expect, it } from "vitest";

import { BACKGROUND_STOPS_AT_THE_END, backgroundFinished } from "./background-text";
import type { SandboxHandle } from "./driver";
import { fakeDriver, type FakeRun } from "./fake-driver";
import { SandboxTerminal } from "./sandbox-terminal";

async function open(onRun?: FakeRun) {
  const d = fakeDriver({ onRun });
  const handle: SandboxHandle = await d.create({ template: "t", metadata: {} });
  const terminal = new SandboxTerminal({
    handle,
    projectFiles: { "/index.html": "a" },
    syncedManifest: {},
    bridge: {},
    readOnly: async () => ({}),
    startedAt: Date.now(),
  });
  return { d, handle, terminal, box: () => d.files(handle.id) };
}

describe("background commands in the box", () => {
  it("a command over its timeout moves to the background, says where its output goes, and its changes still sync", async () => {
    const { terminal } = await open((cmd, files) => {
      if (cmd.includes("npm run build-docs")) {
        files.set("/docs/a.html", "<h1>a</h1>");
        return { timedOut: true, pid: 42 };
      }
    });
    const r = await terminal.ejecutar("npm run build-docs", { timeoutMs: 2_000 });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("did not finish within 2s");
    expect(r.stdout).toContain("background as job b1");
    expect(r.stdout).toContain("/tmp/bash-tasks/b1.output");
    expect(r.stdout).toContain(BACKGROUND_STOPS_AT_THE_END);
    expect(r.ficheros).toEqual({ "/index.html": "a", "/docs/a.html": "<h1>a</h1>" });
  });

  it("run_in_background answers at once with the job's ID and its output path", async () => {
    const started: boolean[] = [];
    const { terminal } = await open((_cmd, _files, o) => {
      started.push(o.background === true);
      return o.background ? { pid: 7 } : undefined;
    });
    const r = await terminal.ejecutar("python3 -m http.server 8000", { background: true });
    expect(started.at(-1)).toBe(true);
    expect(r.stdout).toContain("Started in the background as job b1");
    expect(r.stdout).toContain("/tmp/bash-tasks/b1.output");
    expect(r.exitCode).toBe(0);
  });

  it("a background command that ends during the turn is announced once", async () => {
    const { terminal, box } = await open((_cmd, _files, o) => (o.background ? { pid: 7 } : undefined));
    await terminal.ejecutar("sleep 5; echo done", { background: true });
    expect(await terminal.finishedBackground()).toEqual([]);
    box().set("/tmp/bash-tasks/b1.exit", "0\n");
    const notices = await terminal.finishedBackground();
    expect(notices).toEqual([backgroundFinished({ id: "b1", command: "sleep 5; echo done", exitCode: 0, outputPath: "/tmp/bash-tasks/b1.output" })]);
    expect(notices[0]).toContain("background job b1 (bash: sleep 5; echo done) finished [status: completed, exit code 0]");
    expect(await terminal.finishedBackground()).toEqual([]);
  });

  it("a failing background command is announced as failed", async () => {
    const { terminal, box } = await open((_cmd, _files, o) => (o.background ? { pid: 7 } : undefined));
    await terminal.ejecutar("false", { background: true });
    box().set("/tmp/bash-tasks/b1.exit", "1\n");
    expect((await terminal.finishedBackground())[0]).toContain("[status: failed, exit code 1]");
  });

  it("closing the turn kills what still runs in the background", async () => {
    const { terminal, d, handle } = await open((_cmd, _files, o) => (o.background ? { pid: 7 } : undefined));
    await terminal.ejecutar("python3 -m http.server", { background: true });
    await terminal.killBackground();
    expect(d.commands(handle.id).some((c) => c.includes("kill") && c.includes("7"))).toBe(true);
    // Killed jobs are not announced.
    expect(await terminal.finishedBackground()).toEqual([]);
  });
});
