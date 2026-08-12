import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
describe("template-derived release gate contract", () => {
  it("lists each required release suite exactly once", () => {
    const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
    const command = String(pkg.scripts["generation:template-derived-sections:gate"]);
    const required = ["template-section-corpus.test.ts", "template-section-extractor.test.ts", "derived-section-compiler.test.ts", "derived-section-persistence.test.ts", "sections-derived-rollback.test.ts", "section-inventory.test.ts", "compose-sections.test.ts", "gemini-section-spec-provider.test.ts", "generate-missing-section.test.ts", "template-derived-niche-cohort.test.ts", "template-derived-sections-canary.test.ts", "run-ai-creation.test.ts", "explicit-template-clone-contract.test.ts"];
    for (const file of required) expect(command.match(new RegExp(file.replaceAll(".", "\\."), "g"))).toHaveLength(1);
    for (const path of command.split(/\s+/).filter((value: string) => value.endsWith(".test.ts"))) expect(readFileSync(resolve(root, path), "utf8").length).toBeGreaterThan(0);
  });
  it("cannot skip template-derived, assets, hybrid or typecheck gates with OPENLEN_SKIP_BUILD", () => {
    const source = readFileSync(resolve(root, "infra/scripts/deploy.ps1"), "utf8");
    const skip = source.indexOf('if ($env:OPENLEN_SKIP_BUILD');
    for (const command of ["generation:template-derived-sections:gate", "generation:visual-engine-assets:gate", "generation:ai-hybrid:gate", "npm.cmd run typecheck"]) {
      const index = source.indexOf(command); expect(index).toBeGreaterThan(-1); expect(index).toBeLessThan(skip); expect(source.indexOf(command, index + 1)).toBe(-1);
    }
  });
  it("documents immutable publication, privacy, bounded canary and explicit-clone separation", () => {
    const doc = readFileSync(resolve(root, "docs/generation/template-derived-sections-runbook.md"), "utf8");
    for (const phrase of ["exactly 451", "Repeat dry compile", "one database transaction", "at most two roles", "at least two real donors", "never HTML, CSS, JavaScript, URLs or copy values", "one sequential attempt per fixture", "positive MXN cap", "explicit template cloning remains available", "sections:derived-rollback", "prior-catalog-sha256"]) expect(doc).toContain(phrase);
  });
  it("bundles the idempotent migration, preserves immutable history, and keeps operational output redacted", () => {
    const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
    const canary = String(pkg.scripts["generation:template-derived-sections:canary"]);
    expect(canary.indexOf("--require ./scripts/test-node-server-only-shim.cjs")).toBeLessThan(canary.indexOf("scripts/template-derived-sections-canary.ts"));

    const migrations = readFileSync(resolve(root, "scripts/build-migrations.mjs"), "utf8");
    expect(migrations).toContain('"sections-derived-migrate"');
    const migration = readFileSync(resolve(root, "scripts/sections-derived-migrate.ts"), "utf8");
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "templateDerivedCanaryRuns"');
    expect(migration).not.toContain("console.error(error");

    const compiler = readFileSync(resolve(root, "scripts/sections-compile-templates.ts"), "utf8");
    expect(compiler).toContain('"history"');
    expect(compiler).toContain("report.catalogManifestHash.replace");
    expect(compiler).not.toContain("error.message");
  });
});
