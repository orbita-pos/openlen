import { describe, expect, it, vi } from "vitest";
import { runVisualEngine2CQualification } from "@/scripts/visual-engine-2c-qualify";

function fixture(commits = ["a".repeat(40), "a".repeat(40)]) {
  const writes: Array<{ path: string; value: unknown }> = [];
  return { writes, deps: {
    getCommitSha: vi.fn(async () => commits.shift() ?? "a".repeat(40)),
    mkdir: vi.fn(async () => undefined),
    writeJsonAtomic: vi.fn(async (path: string, value: unknown) => { writes.push({ path, value }); }),
    log: vi.fn(),
  } };
}

describe("runVisualEngine2CQualification", () => {
  it("writes one redacted self-hashed artifact after stable HEAD", async () => {
    const state = fixture();
    const manifest = await runVisualEngine2CQualification(state.deps, "C:\\repo");
    expect(manifest.counts).toEqual({ total: 15, keep: 6, repairable: 6, nonrepairable: 3 });
    expect(state.writes).toHaveLength(1);
    expect(state.writes[0]!.path).toMatch(/scratch[\\/]visual-engine-2c[\\/]qualification\.json$/);
    expect(JSON.stringify(state.writes[0]!.value)).not.toMatch(/html|brief|dataBase64|explanation/i);
  });
  it("refuses moving HEAD without writing", async () => {
    const state = fixture(["a".repeat(40), "b".repeat(40)]);
    await expect(runVisualEngine2CQualification(state.deps)).rejects.toMatchObject({ code: "commit_changed" });
    expect(state.deps.writeJsonAtomic).not.toHaveBeenCalled();
  });
});
