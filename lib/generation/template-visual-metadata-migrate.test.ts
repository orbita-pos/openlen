import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const migrationPath = resolve(root, "scripts/template-visual-metadata-migrate.ts");
const bundle = readFileSync(resolve(root, "scripts/build-migrations.mjs"), "utf8");

describe("template visual metadata production migration", () => {
  it("ships the idempotent column migration before Visual Engine pilot tables", () => {
    expect(existsSync(migrationPath)).toBe(true);
    expect(bundle).toContain('"template-visual-metadata-migrate"');
    expect(bundle.indexOf('"template-visual-metadata-migrate"')).toBeLessThan(
      bundle.indexOf('"visual-engine-pilot-migrate"'),
    );
  });
});
