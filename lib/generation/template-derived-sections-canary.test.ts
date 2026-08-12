import { describe, expect, it, vi } from "vitest";
import { runTemplateDerivedSectionsCanary, type TemplateDerivedCanaryDeps } from "../../scripts/template-derived-sections-canary";

const HASH = `sha256:${"a".repeat(64)}`;
function deps(overrides: Partial<TemplateDerivedCanaryDeps> = {}): TemplateDerivedCanaryDeps {
  return { live: true, authorization: "AUTHORIZED_TEMPLATE_DERIVED_CANARY_ONCE", creationMode: "enabled", catalogManifestHash: HASH, expectedCatalogManifestHash: HASH, authoritativeHeadCurrent: true, dbAvailable: true, geminiKeyPresent: true, capMicromxn: 60_000_000, reservedWorstCaseMicromxn: 5_000_000, deterministicPreflight: vi.fn(async () => true), runCase: vi.fn(async () => ({ ok: true, resultCode: "composed", costMicromxn: 1000, durationMs: 10 })), recordTelemetry: vi.fn(async () => undefined), ...overrides };
}
describe("template-derived six-case canary", () => {
  it.each([
    ["live_required", { live: false }], ["unauthorized", { authorization: "wrong" }], ["creation_disabled", { creationMode: "disabled" }], ["catalog_stale", { expectedCatalogManifestHash: `sha256:${"b".repeat(64)}` }], ["head_stale", { authoritativeHeadCurrent: false }], ["db_unavailable", { dbAvailable: false }], ["missing_key", { geminiKeyPresent: false }], ["invalid_budget", { capMicromxn: 0 }],
  ] as const)("fails %s before every provider and telemetry call", async (code, override) => {
    const d = deps(override); const result = await runTemplateDerivedSectionsCanary(d);
    expect(result).toMatchObject({ ok: false, code, report: { counts: { attempted: 0 } } }); expect(d.runCase).not.toHaveBeenCalled(); expect(d.recordTelemetry).not.toHaveBeenCalled();
  });
  it("waits for all six deterministic preflights before the first paid call", async () => {
    const d = deps({ deterministicPreflight: vi.fn(async (id) => id !== "boutique-hotel") });
    await expect(runTemplateDerivedSectionsCanary(d)).resolves.toMatchObject({ ok: false, code: "preflight_failed" }); expect(d.deterministicPreflight).toHaveBeenCalledTimes(6); expect(d.runCase).not.toHaveBeenCalled();
  });
  it("runs exactly six cases sequentially once, records redacted rows, and self-hashes", async () => {
    let concurrent = 0; let maximum = 0;
    const d = deps({ runCase: vi.fn(async () => { concurrent += 1; maximum = Math.max(maximum, concurrent); await Promise.resolve(); concurrent -= 1; return { ok: true, resultCode: "composed", costMicromxn: 1000, durationMs: 10 }; }) });
    const result = await runTemplateDerivedSectionsCanary(d);
    expect(result).toMatchObject({ ok: true, report: { counts: { expected: 6, attempted: 6, passed: 6, failed: 0 }, totalCostMicromxn: 6000, reportSha256: expect.stringMatching(/^sha256:/) } }); expect(d.runCase).toHaveBeenCalledTimes(6); expect(d.recordTelemetry).toHaveBeenCalledTimes(6); expect(maximum).toBe(1); expect(JSON.stringify(result)).not.toMatch(/brief|html|screenshot|prompt/i);
  });
  it("stops before a request whose reserved worst case exceeds the positive cap and never retries failures", async () => {
    const d = deps({ capMicromxn: 10_000_000, reservedWorstCaseMicromxn: 5_000_000, runCase: vi.fn(async () => ({ ok: false, resultCode: "provider_error", costMicromxn: 6_000_000, durationMs: 10 })) });
    await expect(runTemplateDerivedSectionsCanary(d)).resolves.toMatchObject({ ok: false, code: "budget_exceeded", report: { counts: { attempted: 1 } } }); expect(d.runCase).toHaveBeenCalledTimes(1);
  });
  it("returns a complete redacted partial report when DB telemetry rejects after a paid case", async () => {
    const d = deps({ recordTelemetry: vi.fn(async () => { throw new Error("private database body"); }) });
    const result = await runTemplateDerivedSectionsCanary(d);
    expect(result).toMatchObject({ ok: false, code: "case_failed", report: { counts: { attempted: 1 } } });
    expect(JSON.stringify(result)).not.toContain("private database body");
    expect(d.runCase).toHaveBeenCalledTimes(1);
  });
  it("allowlists result codes and reserves worst-case cost for thrown or invalid usage", async () => {
    const secret = deps({ runCase: vi.fn(async () => ({ ok: true, resultCode: "SECRET provider body", costMicromxn: -1, durationMs: 3 })) });
    const result = await runTemplateDerivedSectionsCanary(secret);
    expect(result).toMatchObject({ ok: false, code: "case_failed", report: { counts: { attempted: 6, failed: 6 } } });
    expect(result.report.rows).toHaveLength(6);
    expect(result.report.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ ok: false, resultCode: "invalid_usage", costMicromxn: 5_000_000 }),
    ]));
    expect(result.report.rows.every((row) => row.resultCode === "invalid_usage" && row.costMicromxn === 5_000_000)).toBe(true);
    expect(JSON.stringify(result)).not.toContain("SECRET provider body");
  });
});
