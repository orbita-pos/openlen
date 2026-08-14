import { describe, expect, it } from "vitest";

import {
  FABLE_PARITY_PUBLIC_COHORT,
  buildFableParityCohort,
  loadSealedHiddenCohort,
  opaqueComparisonId,
  type FableParityPrompt,
  type SealedHiddenRecord,
} from "./fable-parity-cohort";

function hiddenPrompt(index: number): FableParityPrompt {
  return {
    recordId: `external-record-${index}`,
    version: "hidden/1",
    prompt: `Externally decrypted release prompt ${index}`,
    niche: "unusual",
    direction: index % 2 === 0 ? "explicit" : "underspecified",
    forbiddenSignals: ["generic_saas"],
  };
}

function sealedRecords(count = 8): SealedHiddenRecord[] {
  return Array.from({ length: count }, (_, index) => ({
    sealedId: `sealed-${String(index + 1).padStart(2, "0")}`,
    ciphertextBase64: Buffer.from(`ciphertext-${index}`).toString("base64"),
    nonceBase64: Buffer.from(`nonce-${index}`).toString("base64"),
    authTagBase64: Buffer.from(`tag-${index}`).toString("base64"),
  }));
}

describe("Fable parity cohort", () => {
  it("keeps exactly twelve versioned public prompts across the closed release niches", () => {
    expect(FABLE_PARITY_PUBLIC_COHORT).toHaveLength(12);
    expect(FABLE_PARITY_PUBLIC_COHORT.map((row) => row.niche)).toEqual([
      "childrens_creativity",
      "psychological_horror_vhs",
      "comedy",
      "game_launch",
      "school_community",
      "editorial_cooking",
      "boutique_hospitality",
      "physical_product",
      "music_culture",
      "nonprofit_cause",
      "luxury_editorial",
      "unusual",
    ]);
    expect(new Set(FABLE_PARITY_PUBLIC_COHORT.map((row) => row.recordId)).size).toBe(12);
    for (const row of FABLE_PARITY_PUBLIC_COHORT) {
      expect(row.version).toBe("public/1");
      expect(row.prompt.trim().length).toBeGreaterThan(20);
      expect(row.forbiddenSignals.length).toBeGreaterThan(0);
    }
    expect(new Set(FABLE_PARITY_PUBLIC_COHORT.map((row) => row.direction))).toEqual(
      new Set(["explicit", "underspecified"]),
    );
  });

  it("decrypts exactly eight externally supplied sealed records and rejects plaintext envelopes", async () => {
    const records = sealedRecords();
    const decrypted = await loadSealedHiddenCohort(records, async (_record, index) => hiddenPrompt(index));
    expect(decrypted).toHaveLength(8);
    expect(() => JSON.stringify(records)).not.toThrow();
    expect(JSON.stringify(records)).not.toMatch(/Externally decrypted release prompt/i);

    await expect(loadSealedHiddenCohort(records.slice(0, 7), async (_record, index) => hiddenPrompt(index)))
      .rejects.toThrow(/exactly eight/i);
    await expect(loadSealedHiddenCohort([
      ...records.slice(0, 7),
      { ...records[7]!, prompt: "plaintext must not be accepted" } as never,
    ], async (_record, index) => hiddenPrompt(index))).rejects.toThrow(/sealed|plaintext|keys/i);
  });

  it("builds twenty unique comparisons with identities opaque to reviewers", async () => {
    const cohort = await buildFableParityCohort(sealedRecords(), async (_record, index) => hiddenPrompt(index));
    expect(cohort).toHaveLength(20);
    const comparisonIds = cohort.map((row) => row.comparisonId);
    expect(new Set(comparisonIds).size).toBe(20);
    for (const [index, row] of cohort.entries()) {
      expect(row.comparisonId).toMatch(/^[a-f0-9]{24}$/);
      expect(row.comparisonId).toBe(opaqueComparisonId(row.prompt.version, row.prompt.recordId));
      expect(row.comparisonId).not.toContain(row.prompt.recordId);
      expect(row.ordinal).toBe(index + 1);
    }
  });

  it("rejects duplicate decrypted IDs and values outside closed metadata", async () => {
    await expect(loadSealedHiddenCohort(sealedRecords(), async (_record, index) => ({
      ...hiddenPrompt(index),
      recordId: "duplicate",
    }))).rejects.toThrow(/duplicate/i);
    await expect(loadSealedHiddenCohort(sealedRecords(), async (_record, index) => ({
      ...hiddenPrompt(index),
      niche: "invented" as never,
    }))).rejects.toThrow(/niche/i);
    await expect(loadSealedHiddenCohort(sealedRecords(), async (_record, index) => ({
      ...hiddenPrompt(index),
      forbiddenSignals: ["invented"] as never,
    }))).rejects.toThrow(/forbidden/i);
  });
});
