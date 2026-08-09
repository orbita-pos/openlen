import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Visual Engine 2C operator runbook", () => {
  it("documents the complete closed operational boundary", async () => {
    const runbook = await readFile(join(process.cwd(), "docs", "generation", "visual-engine-2a-runbook.md"), "utf8");
    for (const required of [
      "OPENLEN_VISUAL_ENGINE_REPAIR=off|shadow|on",
      "generation:visual-engine-2c:qualify",
      "generation:visual-engine-2c:eval",
      "generation:visual-engine-2c:review",
      "generation:visual-engine-2c:scorecard",
      "30000000",
      "AUTHORIZED_2C_SMOKE_ONCE",
      "15 reservations",
      "33 provider calls",
      "scratch/visual-engine-2c/",
      "No retry or replacement",
      "separate rollout approval",
      "set OPENLEN_VISUAL_ENGINE_REPAIR=off",
      "controlled-scratch is out of scope",
    ]) expect(runbook).toContain(required);
  });
});
