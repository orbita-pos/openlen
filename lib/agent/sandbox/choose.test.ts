// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import type { AgentSession } from "@/lib/agent/tools";
import type { TerminalBackend } from "@/lib/agent/terminal/backend";
import type { SalidaDeUnComando } from "@/lib/agent/terminal/terminal";

import { BOX_STOPPED_NOTICE, LIMITED_TERMINAL_NOTICE, TurnSandbox, closeTurnTerminal, settleTurnTerminal, terminalForTurn, type SandboxStore } from "./choose";
import { fakeDriver } from "./fake-driver";
import { SandboxTerminal } from "./sandbox-terminal";
import type { ProjectSandboxRow } from "./store";

const ENV = { E2B_API_KEY: "k" };

function memoryStore(rows: Record<string, ProjectSandboxRow> = {}): SandboxStore & { rows: Record<string, ProjectSandboxRow> } {
  return {
    rows,
    get: async (p) => rows[p] ?? null,
    hold: async (p, t) => {
      const r = rows[p];
      if (r?.heldBy) return false;
      rows[p] = { ...(r ?? { projectId: p, sandboxId: null, template: null, state: "none", syncedManifest: {}, pausedAt: null }), heldBy: t };
      return true;
    },
    save: async (row) => void (rows[row.projectId] = { ...row, heldBy: rows[row.projectId]?.heldBy ?? null }),
    release: async (p, t) => {
      if (rows[p]?.heldBy === t) rows[p] = { ...rows[p]!, heldBy: null };
    },
  };
}

class LocalTerminal implements TerminalBackend {
  readonly arrancada = true;
  ran: string[] = [];
  closed = false;
  async ejecutar(command: string): Promise<SalidaDeUnComando> {
    this.ran.push(command);
    return { stdout: "local\n", stderr: "", exitCode: 0, ficheros: {} };
  }
  async refrescarPerezosos() {}
  async poner() {}
  async cerrar() {
    this.closed = true;
  }
}

function setup(over: Partial<Parameters<typeof terminalForTurn>[1]> = {}, session: Partial<AgentSession> = {}) {
  const local = new LocalTerminal();
  const s = { projectId: "p", userId: "owner", turnId: "turn-1", ...session } as AgentSession;
  const store = memoryStore();
  const driver = fakeDriver();
  const log = vi.fn();
  const charge = vi.fn(async () => 0);
  const o = {
    local: () => local,
    projectFiles: async () => ({ "/index.html": "a" }),
    readOnly: async () => ({}),
    bridge: async () => ({}),
    env: ENV,
    driver,
    store,
    budgetOk: async () => true,
    log,
    charge,
    ...over,
  };
  return { s, local, store, driver, log, charge, o };
}

