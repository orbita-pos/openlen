import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FABLE_MODEL_POLICY } from "./fable-model-policy";
import { sealFableParityScorecard, type BlindDecision, type FableParityComparisonResult } from "./fable-parity-scorecard";
import {
  FABLE_PARITY_EVAL_AUTHORIZATION,
  runFableParityEvalCli,
  type FableParityEvalCliDeps,
} from "@/scripts/fable-parity-eval";
import { validateFableParityReviewServerEnvironment } from "@/scripts/fable-parity-review";
import { verifyFableParityDeployGate, writeFableParityScorecardFile } from "@/scripts/fable-parity-scorecard";
import {
  createFableParityProductionRuntimeDeps,
  runFableParityRollbackCli,
} from "@/scripts/fable-parity-rollback";

let temporaryRoot: string | undefined;

afterEach(async () => {
  if (temporaryRoot?.startsWith(tmpdir())) await rm(temporaryRoot, { recursive: true, force: true });
  temporaryRoot = undefined;
});

const HASH = `sha256:${"a".repeat(64)}`;
const VALID_ENV = {
  OPENLEN_FABLE_PARITY_LIVE: "1",
  OPENLEN_FABLE_PARITY_AUTHORIZATION: FABLE_PARITY_EVAL_AUTHORIZATION,
  OPENLEN_FABLE_PARITY_TOTAL_CAP_MICROMXN: "240000000",
  OPENLEN_FABLE_PARITY_PAGE_CAP_MICROMXN: "10000000",
  OPENLEN_FABLE_PARITY_REFERENCE_PAGE_CAP_MICROMXN: "2000000",
  OPENLEN_FABLE_PARITY_REASONER_MODEL: FABLE_MODEL_POLICY.reasoner.modelId,
  OPENLEN_FABLE_PARITY_DESIGNER_MODEL: FABLE_MODEL_POLICY.designer.modelId,
  OPENLEN_FABLE_PARITY_CRITIC_MODEL: FABLE_MODEL_POLICY.visualCritic.modelId,
  OPENLEN_FABLE_PARITY_IMAGE_MODEL: "gemini-2.5-flash-image",
  OPENLEN_FABLE_PARITY_REFERENCE_MODEL: "fable-5",
  OPENLEN_FABLE_PARITY_RATE_CARD_SHA256: HASH,
  OPENLEN_FABLE_PARITY_REVIEWED_RATE_CARD_SHA256: HASH,
};

function sealedRecords() {
  return Array.from({ length: 8 }, (_, index) => ({
    sealedId: `sealed-${index}`,
    ciphertextBase64: Buffer.from(`ciphertext-${index}`).toString("base64"),
    nonceBase64: Buffer.from(`nonce-${index}`).toString("base64"),
    authTagBase64: Buffer.from(`tag-${index}`).toString("base64"),
  }));
}

function sideResult(label: string) {
  return {
    htmlBytes: Buffer.from(`<html>${label}</html>`),
    desktop: { bytes: Buffer.from(`${label}:desktop`), fullPage: true as const, viewport: { width: 1440, height: 1000 } },
    mobile: { bytes: Buffer.from(`${label}:mobile`), fullPage: true as const, viewport: { width: 390, height: 844 } },
    costMicromxn: 1,
    technicalStatus: "ok" as const,
    eligible: true,
    criticalFailures: [] as const,
    paidCalls: [{ result: "delivered" as const, costMicromxn: 1 }],
  };
}

function evalDeps(
  env: Readonly<Record<string, string | undefined>> = VALID_ENV,
  generateOpenLen?: FableParityEvalCliDeps["generateOpenLen"],
) {
  const order: string[] = [];
  const deps: FableParityEvalCliDeps = {
    env,
    loadSealedRecords: vi.fn(async () => { order.push("hidden"); return sealedRecords(); }),
    consumeAuthorization: vi.fn(async () => undefined),
    decryptHiddenRecord: vi.fn(async (_record, index) => ({
      recordId: `external-${index}`,
      version: "hidden/1" as const,
      prompt: `Externally decrypted release prompt ${index}`,
      niche: "unusual" as const,
      direction: index % 2 === 0 ? "explicit" as const : "underspecified" as const,
      forbiddenSignals: ["generic_saas"] as const,
    })),
    generateOpenLen: generateOpenLen ?? vi.fn(async (row) => { order.push(`openlen:${row.ordinal}`); return sideResult(`openlen:${row.ordinal}`); }),
    generateFable: vi.fn(async (row) => { order.push(`fable:${row.ordinal}`); return sideResult(`fable:${row.ordinal}`); }),
    writeBundle: vi.fn(async (input) => { order.push(`write:${input.comparisons.length}`); return { manifestPath: "scratch/fable-parity/run/manifest.json", manifestSha256: HASH }; }),
    randomRunId: () => "0123456789abcdef01234567",
  };
  return { deps, order };
}

