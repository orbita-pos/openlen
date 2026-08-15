import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const GATE = "vitest run lib/curate/generate-page-copy.test.ts lib/curate/finalize-composed-document.test.ts lib/curate/quick-section-composition.test.ts lib/curate/ai-composition-delivery.test.ts lib/curate/quick-visual-repair.test.ts lib/curate/run-ai-creation.test.ts lib/curate/ai-creation-mode.test.ts lib/curate/ai-creation-rollout.test.ts lib/curate/ai-creation-credits.test.ts lib/curate/commit-ai-composition.test.ts lib/curate/curate-route.integration.test.ts lib/generation/section-variant-semantics.test.ts lib/generation/deterministic-creative-direction.test.ts lib/generation/compose-sections.test.ts lib/generation/section-inventory.test.ts lib/generation/visual-engine-2b-qualification.test.ts lib/generation/ai-hybrid-niche-cohort.test.ts lib/curate/ai-hybrid-import-boundary.test.ts lib/curate/ai-hybrid-regression.test.ts lib/curate/explicit-template-clone-contract.test.ts lib/curate/ai-hybrid-runbook-contract.test.ts lib/curate/creative-baseline.test.ts lib/curate/creative-sandbox-contracts.test.ts lib/curate/creative-sandbox.test.ts lib/curate/deepseek-creative-session.test.ts lib/curate/optional-image-tool.test.ts lib/curate/advisory-visual-review.test.ts lib/curate/run-creative-generation.test.ts lib/curate/creative-sandbox-canary.test.ts lib/curate/curate-route.fable.integration.test.ts";

function repositoryFile(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("AI hybrid release and operations contract", () => {
  it("exposes the exact deterministic focused gate", () => {
    const packageJson = JSON.parse(repositoryFile("package.json")) as { scripts: Record<string, string> };
    expect(packageJson.scripts["generation:ai-hybrid:gate"]).toBe(GATE);
  });

  it("documents fail-closed activation, verification, rollback, privacy, and the bounded seven-case canary", () => {
    const runbook = repositoryFile("docs/generation/ai-hybrid-only-runbook.md");

    expect(runbook).toMatch(/OPENLEN_AI_CREATION=enabled\|disabled/);
    expect(runbook).toMatch(/invalid|inv[aá]lid/i);
    expect(runbook).toMatch(/unset|no configurad/i);
    expect(runbook).toMatch(/disabled/i);
    expect(runbook).toMatch(/never.*legacy fallback|nunca.*fallback legacy/i);
    expect(runbook).toMatch(/OPENLEN_PAGE_COPY_MODEL[\s\S]*CURATE_PICK_MODEL[\s\S]*STYLE_MATCH_TEXT_MODEL[\s\S]*gemini-2\.5-flash/);
    for (const command of [
      "npm.cmd run generation:ai-hybrid:gate",
      "npm.cmd run generation:visual-engine-assets:gate",
      "npm.cmd run typecheck",
      "npm.cmd test",
      "npm.cmd run generation:visual-engine-2a:rollback-check",
      "npm.cmd run build",
      "git diff --check",
    ]) expect(runbook).toContain(command);
    expect(runbook).toMatch(/OPENLEN_AI_CREATION=enabled/);
    expect(runbook).toMatch(/OPENLEN_AI_CREATION=disabled/);
    const operations = runbook.match(/## Production activation and rollback([\s\S]*?)## Separately authorized live canary/)?.[1] ?? "";
    const activation = operations.match(/Activate[\s\S]*?Immediate rollback/)?.[0] ?? "";
    const rollback = operations.match(/Immediate rollback[\s\S]*/)?.[0] ?? "";
    for (const [section, mode] of [[activation, "enabled"], [rollback, "disabled"]] as const) {
      expect(section).toContain(`OPENLEN_AI_CREATION=${mode}`);
      expect(section).toContain("OPENLEN_ENV_LOCAL");
      expect(section).toContain("bash infra/scripts/push-env.sh");
    }
    expect(runbook).toMatch(/one-time authorization|autorizaci[oó]n.*una sola vez/i);
    expect(runbook).toMatch(/positive MXN cap|tope positivo.*MXN/i);
    expect(runbook).toMatch(/one request per case|una solicitud por caso/i);
    expect(runbook).toMatch(/no automatic retr(?:y|ies)|sin reintentos autom[aá]ticos/i);
    expect(runbook).toMatch(/selection is deterministic and model-free/i);
    expect(runbook).toMatch(/section_role_coverage_failed/);
    expect(runbook).toContain("OPENLEN_VISUAL_ENGINE_ASSETS=hybrid");
    expect(runbook).toMatch(/kids-coloring.*first/is);
    expect(runbook).toMatch(/remaining six.*only after Mundo Pincel\s+passes/is);
    for (const id of ["kids-coloring", "horror-experience", "comedy-club", "video-game-launch", "school-website", "cooking-publication", "physical-product-sale"]) {
      expect(runbook).toContain(id);
    }
    expect(runbook).toMatch(/stage.*reasonCode.*contract.*section IDs.*hash.*usage.*cost.*duration/is);
    expect(runbook).toMatch(/brief.*copy.*HTML.*prompt.*raw response.*private URL.*credential.*user identity/is);
  });

  // The runbook drifted once already: it described intent/copy model calls this
  // route no longer makes. These pin the facts an operator acts on.
  it("documents the creative pipeline an operator actually runs", () => {
    const runbook = repositoryFile("docs/generation/ai-hybrid-only-runbook.md");

    expect(runbook).toMatch(/no longer calls a copy or intent model/i);
    expect(runbook).toMatch(/baseline[\s\S]*creative session[\s\S]*advisory review[\s\S]*delivery gate/i);
    expect(runbook).toMatch(/four\s+turns and twelve accepted\s+mutations/i);
    expect(runbook).toMatch(/degradations/);
    expect(runbook).toContain("scripts/creative-sandbox-canary.ts");
    expect(runbook).toContain("--live");
    expect(runbook).toContain("--max-mxn");
    for (const key of [
      "OPENLEN_FABLE_RATE_CARD_VERSION",
      "OPENLEN_FABLE_MXN_PER_USD",
      "OPENLEN_FABLE_PAGE_TARGET_MICROMXN",
      "OPENLEN_FABLE_PAGE_CAP_MICROMXN",
    ]) expect(runbook).toContain(key);
    expect(runbook).toMatch(/probes run first|refused until both/i);
    expect(runbook).toContain("scratch/creative-sandbox/");
  });

  it("runs the focused gate and typecheck exactly once before build can be skipped", () => {
    const deploy = repositoryFile("infra/scripts/deploy.ps1");
    const gateCommand = "npm.cmd run generation:ai-hybrid:gate";
    const typecheckCommand = "npm.cmd run typecheck";
    const skipBuildBranch = /if\s*\(\$env:OPENLEN_SKIP_BUILD\s+-ne\s+"1"\)/i.exec(deploy);

    expect(deploy.split(gateCommand)).toHaveLength(2);
    expect(deploy.split(typecheckCommand)).toHaveLength(2);
    expect(skipBuildBranch).not.toBeNull();
    expect(deploy.indexOf(gateCommand)).toBeLessThan(skipBuildBranch!.index);
    expect(deploy.indexOf(typecheckCommand)).toBeLessThan(skipBuildBranch!.index);
    expect(deploy).toContain('if ($LASTEXITCODE -ne 0) { throw "AI hybrid generation gate failed" }');
    expect(deploy).toContain('if ($LASTEXITCODE -ne 0) { throw "Typecheck failed" }');
  });
});