describe("terminalForTurn", () => {
  it("off by switch: today's terminal, no notice, nothing logged", async () => {
    const { s, local, o, log } = setup({ env: { OPENLEN_SANDBOX: "0", E2B_API_KEY: "k" } });
    expect(await terminalForTurn(s, o)).toBe(local);
    expect(s.sandboxNotice).toBeUndefined();
    expect(log).not.toHaveBeenCalled();
  });

  it("the user's own terminal (the Code lens) stays today's, as in Claude Code's cloud", async () => {
    const { s, local, o, log } = setup({}, { autor: "usuario" });
    expect(await terminalForTurn(s, o)).toBe(local);
    expect(s.sandboxNotice).toBeUndefined();
    expect(log).not.toHaveBeenCalled();
  });

  it("an account outside OPENLEN_SANDBOX_ONLY_USERS gets today's terminal without a notice", async () => {
    const { s, local, o, log } = setup({ env: { ...ENV, OPENLEN_SANDBOX_ONLY_USERS: "jesus" } });
    expect(await terminalForTurn(s, o)).toBe(local);
    expect(s.sandboxNotice).toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("reason=only_users"));
  });

  it("a project with a system-named folder uses today's terminal with the notice", async () => {
    const { s, local, o, log } = setup({ projectFiles: async () => ({ "/index.html": "a", "/home/index.html": "b" }) });
    expect(await terminalForTurn(s, o)).toBe(local);
    expect(s.sandboxNotice).toBe(LIMITED_TERMINAL_NOTICE);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("reason=conflict"));
  });

  it("a second turn of the same project uses today's terminal while the first holds the box", async () => {
    const a = setup();
    await terminalForTurn(a.s, a.o);
    const second = { ...a.s, turnId: "turn-2" } as AgentSession;
    const local2 = new LocalTerminal();
    expect(await terminalForTurn(second, { ...a.o, local: () => local2 })).toBe(local2);
    expect(second.sandboxNotice).toBe(LIMITED_TERMINAL_NOTICE);
  });

  it("over the daily cap, today's terminal with the notice, and the row is let go", async () => {
    const { s, local, o, store } = setup({ budgetOk: async () => false });
    expect(await terminalForTurn(s, o)).toBe(local);
    expect(s.sandboxNotice).toBe(LIMITED_TERMINAL_NOTICE);
    expect(store.rows.p?.heldBy).toBeNull();
  });

  it("a box that can't be opened falls back with the notice", async () => {
    const { s, local, o } = setup({ driver: { ...fakeDriver(), create: async () => Promise.reject(new Error("E2B down")) } });
    expect(await terminalForTurn(s, o)).toBe(local);
    expect(s.sandboxNotice).toBe(LIMITED_TERMINAL_NOTICE);
  });

  it("opens a box, saves its row as running and seeds the turn's photo with the project", async () => {
    const { s, o, store } = setup();
    const t = await terminalForTurn(s, o);
    expect(t).not.toBeInstanceOf(LocalTerminal);
    expect(store.rows.p).toMatchObject({ state: "running", template: "openlen-terminal-v1", heldBy: "turn-1" });
    expect(s.fotoDeLaTerminal).toEqual({ "/index.html": "a" });
    expect((await t.ejecutar("true")).ficheros).toEqual({ "/index.html": "a" });
  });

  it("resumes the project's paused box with its manifest", async () => {
    const a = setup();
    a.s.terminal = await terminalForTurn(a.s, a.o);
    await a.s.terminal.ejecutar("true");
    await closeTurnTerminal(a.s, { save: async () => {}, store: a.store, charge: a.charge });
    const id = a.store.rows.p!.sandboxId!;
    expect(a.driver.paused(id)).toBe(true);
    const next = { ...a.s, turnId: "turn-2", terminal: undefined } as AgentSession;
    await terminalForTurn(next, a.o);
    expect(a.store.rows.p).toMatchObject({ sandboxId: id, state: "running", heldBy: "turn-2" });
    expect(a.driver.paused(id)).toBe(false);
  });

  it("an error of one command, with the box still answering, is that command's error: the box stays", async () => {
    const driver = fakeDriver({
      onRun: (cmd) => {
        if (cmd.includes("weird")) throw new Error("manifest unreadable");
      },
    });
    const { s, local, o } = setup({ driver });
    s.terminal = await terminalForTurn(s, o);
    const r = await s.terminal.ejecutar("weird");
    expect(r).toMatchObject({ exitCode: 1, ficheros: null });
    expect(r.stderr).toContain("manifest unreadable");
    expect(s.sandboxNotice).toBeUndefined();
    await s.terminal.ejecutar("ls");
    expect(local.ran).toEqual([]);
  });

  it("the box dies mid-command: that command reports it, the next ones run in today's terminal, and only the seconds it ran are charged", async () => {
    let now = 1_000_000;
    let gone = false;
    const driver = fakeDriver({
      onRun: (cmd) => {
        if (cmd.includes("boom")) gone = true;
        if (gone) throw new Error("sandbox not found");
      },
    });
    const { s, local, o, store, charge } = setup({ driver, now: () => now });
    s.terminal = await terminalForTurn(s, o);
    now += 30_000;
    const dead = await s.terminal.ejecutar("boom");
    expect(dead).toMatchObject({ exitCode: 1, ficheros: null });
    expect(dead.stderr).toContain("sandbox not found");
    expect(s.sandboxNotice).toBe(BOX_STOPPED_NOTICE);
    now += 60_000;
    expect((await s.terminal.ejecutar("ls")).stdout).toBe("local\n");
    expect(local.ran).toEqual(["ls"]);
    await closeTurnTerminal(s, { save: async () => {}, store, charge, now: () => now });
    expect(charge).toHaveBeenCalledWith(expect.objectContaining({ userId: "owner", projectId: "p", turnId: "turn-1", seconds: 30 }));
    expect(store.rows.p?.heldBy).toBeNull();
  });
});

