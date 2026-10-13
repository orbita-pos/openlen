// @vitest-environment node
import { describe, expect, it } from "vitest";
import { serializeEsmLock, type LockedPackage } from "./lock";
import { nodeModulesOf } from "./node-modules";
import { ESM_LOCK_PATH, PACKAGE_JSON_PATH } from "./paths";

const DTS = "export declare function map(id: string): Map;";

function locked(over: Partial<LockedPackage> = {}): LockedPackage {
  return { version: "1.9.4", publishedAt: "2026-01-01T00:00:00.000Z", externals: [], development: {}, production: {}, assets: {}, types: null, warnings: [], bytes: 0, ...over };
}

function app(packages: Record<string, LockedPackage>, dependencies: Record<string, string>): Record<string, string> {
  return {
    "/src/main.tsx": "",
    [PACKAGE_JSON_PATH]: JSON.stringify({ dependencies }),
    [ESM_LOCK_PATH]: serializeEsmLock({ lockfileVersion: 1, packages }),
  };
}

describe("the app's /node_modules", () => {
  it("🔴 the catalog's and the test kit's packages: their package.json and .d.ts, read from types.json", async () => {
    const nm = nodeModulesOf({ "/src/main.tsx": "" }, "2026-11");
    expect(nm.paths).toContain("/node_modules/lucide-react/package.json");
    expect(nm.paths).toContain("/node_modules/@types/react/index.d.ts");
    expect(nm.paths).toContain("/node_modules/@testing-library/react/package.json");
    expect(nm.paths.every((p) => p.startsWith("/node_modules/"))).toBe(true);
    expect(nm.paths.some((p) => /\.(?:m?js|cjs)$/.test(p))).toBe(false);
    expect(JSON.parse((await nm.read("/node_modules/lucide-react/package.json"))!)).toMatchObject({ name: "lucide-react" });
    expect(await nm.read("/node_modules/nope/index.d.ts")).toBeNull();
  });

  it("🔴 an installed package: the lock's .d.ts with their text, and a package.json when its types came from @types (leaflet → @types/leaflet)", async () => {
    const files = app(
      { leaflet: locked({ types: { "/node_modules/@types/leaflet/index.d.ts": "sha" }, typesFrom: { name: "@types/leaflet", version: "1.9.20" } }) },
      { leaflet: "^1.9.4" },
    );
    let asked = 0;
    const nm = nodeModulesOf(files, "2026-11", {
      npmTypes: async () => {
        asked++;
        return { "/node_modules/@types/leaflet/index.d.ts": DTS };
      },
    });
    expect(nm.paths).toContain("/node_modules/@types/leaflet/index.d.ts");
    expect(nm.paths).toContain("/node_modules/leaflet/package.json");
    expect(asked).toBe(0);
    expect(await nm.read("/node_modules/@types/leaflet/index.d.ts")).toBe(DTS);
    expect(JSON.parse((await nm.read("/node_modules/leaflet/package.json"))!)).toEqual({ name: "leaflet", version: "1.9.4" });
    await nm.read("/node_modules/@types/leaflet/index.d.ts");
    expect(asked).toBe(1);
  });

  it("a catalog package installed at another version: only the lock's files of it, not the catalog's", () => {
    const files = app({ "lucide-react": locked({ version: "0.300.0", types: { "/node_modules/lucide-react/dist/x.d.ts": "sha" } }) }, { "lucide-react": "0.300.0" });
    const nm = nodeModulesOf(files, "2026-11", { npmTypes: async () => ({}) });
    expect(nm.paths.filter((p) => p.startsWith("/node_modules/lucide-react/"))).toEqual(["/node_modules/lucide-react/dist/x.d.ts", "/node_modules/lucide-react/package.json"]);
  });

  it("a package in package.json the lock doesn't serve isn't there (npm ls says it's missing)", () => {
    const nm = nodeModulesOf(app({}, { leaflet: "^1.9.4" }), "2026-11", { npmTypes: async () => ({}) });
    expect(nm.paths.some((p) => p.startsWith("/node_modules/leaflet/"))).toBe(false);
  });
});