function passingScorecard() {
  const comparisons: FableParityComparisonResult[] = Array.from({ length: 20 }, (_, index) => ({
    comparisonId: `comparison-${index}`,
    openLenSide: index % 2 === 0 ? "A" : "B",
    technicalStatus: "ok",
    openLenEligible: index < 18,
    criticalFailures: [],
    paidCalls: [{ result: "delivered", costMicromxn: 1_000_000 }],
  }));
  const outcomes = [...Array(8).fill("win"), ...Array(6).fill("tie"), ...Array(6).fill("loss")];
  const decisions: BlindDecision[] = comparisons.flatMap((row, index) => [1, 2, 3].map((reviewer) => {
    const openLen = row.openLenSide;
    const fable = openLen === "A" ? "B" : "A";
    const outcome = outcomes[index];
    return {
      comparisonId: row.comparisonId,
      reviewerSessionId: `reviewer-${reviewer}`,
      desktopPreference: outcome === "win" ? openLen : outcome === "loss" ? fable : "tie",
      mobilePreference: outcome === "win" ? openLen : outcome === "loss" ? fable : "tie",
      overallPreference: outcome === "win" ? openLen : outcome === "loss" ? fable : "tie",
      wrongNicheSide: "none",
      rubric: { niche: 8, fidelity: 8, polish: 8, coherence: 8, usability: 8 },
    } as BlindDecision;
  }));
  return sealFableParityScorecard({ comparisons, decisions }, HASH);
}

