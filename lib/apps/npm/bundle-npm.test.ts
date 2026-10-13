// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bundleApp, stopBundlerWorker } from "@/lib/apps/bundler/bundle-app";
import { npmForBundle } from "./for-bundle";
import { serializeEsmLock, type LockedPackage } from "./lock";
import { ESM_LOCK_PATH, PACKAGE_JSON_PATH } from "./paths";
import { __setModuleStoreForTest, memoryStore, sha256Hex, type ModuleStore } from "./store";
import { startFakeNpm, type FakeNpm } from "./test-support/fake-npm";

const APP = { catalogo: "2026-11", entrada: "/src/main.tsx" };
let npm: FakeNpm;
let store: ModuleStore;

/** A locked package whose one module is `code`, served at `${origin}/<name>@<version>/x.mjs`, plus optional assets. */
function lockFor(origin: string, name: string, version: string, code: string, assets: Record<string, string> = {}): { locked: LockedPackage; modules: Record<string, string>; assetTexts: Record<string, string> } {
  const url = `${origin}/${name}@${version}/x.mjs`;
  const sha = sha256Hex(code);
  const set = { entry: url, modules: { [url]: sha } };
  return {
    locked: {
      version, publishedAt: "2026-01-01T00:00:00.000Z", externals: [], development: { "": set }, production: { "": set },
      assets: Object.fromEntries(Object.entries(assets).map(([p, t]) => [p, sha256Hex(t)])), types: null, warnings: [], bytes: code.length,
    },
    modules: { [url]: code },
    assetTexts: assets,
  };
}

async function seed(entries: ReturnType<typeof lockFor>[]): Promise<void> {
  for (const e of entries) {
    for (const code of Object.values(e.modules)) await store.put(sha256Hex(code), code);
    for (const text of Object.values(e.assetTexts)) await store.put(sha256Hex(text), text);
  }
}

const filesWith = (source: string, deps: Record<string, string>, packages: Record<string, LockedPackage>) => ({
  "/src/main.tsx": source,
  [PACKAGE_JSON_PATH]: JSON.stringify({ dependencies: deps }),
  [ESM_LOCK_PATH]: serializeEsmLock({ lockfileVersion: 1, packages }),
});

const PIN = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

beforeAll(async () => {
  npm = await startFakeNpm({
    now: new Date(),
    packages: [],
    modules: { "/tiny@1.0.0/x.mjs": `export default function tiny() { return "tiny-from-esm"; }` },
    raw: { "map2@1.0.0/dist/map.css": ".m2{color:blue}", "map2@1.0.0/img/pin.png": PIN, "map3@1.0.0/dist/map.css": ".m3{color:green}" },
  });
});
afterAll(async () => {
  stopBundlerWorker();
  await npm.close();
});
beforeEach(() => {
  store = memoryStore();
  __setModuleStoreForTest(store);
});
afterEach(() => __setModuleStoreForTest(null));

