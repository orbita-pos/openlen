import { describe, expect, it } from "vitest";
import { ESM_LOCK_PATH, PACKAGE_JSON_PATH } from "./paths";
import { catalogRange, catalogServes, catalogVersionOf, readEsmLock, serializeEsmLock, sourceOf, type EsmLock, type LockedPackage } from "./lock";

const CATALOG = "2026-11";

const locked = (version: string): LockedPackage => ({
  version,
  publishedAt: "2026-09-01T00:00:00.000Z",
  externals: [],
  development: { "": { entry: `https://esm.sh/three@${version}?target=es2022&dev`, modules: {} } },
  production: { "": { entry: `https://esm.sh/three@${version}?target=es2022`, modules: {} } },
  assets: {},
  types: null,
  warnings: [],
  bytes: 0,
});

const filesWith = (dependencies: Record<string, string> | null, packages: Record<string, LockedPackage> = {}) => {
  const files: Record<string, string> = {};
  if (dependencies) files[PACKAGE_JSON_PATH] = JSON.stringify({ dependencies });
  const lock: EsmLock = { lockfileVersion: 1, packages };
  files[ESM_LOCK_PATH] = serializeEsmLock(lock);
  return files;
};

describe("catalog versions", () => {
  it("knows the catalog's packages, their aliases and the ones inside radix-ui", () => {
    expect(catalogVersionOf(CATALOG, "react")).toBe("19.2.6");
    expect(catalogVersionOf(CATALOG, "react-router-dom")).toBe("7.18.4");
    expect(catalogVersionOf(CATALOG, "@radix-ui/react-dialog")).toMatch(/^\d+\.\d+\.\d+$/);
    expect(catalogServes(CATALOG, "@hookform/resolvers")).toBe(true);
    expect(catalogServes(CATALOG, "three")).toBe(false);
    expect(catalogRange(CATALOG, "recharts")).toBe("^2.15.4");
  });
});

describe("sourceOf", () => {
  it("react and react-dom are always the catalog's, whatever package.json says", () => {
    expect(sourceOf("react", filesWith({ react: "^18.0.0" }), CATALOG)).toEqual({ kind: "catalog" });
  });

  it("without package.json, the catalog serves what it has and the rest is missing (today's behaviour)", () => {
    expect(sourceOf("recharts", filesWith(null), CATALOG)).toEqual({ kind: "catalog" });
    expect(sourceOf("three", filesWith(null), CATALOG)).toEqual({ kind: "missing", range: null });
  });

  it("a locked package whose version satisfies package.json is served by esm.sh", () => {
    const r = sourceOf("three", filesWith({ three: "^0.186.0" }, { three: locked("0.186.1") }), CATALOG);
    expect(r.kind).toBe("esm");
  });

  it("🔴 an orphan lock entry (package.json no longer lists it, e.g. after undo) serves nothing", () => {
    expect(sourceOf("three", filesWith({}, { three: locked("0.186.1") }), CATALOG)).toEqual({ kind: "missing", range: null });
  });

  it("a lock entry that no longer satisfies the range is missing, with the range", () => {
    expect(sourceOf("three", filesWith({ three: "^0.190.0" }, { three: locked("0.186.1") }), CATALOG)).toEqual({ kind: "missing", range: "^0.190.0" });
  });

  it("🔴 a catalog package asked in another version leaves the catalog: esm.sh if locked, missing if not", () => {
    expect(sourceOf("recharts", filesWith({ recharts: "^3.0.0" }), CATALOG)).toEqual({ kind: "missing", range: "^3.0.0" });
    expect(sourceOf("recharts", filesWith({ recharts: "^3.0.0" }, { recharts: locked("3.1.0") }), CATALOG).kind).toBe("esm");
    expect(sourceOf("recharts", filesWith({ recharts: "^2.15.0" }), CATALOG)).toEqual({ kind: "catalog" });
  });

  it("a range that isn't semver (git, file:) never satisfies", () => {
    expect(sourceOf("three", filesWith({ three: "github:mrdoob/three.js" }, { three: locked("0.186.1") }), CATALOG).kind).toBe("missing");
  });

  it("a broken lock reads as empty", () => {
    expect(readEsmLock({ [ESM_LOCK_PATH]: "{ nope" }).packages).toEqual({});
  });
});
