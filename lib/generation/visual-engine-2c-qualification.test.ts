import { describe, expect, it } from "vitest";
import { VISUAL_ENGINE_2C_CASES } from "./visual-engine-2c-cohort";
import { qualifyVisualEngine2CCohort, verifyVisualEngine2CQualification } from "./visual-engine-2c-qualification";

describe("qualifyVisualEngine2CCohort", () => {
  it("creates a redacted self-hashed 6/6/3 manifest", async () => {
    const result = await qualifyVisualEngine2CCohort({
      cases: VISUAL_ENGINE_2C_CASES,
      commitSha: "a".repeat(40),
      evaluate: async (row) => ({ resultCode: row.class, inputHash: `sha256:${"a".repeat(64)}`, outputHash: `sha256:${"b".repeat(64)}` }),
    });
    expect(result.ok).toBe(true);
    expect(result.manifest.counts).toEqual({ total: 15, keep: 6, repairable: 6, nonrepairable: 3 });
    expect(verifyVisualEngine2CQualification(result.manifest, { commitSha: "a".repeat(40) })).toBe(true);
    expect(JSON.stringify(result.manifest)).not.toMatch(/html|dataBase64|brief|explanation|screenshot/i);
  });

  it("rejects moved HEAD, tampering, and wrong local outcomes", async () => {
    const result = await qualifyVisualEngine2CCohort({
      cases: VISUAL_ENGINE_2C_CASES, commitSha: "b".repeat(40),
      evaluate: async (row) => ({ resultCode: row.id === VISUAL_ENGINE_2C_CASES[0]!.id ? "repairable" : row.class, inputHash: `sha256:${"1".repeat(64)}`, outputHash: `sha256:${"2".repeat(64)}` }),
    });
    expect(result.ok).toBe(false);
    expect(verifyVisualEngine2CQualification(result.manifest, { commitSha: "c".repeat(40) })).toBe(false);
    expect(verifyVisualEngine2CQualification({ ...result.manifest, manifestSha256: `sha256:${"0".repeat(64)}` }, { commitSha: "b".repeat(40) })).toBe(false);
  });
});
