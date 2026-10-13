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

  it("🔴 a part of a catalog package the catalog doesn't ship says so, and doesn't promise an install that never comes", () => {
    const r = compilarCarpeta({ carpeta: app(`import { renderToString } from "react-dom/server";\nexport default renderToString;`), catalogo: CATALOG });
    const message = r.errores.map((e) => e.mensaje).join("\n");
    expect(message).toBe(
      `"react-dom/server" is not part of this app's react-dom: react-dom comes preinstalled from the catalog, with react-dom and react-dom/client only, and other parts of it can't be installed on top (one copy of each package).`,
    );
    const zod = compilarCarpeta({ carpeta: app(`import { z } from "zod/v4";\nexport default z;`), catalogo: CATALOG });
    expect(zod.errores[0]?.mensaje).toMatch(/^"zod\/v4" is not part of this app's zod: zod comes preinstalled from the catalog, with zod only,/);
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
