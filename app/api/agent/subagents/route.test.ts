import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), runsOfRow: vi.fn(), runsByIds: vi.fn() }));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/projects/acceso", () => import("@/lib/projects/acceso-de-prueba"));
vi.mock("@/lib/agent/subagents/store", () => ({ runsOfRow: mocks.runsOfRow, runsByIds: mocks.runsByIds }));

import { fijarAccesoDePrueba } from "@/lib/projects/acceso-de-prueba";
import { GET } from "./route";

const ask = async (query = "project=p1&row=row1") => {
  const res = await GET(new Request(`http://localhost/api/agent/subagents?${query}`));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

const RUN = {
  id: "r1", projectId: "p1", chatRowId: "row1", turnId: "t1", personId: "u1", preset: "Explore",
  description: "Find the menu", prompt: "Where is it?", status: "completed", transcript: [{ role: "user", content: "secret" }],
  actions: [{ tool: "Read", summary: "/menu/index.html" }], finalText: "In /menu/index.html:12.", diagnostic: null, usage: null,
  toolUses: 3, durationMs: 4200, chargedCenticredits: 7, createdAt: new Date("2026-11-01T10:00:00Z"),
  settledAt: new Date("2026-11-01T10:00:04Z"), noticeDeliveredAt: null, forked: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "u1" } });
  mocks.runsOfRow.mockResolvedValue([RUN]);
  mocks.runsByIds.mockResolvedValue([]);
});
afterEach(() => { fijarAccesoDePrueba(null); vi.unstubAllEnvs(); });

describe("GET /api/agent/subagents", () => {
  it("the off switch hides saved children from the phone too", async () => {
    vi.stubEnv("OPENLEN_SUBAGENTS", "0");
    expect((await ask()).body.runs).toEqual([]);
    expect(mocks.runsOfRow).not.toHaveBeenCalled();
  });
  it.each([
    [{}, null],
    [{ status: "running", worktreeCopyId: "copy" }, { state: "working" }],
    [{ worktreeCopyId: "copy" }, null],
    [{ worktreeOutcome: { state: "brought", files: ["/a"] } }, { state: "brought", files: ["/a"] }],
  ])("a run's worktree (%j)", async (fields, want) => {
    mocks.runsOfRow.mockResolvedValue([{ ...RUN, ...fields }]);
    expect(((await ask()).body.runs as { worktree: unknown }[])[0]?.worktree).toEqual(want);
  });
  it("a turn's row lists its subagents, without their transcript or prompt", async () => {
    const { status, body } = await ask();
    expect(status).toBe(200);
    expect(mocks.runsOfRow).toHaveBeenCalledWith("p1", "row1");
    expect(body.runs).toEqual([
      {
        id: "r1", preset: "Explore", description: "Find the menu", status: "completed",
        actions: [{ tool: "Read", summary: "/menu/index.html" }], finalText: "In /menu/index.html:12.",
        toolUses: 3, durationMs: 4200, createdAt: "2026-11-01T10:00:00.000Z", settledAt: "2026-11-01T10:00:04.000Z", forked: false, worktree: null,
      },
    ]);
    expect(mocks.runsByIds).not.toHaveBeenCalled();
  });

  it("ids: the runs a turn woke are read too (they hang from an earlier row), once each, in this project", async () => {
    mocks.runsByIds.mockResolvedValue([RUN, { ...RUN, id: "r2", chatRowId: "row0", forked: true }]);
    const { body } = await ask("project=p1&row=row1&ids=r1,r2,bad%20id");
    expect(mocks.runsByIds).toHaveBeenCalledWith("p1", ["r1", "r2"]);
    expect((body.runs as { id: string; forked: boolean }[]).map((r) => [r.id, r.forked])).toEqual([["r1", false], ["r2", true]]);
  });

  it("a reader member sees them too", async () => {
    fijarAccesoDePrueba(() => ({ rol: "lector", duenoId: "owner" }));
    expect((await ask()).status).toBe(200);
  });

  it("someone with no access gets a 404 and reads nothing", async () => {
    fijarAccesoDePrueba(() => null);
    expect((await ask()).status).toBe(404);
    expect(mocks.runsOfRow).not.toHaveBeenCalled();
  });

  it("no session is a 401; a missing project or row is a 400", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await ask()).status).toBe(401);
    mocks.auth.mockResolvedValue({ user: { id: "u1" } });
    expect((await ask("project=p1")).status).toBe(400);
    expect((await ask("row=row1")).status).toBe(400);
  });
});
