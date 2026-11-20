// @vitest-environment node
// BRINGING THE WINNER INTO THE DRAFT WAITS FOR LEN (review item 26): while Len has a turn live in the project it is editing
// the very files the merge writes, so `mergeWinnerIntoDraft` merges nothing and says `busy`; the caller waits.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({ live: false, branchTip: vi.fn() }));

vi.mock("@/lib/agent/direcciones", () => ({ hayTurnoVivoEnElProyecto: () => h.live }));
vi.mock("@/lib/len-watch/worktree", () => ({
  branchTip: h.branchTip,
  commitLeftovers: vi.fn(),
  copySources: vi.fn(),
  deleteBranch: vi.fn(),
  removeWorktree: vi.fn(),
  setBranch: vi.fn(),
}));
// The rest of the module's imports are only used past the check this test is about.
vi.mock("@/lib/agent/ficheros/sitio", () => ({ paginaDeRuta: () => false }));
vi.mock("@/lib/agent/subagents/worktree", () => ({ oneAtATime: async (_k: string, f: () => unknown) => f() }));
vi.mock("@/lib/backend/files", () => ({ listProjectFiles: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {}, schema: {} }));
vi.mock("@/lib/git/paths", () => ({ toAbsolute: (p: string) => p }));
vi.mock("@/lib/git/postgres-store", () => ({ postgresStore: vi.fn() }));
vi.mock("@/lib/git/repository", () => ({ Repository: class {} }));
vi.mock("@/lib/len-watch/bring", () => ({ draftFiles: vi.fn(), draftTree: vi.fn(), planBring: vi.fn() }));
vi.mock("@/lib/len-watch/published-sources", () => ({ readPublishedSources: vi.fn(), recordPublishedSources: vi.fn() }));
vi.mock("@/lib/projects/files-hash", () => ({ folderFingerprint: () => "x" }));

const { mergeWinnerIntoDraft } = await import("./worktree");

const MERGE = { projectId: "p1", ownerId: "u1", actorId: "u1", baseCommitOid: "base-1", branch: "ab/ab_1234abcd" };

beforeEach(() => {
  h.live = false;
  h.branchTip.mockReset();
});

describe("mergeWinnerIntoDraft and Len's live turn", () => {
  it("🔴 a Len turn is live in the project: it merges nothing and says busy", async () => {
    h.live = true;
    await expect(mergeWinnerIntoDraft(MERGE)).resolves.toEqual({ kind: "busy" });
    expect(h.branchTip).not.toHaveBeenCalled();
  });

  it("no turn live: it goes on (here the branch is gone, so there is nothing to merge)", async () => {
    h.branchTip.mockResolvedValue(null);
    await expect(mergeWinnerIntoDraft(MERGE)).resolves.toEqual({ kind: "nothing" });
    expect(h.branchTip).toHaveBeenCalledWith("p1", "ab/ab_1234abcd");
  });
});