describe("bundling packages from the esm lock", () => {
  it("a locked package goes into the one bundle, in both modes", async () => {
    const tiny = lockFor(npm.origin, "tiny", "1.0.0", `export default function tiny() { return "tiny-from-esm"; }`);
    await seed([tiny]);
    const files = filesWith(`import tiny from "tiny";\ndocument.title = tiny();`, { tiny: "^1.0.0" }, { tiny: tiny.locked });
    for (const modo of ["desarrollo", "produccion"] as const) {
      const r = await bundleApp({ carpeta: files, app: APP, modo });
      expect(r?.ok, JSON.stringify(r)).toBe(true);
      if (r?.ok) expect(r.js).toContain("tiny-from-esm");
    }
  });

  it("🔴 a catalog package asked in another version comes from esm.sh, and the catalog's copy stays out", async () => {
    const recharts = lockFor(npm.origin, "recharts", "3.1.0", `export const BarChart = "esm-recharts";`);
    await seed([recharts]);
    const files = filesWith(`import { BarChart } from "recharts";\ndocument.title = BarChart;`, { recharts: "^3.0.0" }, { recharts: recharts.locked });
    const r = await bundleApp({ carpeta: files, app: APP, modo: "desarrollo" });
    if (!r?.ok) throw new Error(JSON.stringify(r));
    expect(r.js).toContain("esm-recharts");
    expect((JSON.parse(r.map!) as { sources: string[] }).sources.some((s) => s.includes("/openlen/vendor/2026-11/recharts"))).toBe(false);
  });

  it("🔴 a part of a catalog package (zod/v4) comes from the lock, and what it imports of the package itself is the catalog's copy", async () => {
    const code = `import { z } from "zod";\nexport const z4 = "zod-v4-from-esm";\nexport const same = z;`;
    const url = `${npm.origin}/zod@3.25.76/X-ZXpvZA/es2022/v4.mjs`;
    const set = { entry: url, modules: { [url]: sha256Hex(code) } };
    const zod: LockedPackage = {
      version: "3.25.76", publishedAt: "2025-07-08T00:00:00.000Z", externals: ["zod"], catalogParts: true,
      development: { v4: set }, production: { v4: set }, assets: {}, types: null, warnings: [], bytes: code.length,
    };
    await store.put(sha256Hex(code), code);
    const files = filesWith(`import { z } from "zod";\nimport { z4, same } from "zod/v4";\nconsole.log(z4, same === z);`, { zod: "^3.25.76" }, { zod });
    const r = await bundleApp({ carpeta: files, app: APP, modo: "desarrollo" });
    if (!r?.ok) throw new Error(JSON.stringify(r));
    expect(r.js).toContain("zod-v4-from-esm");
    const sources = (JSON.parse(r.map!) as { sources: string[] }).sources;
    expect(sources.some((s) => s.includes("/openlen/vendor/2026-11/zod"))).toBe(true);
    // One zod: no esm.sh build of the package itself.
    expect(sources.filter((s) => /zod@/.test(s))).toEqual([expect.stringContaining("/zod@3.25.76/X-ZXpvZA/es2022/v4.mjs")]);
  });

  it("React imported from a package is the catalog's", async () => {
    const hooky = lockFor(npm.origin, "hooky", "1.0.0", `import { useState } from "react";\nexport const s = useState;`);
    await seed([hooky]);
    const files = filesWith(`import { s } from "hooky";\nimport { useState } from "react";\nconsole.log(s === useState);`, { hooky: "^1.0.0" }, { hooky: hooky.locked });
    const r = await bundleApp({ carpeta: files, app: APP, modo: "desarrollo" });
    if (!r?.ok) throw new Error(JSON.stringify(r));
    const sources = (JSON.parse(r.map!) as { sources: string[] }).sources;
    // React comes from the catalog's vendor files, never from an esm.sh path.
    expect(sources.some((s) => s.includes("/openlen/vendor/2026-11/"))).toBe(true);
    expect(sources.some((s) => /\/react@\d/.test(s))).toBe(false);
  });

  it("a package's CSS is injected and its image is a data: URL", async () => {
    const map = lockFor(npm.origin, "map", "1.0.0", `export default 1;`, { "dist/map.css": ".m{color:red}", "img/pin.png": "data:image/png;base64,AAAA" });
    await seed([map]);
    const files = filesWith(`import "map/dist/map.css";\nimport pin from "map/img/pin.png";\ndocument.title = pin;`, { map: "^1.0.0" }, { map: map.locked });
    const r = await bundleApp({ carpeta: files, app: APP, modo: "desarrollo" });
    if (!r?.ok) throw new Error(JSON.stringify(r));
    expect(r.js).toContain(".m{color:red}");
    expect(r.js).toContain('document.createElement("style")');
    expect(r.js).toContain("data:image/png;base64,AAAA");
  });

  it("🔴 cache lost: a package's CSS and image come back from esm.sh, checked against their hash (measured against the real esm.sh with leaflet)", async () => {
    const pin = `data:image/png;base64,${Buffer.from(PIN).toString("base64")}`;
    const map = lockFor(npm.origin, "map2", "1.0.0", `export default 1;`, { "dist/map.css": ".m2{color:blue}", "img/pin.png": pin });
    // Only the module is in the cache; the CSS and the image are not.
    for (const code of Object.values(map.modules)) await store.put(sha256Hex(code), code);
    const files = filesWith(`import "map2/dist/map.css";\nimport p from "map2/img/pin.png";\ndocument.title = p;`, { map2: "^1.0.0" }, { map2: map.locked });
    const r = await bundleApp({ carpeta: files, app: APP, modo: "desarrollo" });
    if (!r?.ok) throw new Error(JSON.stringify(r));
    expect(r.js).toContain(".m2{color:blue}");
    expect(r.js).toContain(pin);
  });

  it("cache lost and esm.sh gives back a different file: the error names the package", async () => {
    const map = lockFor(npm.origin, "map3", "1.0.0", `export default 3;`, { "dist/map.css": ".m3{color:red}" });
    for (const code of Object.values(map.modules)) await store.put(sha256Hex(code), code);
    const files = filesWith(`import "map3/dist/map.css";\ndocument.title = "x";`, { map3: "^1.0.0" }, { map3: map.locked });
    const r = await bundleApp({ carpeta: files, app: APP, modo: "desarrollo" });
    expect(r?.ok).toBe(false);
    if (r && !r.ok) expect(r.errores[0]?.mensaje).toMatch(/^map3: map3\/dist\/map\.css is missing from the package cache/);
  });

  it("🔴 cache lost: fetched again from esm.sh by its exact URL if the hash matches", async () => {
    const tiny = lockFor(npm.origin, "tiny", "1.0.0", `export default function tiny() { return "tiny-from-esm"; }`);
    const files = filesWith(`import tiny from "tiny";\ndocument.title = tiny();`, { tiny: "^1.0.0" }, { tiny: tiny.locked });
    const r = await bundleApp({ carpeta: files, app: APP, modo: "desarrollo" });
    expect(r?.ok).toBe(true);
  });

  it("🔴 cache lost: the modules come back from esm.sh several at a time, not one after another", async () => {
    const codes = Array.from({ length: 6 }, (_, i) => `export const m${i} = ${i};`);
    const urls = codes.map((_, i) => `https://esm.example/many@1.0.0/m${i}.mjs`);
    const set = { entry: urls[0]!, modules: Object.fromEntries(urls.map((u, i) => [u, sha256Hex(codes[i]!)])) };
    const many: LockedPackage = {
      version: "1.0.0", publishedAt: "2026-01-01T00:00:00.000Z", externals: [], development: { "": set }, production: { "": set },
      assets: {}, types: null, warnings: [], bytes: 0,
    };
    let inFlight = 0;
    let most = 0;
    const slowFetch = async (url: string | URL | Request) => {
      inFlight++;
      most = Math.max(most, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight--;
      return new Response(codes[urls.indexOf(String(url))] ?? "", { status: 200 });
    };
    const files = filesWith(`import "many";`, { many: "^1.0.0" }, { many });
    const r = await npmForBundle(files, APP, "development", { store: memoryStore(), fetch: slowFetch });
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.keys(r.npm!.modules).sort()).toEqual([...urls].sort());
    expect(most).toBeGreaterThan(1);
    expect(most).toBeLessThanOrEqual(8);
  });

  it("🔴 cache lost and esm.sh down: the error names the package and the fix", async () => {
    const tiny = lockFor(npm.origin, "tiny", "1.0.0", `export default function tiny() { return "tiny-from-esm"; }`);
    npm.setDown("esm", true);
    const files = filesWith(`import tiny from "tiny";\ndocument.title = tiny() + "x";`, { tiny: "^1.0.0" }, { tiny: tiny.locked });
    const r = await bundleApp({ carpeta: files, app: APP, modo: "desarrollo" });
    npm.setDown("esm", false);
    expect(r?.ok).toBe(false);
    if (r && !r.ok) expect(r.errores[0]?.mensaje).toMatch(/^tiny: .* Run npm install tiny to install it again\.$/);
  });

  it("an app without package.json bundles exactly as before", async () => {
    const r = await bundleApp({ carpeta: { "/src/main.tsx": `import { useState } from "react";\nconsole.log(useState);` }, app: APP, modo: "desarrollo" });
    expect(r?.ok).toBe(true);
  });
});
