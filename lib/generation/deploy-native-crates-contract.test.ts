import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("production deploy native crate packaging", () => {
  it("materializes every native package wrapper before creating the standalone tarball", () => {
    const script = readFileSync(
      join(process.cwd(), "infra", "scripts", "deploy.ps1"),
      "utf8",
    );
    const composeStart = script.indexOf("# --- 3. Compose standalone");
    const tarStart = script.indexOf("# --- 4. Tar locally");
    const compose = script.slice(composeStart, tarStart);

    expect(composeStart).toBeGreaterThanOrEqual(0);
    expect(tarStart).toBeGreaterThan(composeStart);
    expect(compose).toContain(
      '$nativeCrates = @("html-engine", "ai-gateway", "images", "rate-limit")',
    );
    expect(compose).toContain(
      'Copy-Item -Force "$sourceDir/index.js", "$sourceDir/index.d.ts", "$sourceDir/package.json" $targetDir',
    );
    expect(compose).toContain(
      'if (-not (Test-Path "$targetDir/index.js")) { throw "Missing native crate wrapper: $crate" }',
    );
    expect(script).toContain(
      '& tar --options "gzip:compression-level=1" -czf $tarballName -C .next/standalone .',
    );
  });
});
