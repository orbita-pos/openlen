import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import versions from "./catalog-versions.json";

const ROOT = join(import.meta.dirname, "..", "..", "..");

describe("catalog-versions.json", () => {
  it("🔴 matches each catalog's lockfile (regenerate with npx tsx scripts/app-catalog-versions.ts)", () => {
    for (const [catalog, table] of Object.entries(versions as Record<string, Record<string, string>>)) {
      const lockPath = join(ROOT, "scripts", "app-catalog", catalog, "package-lock.json");
      if (!existsSync(lockPath)) continue;
      const lock = JSON.parse(readFileSync(lockPath, "utf8")) as { packages: Record<string, { version?: string }> };
      for (const [name, version] of Object.entries(table)) {
        const installed = lock.packages[`node_modules/${name}`]?.version;
        if (installed) expect(version, `${catalog} ${name}`).toBe(installed);
      }
    }
  });
});