describe("the box and parallel tools", () => {
  it("bash is never run in parallel with a write of the same project", async () => {
    // The sync reads the box against the last command's state: a Write between would be taken for the box's.
    const { isConcurrencySafe } = await import("@/lib/agent/tool-concurrency");
    expect(isConcurrencySafe("bash", { command: "ls" })).toBe(false);
    expect(isConcurrencySafe("Write", { file_path: "/a", content: "x" })).toBe(false);
  });
});

describe("closeTurnTerminal", () => {
  it("saves pending changes, pauses, stores the manifest, lets go of the row and charges the owner", async () => {
    let now = 2_000_000;
    const { s, o, store, driver, charge } = setup({ now: () => now });
    s.terminal = await terminalForTurn(s, o);
    await s.terminal.ejecutar("true");
    const id = store.rows.p!.sandboxId!;
    driver.files(id).set("/late.txt", "written in the background");
    now += 45_000;
    const save = vi.fn(async () => {});
    await closeTurnTerminal(s, { save, store, charge, now: () => now });
    expect(save).toHaveBeenCalledWith({ "/late.txt": "written in the background" });
    expect(driver.paused(id)).toBe(true);
    expect(store.rows.p).toMatchObject({ state: "paused", heldBy: null });
    expect(Object.keys(store.rows.p!.syncedManifest)).toContain("/index.html");
    expect(charge).toHaveBeenCalledWith({ userId: "owner", actorId: null, projectId: "p", turnId: "turn-1", seconds: 45 });
    expect(s.terminal).toBeUndefined();
  });

  it("closing after an error still lets go of the row and pauses", async () => {
    const { s, o, store, driver, charge } = setup();
    s.terminal = await terminalForTurn(s, o);
    await s.terminal.ejecutar("true");
    const id = store.rows.p!.sandboxId!;
    await closeTurnTerminal(s, { save: async () => Promise.reject(new Error("db down")), store, charge });
    expect(driver.paused(id)).toBe(true);
    expect(store.rows.p?.heldBy).toBeNull();
  });

  it("closing the turn kills what runs in the background before pausing, and what finished is told before that", async () => {
    const driver = fakeDriver({ onRun: (_cmd, _files, o) => (o.background ? { pid: 77 } : undefined) });
    const { s, o, store, charge } = setup({ driver });
    const t = (s.terminal = await terminalForTurn(s, o)) as TurnSandbox;
    await t.ejecutar("python3 -m http.server", { background: true });
    expect(await t.finishedBackground()).toEqual([]);
    const id = store.rows.p!.sandboxId!;
    await closeTurnTerminal(s, { save: async () => {}, store, charge });
    const ran = driver.commands(id);
    const kill = ran.findIndex((c) => c.includes("kill -TERM") && c.includes("77"));
    expect(kill).toBeGreaterThan(-1);
    expect(driver.paused(id)).toBe(true);
  });

  it("settling before the turn's last photo saves what is pending and stops the background; closing after doesn't save it again", async () => {
    const driver = fakeDriver({ onRun: (_cmd, _files, o) => (o.background ? { pid: 77 } : undefined) });
    const { s, o, store, charge } = setup({ driver });
    const t = (s.terminal = await terminalForTurn(s, o)) as TurnSandbox;
    await t.ejecutar("python3 gen.py", { background: true });
    const id = store.rows.p!.sandboxId!;
    driver.files(id).set("/data/out.json", "{}");
    const save = vi.fn(async () => {});
    await settleTurnTerminal(s, { save });
    expect(save).toHaveBeenCalledWith({ "/data/out.json": "{}" });
    expect(driver.commands(id).some((c) => c.includes("kill -TERM") && c.includes("77"))).toBe(true);
    expect(driver.paused(id)).toBe(false);
    await closeTurnTerminal(s, { save, store, charge });
    expect(save).toHaveBeenCalledTimes(1);
    expect(driver.paused(id)).toBe(true);
  });

  it("settling today's terminal does nothing", async () => {
    const { s, local } = setup();
    s.terminal = local;
    await settleTurnTerminal(s, { save: async () => {} });
    expect(local.closed).toBe(false);
  });

  it("today's terminal just closes", async () => {
    const { s, local } = setup();
    s.terminal = local;
    await closeTurnTerminal(s, {});
    expect(local.closed).toBe(true);
    expect(s.terminal).toBeUndefined();
  });

  it("the sandbox terminal is a SandboxTerminal underneath", async () => {
    const { s, o } = setup();
    const t = await terminalForTurn(s, o);
    expect((t as { inner?: unknown }).inner).toBeInstanceOf(SandboxTerminal);
  });
});
