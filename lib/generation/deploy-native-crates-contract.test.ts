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
    // TRES, no cuatro: `ai-gateway` salio del repo el 2026-08-28 con Gemini.
    // La lista se fija LITERAL a proposito — es la que decide que `.node`
    // sobreviven al intercambio atomico, y un crate que falte aqui produce un
    // despliegue que arranca y se cae al primer import nativo.
    expect(compose).toContain(
      '$nativeCrates = @("html-engine", "images", "rate-limit")',
    );
    expect(compose).toContain(
      'Copy-Item -Force "$sourceDir/index.js", "$sourceDir/index.d.ts", "$sourceDir/package.json" $targetDir',
    );
    expect(compose).toContain(
      'if (-not (Test-Path "$targetDir/index.js")) { throw "Missing native crate wrapper: $crate" }',
    );
    // Resuelto POR RUTA, no por PATH: bajo Git Bash `tar` es el GNU tar, que no
    // entiende `--options` y tumba el empaquetado. El de Windows es bsdtar y
    // vive en System32. Esto se rompió en un deploy real.
    expect(script).toContain(
      '$bsdTar = Join-Path $env:SystemRoot (Join-Path "System32" "tar.exe")',
    );
    expect(script).toContain(
      '& $bsdTar --options "gzip:compression-level=1" -czf $tarballName -C .next/standalone .',
    );
  });
});