describe("Fable parity operational release controls", () => {
  it.each([
    ["live", { OPENLEN_FABLE_PARITY_LIVE: "0" }],
    ["authorization", { OPENLEN_FABLE_PARITY_AUTHORIZATION: "wrong" }],
    ["total cap", { OPENLEN_FABLE_PARITY_TOTAL_CAP_MICROMXN: "0" }],
    ["reserved cap", { OPENLEN_FABLE_PARITY_TOTAL_CAP_MICROMXN: "239999999" }],
    ["page cap", { OPENLEN_FABLE_PARITY_PAGE_CAP_MICROMXN: "9999999" }],
    ["model", { OPENLEN_FABLE_PARITY_DESIGNER_MODEL: "unreviewed" }],
    ["rate card", { OPENLEN_FABLE_PARITY_REVIEWED_RATE_CARD_SHA256: `sha256:${"b".repeat(64)}` }],
  ])("closes the live eval on invalid %s before hidden data or provider boundaries", async (_label, override) => {
    const state = evalDeps({ ...VALID_ENV, ...override });
    const result = await runFableParityEvalCli(state.deps);
    expect(result.ok).toBe(false);
    expect(state.order).toEqual([]);
    expect(state.deps.loadSealedRecords).not.toHaveBeenCalled();
    expect(state.deps.generateOpenLen).not.toHaveBeenCalled();
    expect(state.deps.generateFable).not.toHaveBeenCalled();
  });

  it("runs exactly twenty OpenLen and twenty Fable calls in strict case order with no harness retries", async () => {
    const state = evalDeps();
    const result = await runFableParityEvalCli(state.deps);
    expect(result).toEqual({ ok: true, comparisons: 20, openLenCalls: 20, fableCalls: 20, manifestPath: "scratch/fable-parity/run/manifest.json", manifestSha256: HASH, authorizedMaximumMicromxn: 240_000_000 });
    expect(state.order).toEqual([
      "hidden",
      ...Array.from({ length: 20 }, (_, index) => [`openlen:${index + 1}`, `fable:${index + 1}`]).flat(),
      "write:20",
    ]);
  });

  it.each([
    ["technical status", { technicalStatus: "unknown" }],
    ["failed eligibility", { technicalStatus: "failed", eligible: true }],
    ["critical failure", { criticalFailures: ["not_a_release_failure"] }],
    ["desktop viewport", { desktop: { bytes: Buffer.from("desktop"), fullPage: true, viewport: { width: 0, height: 1000 } } }],
    ["successful paid accounting", { costMicromxn: 0, paidCalls: [] }],
  ])("rejects an adversarial %s mutation before writing review evidence", async (_label, override) => {
    const state = evalDeps(VALID_ENV, vi.fn(async () => ({ ...sideResult("mutated"), ...override } as never)));
    await expect(runFableParityEvalCli(state.deps)).rejects.toThrow(/technical|eligible|critical|viewport|paid|cost|artifact/i);
    expect(state.deps.writeBundle).not.toHaveBeenCalled();
  });

  it("permits a zero-cost failed pre-call only when it is ineligible and has no paid ledger entries", async () => {
    const state = evalDeps(VALID_ENV, vi.fn(async () => ({
      ...sideResult("pre-call-failure"),
      costMicromxn: 0,
      technicalStatus: "failed" as const,
      eligible: false,
      paidCalls: [],
    })));
    await expect(runFableParityEvalCli(state.deps)).resolves.toMatchObject({ ok: true, comparisons: 20 });
  });

  it("requires a strong token and loopback binding for the review server", () => {
    expect(() => validateFableParityReviewServerEnvironment({ OPENLEN_FABLE_REVIEW_HOST: "0.0.0.0", OPENLEN_FABLE_REVIEW_TOKEN: "x".repeat(32) })).toThrow(/localhost|loopback/i);
    expect(() => validateFableParityReviewServerEnvironment({ OPENLEN_FABLE_REVIEW_HOST: "127.0.0.1", OPENLEN_FABLE_REVIEW_TOKEN: "short" })).toThrow(/token/i);
    expect(validateFableParityReviewServerEnvironment({ OPENLEN_FABLE_REVIEW_HOST: "127.0.0.1", OPENLEN_FABLE_REVIEW_TOKEN: "x".repeat(32), OPENLEN_FABLE_REVIEW_PORT: "4319" })).toEqual({ host: "127.0.0.1", port: 4319, token: "x".repeat(32) });
  });

  it("requires a hash-pinned verified passing scorecard only when AI creation is enabled", async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), "openlen-fable-deploy-"));
    const directory = join(temporaryRoot, "scratch", "fable-parity", "release");
    await mkdir(directory, { recursive: true });
    const scorecard = passingScorecard();
    const path = join(directory, "scorecard.json");
    await writeFile(path, JSON.stringify(scorecard));

    await expect(verifyFableParityDeployGate({
      OPENLEN_AI_CREATION: "enabled",
      OPENLEN_AI_CREATION_TARGET_MODE: "disabled",
    }, temporaryRoot)).resolves.toEqual({ targetMode: "disabled", enabled: false, verified: true });
    await expect(verifyFableParityDeployGate({ OPENLEN_AI_CREATION_TARGET_MODE: "enabled" }, temporaryRoot)).rejects.toThrow(/scorecard/i);
    await expect(verifyFableParityDeployGate({
      OPENLEN_AI_CREATION_TARGET_MODE: "enabled",
      OPENLEN_FABLE_PARITY_SCORECARD_PATH: path,
      OPENLEN_FABLE_PARITY_SCORECARD_SHA256: `sha256:${"b".repeat(64)}`,
    }, temporaryRoot)).rejects.toThrow(/hash/i);
    await expect(verifyFableParityDeployGate({
      OPENLEN_AI_CREATION_TARGET_MODE: "enabled",
      OPENLEN_FABLE_PARITY_SCORECARD_PATH: path,
      OPENLEN_FABLE_PARITY_SCORECARD_SHA256: scorecard.scorecardSha256,
    }, temporaryRoot)).rejects.toThrow(/artifact|manifest|review|source|session/i);

    const tampered = structuredClone(scorecard);
    tampered.score.passed = false;
    await writeFile(path, JSON.stringify(tampered));
    await expect(verifyFableParityDeployGate({
      OPENLEN_AI_CREATION_TARGET_MODE: "enabled",
      OPENLEN_FABLE_PARITY_SCORECARD_PATH: path,
      OPENLEN_FABLE_PARITY_SCORECARD_SHA256: scorecard.scorecardSha256,
    }, temporaryRoot)).rejects.toThrow(/hash|scorecard/i);
  });

  it("rolls back the configured runtime and verifies disabled is effective while explicit cloning stays reachable", async () => {
    let effectiveMode: "enabled" | "disabled" = "enabled";
    const result = await runFableParityRollbackCli({
      applyTargetMode: async (targetMode) => { effectiveMode = targetMode; },
      readEffectiveMode: async () => effectiveMode,
      explicitCloneReachable: async () => true,
    });
    expect(result).toMatchObject({
      verified: true,
      effective: { aiCreation: "disabled", wholeTemplateFallback: false, explicitTemplateClone: true },
      providerCalls: 0,
    });
  });

  it("rejects a no-op rollback that leaves the configured runtime enabled", async () => {
    await expect(runFableParityRollbackCli({
      applyTargetMode: async () => undefined,
      readEffectiveMode: async () => "enabled",
      explicitCloneReachable: async () => true,
    })).rejects.toThrow(/effective|disabled|rollback/i);
  });

  it("drives the configured SSH runtime through atomic disable, process readback, and an authenticated-route reachability probe", async () => {
    const commands: string[] = [];
    const deps = createFableParityProductionRuntimeDeps({
      OPENLEN_HOST: "release-host",
      OPENLEN_REMOTE_PATH: "/opt/openlen-app",
    }, async (host, command) => {
      expect(host).toBe("release-host");
      commands.push(command);
      if (command.includes("sed -n")) return "disabled";
      if (command.includes("/api/projects/from-template")) return "reachable";
      return "";
    });
    await expect(runFableParityRollbackCli(deps)).resolves.toMatchObject({ verified: true, providerCalls: 0 });
    expect(commands).toHaveLength(3);
    expect(commands[0]).toMatch(/mktemp[\s\S]*mv -f[\s\S]*systemctl restart[\s\S]*\/proc\/\$pid\/environ/);
    expect(commands[1]).toMatch(/\/proc\/\$pid\/environ[\s\S]*OPENLEN_AI_CREATION/);
    expect(commands[2]).toMatch(/curl[\s\S]*\/api\/projects\/from-template[\s\S]*401\|403/);
    expect(commands.join("\n")).not.toMatch(/fireworks|gemini|fable-5|provider/i);
  });

  it("creates missing scorecard parents below scratch and rejects arbitrary output paths", async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), "openlen-fable-score-output-"));
    const scorecard = passingScorecard();
    const nested = join(temporaryRoot, "scratch", "fable-parity", "scorecards", "nested", "scorecard.json");
    await expect(writeFableParityScorecardFile(temporaryRoot, nested, scorecard)).resolves.toBe(nested);
    expect(JSON.parse(await readFile(nested, "utf8"))).toEqual(scorecard);
    await expect(writeFableParityScorecardFile(
      temporaryRoot,
      join(temporaryRoot, "outside-scorecard.json"),
      scorecard,
    )).rejects.toThrow(/scratch|path|evidence/i);
  });

  it("places the deterministic and activation gates before the first skip-build branch", async () => {
    const source = await readFile(join(process.cwd(), "infra", "scripts", "deploy.ps1"), "utf8");
    const deterministic = source.indexOf("generation:fable-parity:gate");
    const activation = source.indexOf("generation:fable-parity:scorecard -- --deploy-gate");
    const skipBuild = source.indexOf('if ($env:OPENLEN_SKIP_BUILD');
    expect(deterministic).toBeGreaterThan(-1);
    expect(activation).toBeGreaterThan(deterministic);
    expect(skipBuild).toBeGreaterThan(activation);
  });

  it("registers separate deterministic, live, review, scorecard, and no-provider rollback commands", async () => {
    const pkg = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(Object.keys(pkg.scripts)).toEqual(expect.arrayContaining([
      "generation:fable-parity:gate",
      "generation:fable-parity:eval",
      "generation:fable-parity:review",
      "generation:fable-parity:scorecard",
      "generation:fable-parity:rollback",
    ]));
    expect(pkg.scripts["generation:fable-parity:gate"]).toMatch(/^vitest run /);
    expect(pkg.scripts["generation:fable-parity:eval"]).toContain("scripts/fable-parity-eval.ts");
    expect(pkg.scripts["generation:fable-parity:rollback"]).toContain("scripts/fable-parity-rollback.ts");
  });
});
