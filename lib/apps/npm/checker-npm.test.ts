// @vitest-environment node
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { checkAppInWorker, stopCheckerWorker } from "@/lib/apps/checker/check-app";
import { serializeEsmLock, type LockedPackage } from "./lock";
import { ESM_LOCK_PATH, PACKAGE_JSON_PATH } from "./paths";
import { __setModuleStoreForTest, memoryStore, sha256Hex } from "./store";

const DTS = "export declare const a: string;";
const PKG = JSON.stringify({ name: "typed", types: "index.d.ts" });

function filesWith(withTypes: boolean): Record<string, string> {
  const locked: LockedPackage = {
    version: "1.0.0", publishedAt: "2026-01-01T00:00:00.000Z", externals: [], development: {}, production: {}, assets: {},
    types: withTypes ? { "/node_modules/typed/index.d.ts": sha256Hex(DTS), "/node_modules/typed/package.json": sha256Hex(PKG) } : null,
    warnings: [], bytes: 0,
  };
  return {
    "/src/main.tsx": `import { a } from "typed";\nconst n: number = a;\nexport default n;`,
    [PACKAGE_JSON_PATH]: JSON.stringify({ dependencies: { typed: "^1.0.0" } }),
    [ESM_LOCK_PATH]: serializeEsmLock({ lockfileVersion: 1, packages: { typed: locked } }),
  };
}

afterEach(() => __setModuleStoreForTest(null));
afterAll(() => stopCheckerWorker());

describe("types of installed packages", () => {
  it("🔴 with the lock's types, TypeScript checks the use (string is not number) and finds the module", async () => {
    const store = memoryStore();
    await store.put(sha256Hex(DTS), DTS);
    await store.put(sha256Hex(PKG), PKG);
    __setModuleStoreForTest(store);
    const r = await checkAppInWorker({ files: filesWith(true), catalogo: "2026-11" });
    const codes = (r?.typescript ?? []).map((d) => d.codigo);
    expect(codes).toContain("TS2322");
    expect(codes).not.toContain("TS2307");
  }, 60_000);

  it("🔴 a package's images and fonts are imported as URLs, like Vite's client types say (leaflet's marker-icon.png: TS2307 in the box rehearsal)", async () => {
    __setModuleStoreForTest(memoryStore());
    const files = {
      "/src/main.tsx": [
        'import icon from "leaflet/dist/images/marker-icon.png";',
        'import photo from "pkg/img/a.jpg";',
        'import font from "pkg/fonts/a.woff2";',
        "const urls: string[] = [icon, photo, font];",
        "export default urls;",
      ].join("\n"),
    };
    const r = await checkAppInWorker({ files, catalogo: "2026-11" });
    expect((r?.typescript ?? []).map((d) => `${d.codigo} ${d.mensaje}`)).toEqual([]);
  }, 60_000);

  it("CONTROL: without them, the module isn't found", async () => {
    __setModuleStoreForTest(memoryStore());
    const r = await checkAppInWorker({ files: filesWith(false), catalogo: "2026-11" });
    expect((r?.typescript ?? []).map((d) => d.codigo)).toContain("TS2307");
  }, 60_000);
});
