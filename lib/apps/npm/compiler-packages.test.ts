import { describe, expect, it } from "vitest";
import { compilarCarpeta } from "@/lib/apps/compilador";
import { ESM_LOCK_PATH, PACKAGE_JSON_PATH } from "./paths";
import { serializeEsmLock, type LockedPackage } from "./lock";

const CATALOG = "2026-11";
const lockedThree: LockedPackage = {
  version: "0.186.1",
  publishedAt: "2026-09-24T00:00:00.000Z",
  externals: [],
  development: { "": { entry: "https://esm.sh/three@0.186.1?target=es2022&dev", modules: {} } },
  production: { "": { entry: "https://esm.sh/three@0.186.1?target=es2022", modules: {} } },
  assets: {},
  types: null,
  warnings: [],
  bytes: 0,
};

const app = (source: string, extra: Record<string, string> = {}) => ({
  "/src/main.tsx": source,
  ...extra,
});

describe("compiler and open npm", () => {
  it("lists every package the app imports, resolved or not", () => {
    const r = compilarCarpeta({ carpeta: app(`import { useState } from "react";\nimport * as THREE from "three";\nexport const x = [useState, THREE];`), catalogo: CATALOG });
    expect([...r.paquetes].sort()).toEqual(["react", "three"]);
  });

  it("a package nothing serves is an error that says it installs on save", () => {
    const r = compilarCarpeta({ carpeta: app(`import * as THREE from "three";\nexport default THREE;`), catalogo: CATALOG });
    expect(r.errores.map((e) => e.mensaje).join("\n")).toMatch(/"three" is not installed in this app\. It installs when a file that imports it is saved/);
  });

  it("🔴 a part of a catalog package the catalog doesn't ship installs like any package (as v0: the whole package is there): until then it says so, and npm install with no name installs it", () => {
    const r = compilarCarpeta({ carpeta: app(`import { renderToString } from "react-dom/server";\nexport default renderToString;`), catalogo: CATALOG });
    expect(r.errores.map((e) => e.mensaje)).toEqual([
      `"react-dom/server" is not installed in this app. It installs when a file that imports it is saved (or with npm install); if that failed, the reason is in this same report.`,
    ]);
  });

  it("🔴 a part locked from esm.sh at the catalog's version compiles; the catalog still serves the package itself", () => {
    const set = (mode: string) => ({ entry: `https://esm.sh/zod@3.25.76/v4?target=es2022&external=zod${mode}`, modules: {} });
    const zodParts: LockedPackage = {
      version: "3.25.76", publishedAt: "2025-07-08T00:00:00.000Z", externals: ["zod"], catalogParts: true,
      development: { v4: set("&dev") }, production: { v4: set("") }, assets: {}, types: null, warnings: [], bytes: 0,
    };
    const carpeta = app(`import { z } from "zod";\nimport { z as z4 } from "zod/v4";\nexport default [z, z4];`, {
      [PACKAGE_JSON_PATH]: JSON.stringify({ dependencies: { zod: "^3.25.76" } }),
      [ESM_LOCK_PATH]: serializeEsmLock({ lockfileVersion: 1, packages: { zod: zodParts } }),
    });
    expect(compilarCarpeta({ carpeta, catalogo: CATALOG }).errores).toEqual([]);
    // Another version in /package.json: the parts of the catalog's copy no longer count.
    const other = { ...carpeta, [PACKAGE_JSON_PATH]: JSON.stringify({ dependencies: { zod: "^4.0.0" } }) };
    expect(compilarCarpeta({ carpeta: other, catalogo: CATALOG }).errores.length).toBeGreaterThan(0);
  });

  it("a locked package compiles and stays a bare import for the bundler", () => {
    const r = compilarCarpeta({
      carpeta: app(`import * as THREE from "three";\nexport default THREE;`, {
        [PACKAGE_JSON_PATH]: JSON.stringify({ dependencies: { three: "^0.186.0" } }),
        [ESM_LOCK_PATH]: serializeEsmLock({ lockfileVersion: 1, packages: { three: lockedThree } }),
      }),
      catalogo: CATALOG,
    });
    expect(r.errores).toEqual([]);
    expect(r.ficheros["/src/main.tsx"]).toContain('from "three"');
  });

  it("🔴 the compile cache follows /package.json and the lock: installing a second package (same paths, new contents) clears its «not installed», and uninstalling brings it back", () => {
    // An app that already has both files: the paths don't change, only what they say.
    const source = `import * as THREE from "three";\nexport default THREE;`;
    const without = app(source, { [PACKAGE_JSON_PATH]: JSON.stringify({ dependencies: {} }), [ESM_LOCK_PATH]: serializeEsmLock({ lockfileVersion: 1, packages: {} }) });
    const withThree = app(source, {
      [PACKAGE_JSON_PATH]: JSON.stringify({ dependencies: { three: "^0.186.0" } }),
      [ESM_LOCK_PATH]: serializeEsmLock({ lockfileVersion: 1, packages: { three: lockedThree } }),
    });
    expect(compilarCarpeta({ carpeta: without, catalogo: CATALOG }).errores.map((e) => e.mensaje).join("\n")).toMatch(/"three" is not installed/);
    expect(compilarCarpeta({ carpeta: withThree, catalogo: CATALOG }).errores).toEqual([]);
    expect(compilarCarpeta({ carpeta: without, catalogo: CATALOG }).errores.map((e) => e.mensaje).join("\n")).toMatch(/"three" is not installed/);
  });

  it("🔴 a type-only import installs nothing (sucrase drops it)", () => {
    const r = compilarCarpeta({ carpeta: app(`import type { Mesh } from "three";\nexport const m: Mesh | null = null;`), catalogo: CATALOG });
    expect(r.paquetes).not.toContain("three");
    expect(r.errores).toEqual([]);
  });

  it("a page (no catalog) still says packages are for apps", () => {
    const r = compilarCarpeta({ carpeta: { "/js/a.ts": `import x from "three";\nexport default x;` }, catalogo: null });
    expect(r.errores[0]?.mensaje).toMatch(/packages can only be imported in an app/);
  });
});
