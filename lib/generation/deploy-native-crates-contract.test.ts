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

  // LA MISMA VERDAD, ESCRITA DOS VECES. `deploy.ps1` decide qué wrappers viajan
  // en el tar; `build-crates-on-box.sh` decide qué `.node` se compilan en la
  // caja. Son listas separadas, y el 2026-08-28 se barrió sólo la primera: la
  // segunda siguió nombrando `ai-gateway` y el despliegue del día siguiente
  // murió en el paso 6.5 intentando compilar un crate borrado —después de 25
  // minutos de tar y de subir 625 MB.
  //
  // Esta prueba no comprueba que la lista sea correcta: comprueba que las DOS
  // digan lo mismo, que es lo que no puede volver a fallar.
  it("la caja compila exactamente los crates que el tar lleva", () => {
    const ps1 = readFileSync(
      join(process.cwd(), "infra", "scripts", "deploy.ps1"),
      "utf8",
    );
    const sh = readFileSync(
      join(process.cwd(), "infra", "scripts", "build-crates-on-box.sh"),
      "utf8",
    );

    const enElTar = ps1.match(/\$nativeCrates = @\(([^)]*)\)/)?.[1];
    expect(enElTar, "deploy.ps1 ya no declara $nativeCrates").toBeDefined();
    const delTar = [...enElTar!.matchAll(/"([\w-]+)"/g)].map((m) => m[1]);

    const enLaCaja = sh.match(/^CRATES=\(([^)]*)\)/m)?.[1];
    expect(enLaCaja, "build-crates-on-box.sh ya no declara CRATES").toBeDefined();
    const deLaCaja = enLaCaja!.trim().split(/\s+/).filter(Boolean);

    expect([...deLaCaja].sort()).toEqual([...delTar].sort());
  });
});
