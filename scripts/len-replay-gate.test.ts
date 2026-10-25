// @vitest-environment node
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// The gate stops before downloading anything or running vitest when one of its
// test files is missing — vitest alone would just ignore it.
describe("len-replay:gate", () => {
  it("exits 1 and names the file when a listed test file is missing", () => {
    const r = spawnSync(process.execPath, ["scripts/len-replay-gate.mjs"], {
      encoding: "utf8",
      env: { ...process.env, LEN_REPLAY_GATE_FILES: "lib/agent/loop.test.ts, lib/agent/does-not-exist.test.ts" },
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("missing test file(s): lib/agent/does-not-exist.test.ts");
    expect(r.stderr).not.toContain("loop.test.ts");
  });
});
