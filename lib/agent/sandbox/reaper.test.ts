// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import type { SandboxDriver } from "./driver";
import { killSandboxOfDeletedProject, reapSandboxes, sandboxCleanupDriver, type ReaperStore } from "./reaper";
import type { ProjectSandboxRow } from "./store";

const NOW = new Date("2026-10-21T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

function row(projectId: string, sandboxId: string, pausedAt: Date): ProjectSandboxRow {
  return { projectId, sandboxId, template: "openlen-terminal-v1", state: "paused", syncedManifest: {}, heldBy: null, pausedAt };
}

function memoryStore(rows: ProjectSandboxRow[]): ReaperStore & { rows: Map<string, ProjectSandboxRow> } {
  const m = new Map(rows.map((r) => [r.projectId, r]));
  return {
    rows: m,
    idleBefore: async (cutoff) =>
      [...m.values()]
        .filter((r) => r.state === "paused" && r.sandboxId && !r.heldBy && r.pausedAt && r.pausedAt < cutoff)
        .map((r) => ({ projectId: r.projectId, sandboxId: r.sandboxId!, pausedAt: r.pausedAt })),
    get: async (p) => m.get(p) ?? null,
    hold: async (p, t) => {
      const r = m.get(p);
      if (!r || r.heldBy) return false;
      m.set(p, { ...r, heldBy: t });
      return true;
    },
    release: async (p, t) => {
      const r = m.get(p);
      if (r?.heldBy === t) m.set(p, { ...r, heldBy: null });
    },
    forget: async (p, heldBy) => {
      if (m.get(p)?.heldBy === heldBy) m.delete(p);
    },
  };
}

function driverKilling(kill: (id: string) => Promise<void>): SandboxDriver & { killed: string[] } {
  const killed: string[] = [];
  return {
    killed,
    create: async () => Promise.reject(new Error("not here")),
    resume: async () => Promise.reject(new Error("not here")),
    kill: async (id) => {
      await kill(id);
      killed.push(id);
    },
  };
}

describe("reapSandboxes", () => {
  it("kills the boxes paused more than 7 days ago and forgets their rows; leaves the 6-day-old ones", async () => {
    const store = memoryStore([row("old", "sbx-old", daysAgo(8)), row("recent", "sbx-recent", daysAgo(6))]);
    const driver = driverKilling(async () => {});
    expect(await reapSandboxes({ driver, now: NOW, store })).toEqual({ killed: 1, failed: 0 });
    expect(driver.killed).toEqual(["sbx-old"]);
    expect(store.rows.has("old")).toBe(false);
    expect(store.rows.get("recent")?.sandboxId).toBe("sbx-recent");
  });

  it("a box E2B no longer has is forgotten too", async () => {
    const store = memoryStore([row("gone", "sbx-gone", daysAgo(30))]);
    const notFound = Object.assign(new Error("sandbox sbx-gone not found"), { name: "NotFoundError" });
    const driver = driverKilling(async () => Promise.reject(notFound));
    expect(await reapSandboxes({ driver, now: NOW, store })).toEqual({ killed: 1, failed: 0 });
    expect(store.rows.has("gone")).toBe(false);
  });

  it("an E2B error counts as failed, keeps the row free for tomorrow, and the rest go on", async () => {
    const store = memoryStore([row("a", "sbx-a", daysAgo(10)), row("b", "sbx-b", daysAgo(9))]);
    const log = vi.fn();
    const driver = driverKilling(async (id) => (id === "sbx-a" ? Promise.reject(new Error("E2B 500")) : undefined));
    expect(await reapSandboxes({ driver, now: NOW, store, log })).toEqual({ killed: 1, failed: 1 });
    expect(store.rows.get("a")).toMatchObject({ sandboxId: "sbx-a", heldBy: null });
    expect(store.rows.has("b")).toBe(false);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("sbx-a"));
  });

  it("a box a dead turn left running (never paused, still held) is killed too once it is old", async () => {
    const store = memoryStore([{ ...row("crashed", "sbx-crashed", daysAgo(0)), state: "running", pausedAt: null, heldBy: "dead-turn" }]);
    // What Postgres does for an old row: it is on the list, and its stale hold can be taken.
    store.idleBefore = async () => [{ projectId: "crashed", sandboxId: "sbx-crashed", pausedAt: null }];
    store.hold = async (p, t) => {
      store.rows.set(p, { ...store.rows.get(p)!, heldBy: t });
      return true;
    };
    const driver = driverKilling(async () => {});
    expect(await reapSandboxes({ driver, now: NOW, store })).toEqual({ killed: 1, failed: 0 });
    expect(driver.killed).toEqual(["sbx-crashed"]);
    expect(store.rows.has("crashed")).toBe(false);
  });

  it("a box a turn took in the meantime is left alone", async () => {
    const store = memoryStore([row("busy", "sbx-busy", daysAgo(10))]);
    const idleBefore = store.idleBefore;
    store.idleBefore = async (cutoff) => {
      const list = await idleBefore(cutoff);
      await store.hold("busy", "turn-1");
      return list;
    };
    const driver = driverKilling(async () => {});
    expect(await reapSandboxes({ driver, now: NOW, store })).toEqual({ killed: 0, failed: 0 });
    expect(driver.killed).toEqual([]);
    expect(store.rows.get("busy")?.heldBy).toBe("turn-1");
  });

  it("a box used and paused again since the list is left alone, and let go", async () => {
    const store = memoryStore([row("again", "sbx-again", daysAgo(10))]);
    const idleBefore = store.idleBefore;
    store.idleBefore = async (cutoff) => {
      const list = await idleBefore(cutoff);
      store.rows.set("again", row("again", "sbx-again", daysAgo(0)));
      return list;
    };
    const driver = driverKilling(async () => {});
    expect(await reapSandboxes({ driver, now: NOW, store })).toEqual({ killed: 0, failed: 0 });
    expect(driver.killed).toEqual([]);
    expect(store.rows.get("again")?.heldBy).toBeNull();
  });
});

describe("the cleanup driver", () => {
  it("there is none without a key", () => {
    expect(sandboxCleanupDriver({})).toBeNull();
  });

  it("there is one with a key even with the box switched off: switching it off must not leave boxes behind", () => {
    expect(sandboxCleanupDriver({ E2B_API_KEY: "k", OPENLEN_SANDBOX: "0" })).not.toBeNull();
    expect(sandboxCleanupDriver({ E2B_API_KEY: "k", OPENLEN_TERMINAL: "0" })).not.toBeNull();
  });
});

describe("killSandboxOfDeletedProject", () => {
  it("kills the box of a deleted project", async () => {
    const driver = driverKilling(async () => {});
    await killSandboxOfDeletedProject("sbx-1", { driver });
    expect(driver.killed).toEqual(["sbx-1"]);
  });

  it("an E2B failure is logged, never thrown: deleting the project must not fail for it", async () => {
    const log = vi.fn();
    const driver = driverKilling(async () => Promise.reject(new Error("E2B down")));
    await expect(killSandboxOfDeletedProject("sbx-1", { driver, log })).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("sbx-1"));
  });

  it("without a key there is nothing to kill with, and it says so", async () => {
    const log = vi.fn();
    await killSandboxOfDeletedProject("sbx-1", { driver: null, log });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("sbx-1"));
  });
});
