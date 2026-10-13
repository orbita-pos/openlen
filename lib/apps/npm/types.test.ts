// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serializeEsmLock, type LockedPackage } from "./lock";
import { ESM_LOCK_PATH, PACKAGE_JSON_PATH } from "./paths";
import { clearPackumentCache } from "./registry";
import { memoryStore, sha256Hex } from "./store";
import { fetchTypes } from "./types";
import { npmTypesFor } from "./types-for-check";
import { startFakeNpm, type FakeNpm } from "./test-support/fake-npm";

const NOW = new Date("2026-10-13T12:00:00.000Z");
let npm: FakeNpm;
let restore: () => void;

beforeAll(async () => {
  npm = await startFakeNpm({
    now: NOW,
    packages: [{ name: "@types/untyped", createdDaysAgo: 900, versions: { "2.3.0": { daysAgo: 100 }, "3.0.0": { daysAgo: 50 } } }],
    raw: {
      "typed@1.0.0/package.json": JSON.stringify({ name: "typed", types: "dist/index.d.ts" }),
      "typed@1.0.0/dist/index.d.ts": `export * from "./a";\nexport { B } from "./b.js";\n/// <reference path="./globals.d.ts" />`,
      "typed@1.0.0/dist/a.d.ts": "export declare const a: string;",
      "typed@1.0.0/dist/b.d.ts": "export declare class B {}",
      "typed@1.0.0/dist/globals.d.ts": "declare const G: number;",
      "untyped@2.3.4/package.json": JSON.stringify({ name: "untyped", main: "index.js" }),
      "@types/untyped@2.3.0/package.json": JSON.stringify({ name: "@types/untyped", types: "index.d.ts" }),
      "@types/untyped@2.3.0/index.d.ts": "export declare function u(): void;",
    },
  });
  restore = npm.useEnv();
  clearPackumentCache();
});
afterAll(async () => {
  restore();
  await npm.close();
});

const opts = () => ({ fetch, gate: { fetch, now: () => NOW }, deadline: Date.now() + 10_000, origin: npm.origin });

describe("fetchTypes", () => {
  it("follows the package's own .d.ts files into a virtual node_modules", async () => {
    const files = await fetchTypes("typed", "1.0.0", opts());
    expect(Object.keys(files?.files ?? {}).sort()).toEqual([
      "/node_modules/typed/dist/a.d.ts",
      "/node_modules/typed/dist/b.d.ts",
      "/node_modules/typed/dist/globals.d.ts",
      "/node_modules/typed/dist/index.d.ts",
      "/node_modules/typed/package.json",
    ]);
  });

  it("without its own types, @types/<name> at the same major.minor", async () => {
    const files = await fetchTypes("untyped", "2.3.4", opts());
    expect(files?.files["/node_modules/@types/untyped/index.d.ts"]).toBe("export declare function u(): void;");
  });

  it("no types anywhere → null", async () => {
    expect(await fetchTypes("nothing", "1.0.0", opts())).toBeNull();
  });

  it("🔴 says which package and version the types came from (to fetch them again)", async () => {
    expect(await typesSource("typed", "1.0.0")).toEqual({ name: "typed", version: "1.0.0" });
    expect(await typesSource("untyped", "2.3.4")).toEqual({ name: "@types/untyped", version: "2.3.0" });
  });
});

async function typesSource(name: string, version: string) {
  const got = await fetchTypes(name, version, opts());
  return got && { name: got.name, version: got.version };
}

describe("npmTypesFor", () => {
  const lockFor = (name: string, version: string, types: Record<string, string>, typesFrom?: { name: string; version: string }): LockedPackage => {
    const set = { entry: `${npm.origin}/${name}@${version}?target=es2022&dev`, modules: {} };
    return { version, publishedAt: "2026-01-01T00:00:00.000Z", externals: [], development: { "": set }, production: { "": set }, assets: {}, types, warnings: [], bytes: 0, ...(typesFrom ? { typesFrom } : {}) };
  };

  it("🔴 a .d.ts the cache lost is fetched again from esm.sh (its own types, or the @types the lock names), checked against its hash", async () => {
    const typed = await fetchTypes("typed", "1.0.0", opts());
    const untyped = await fetchTypes("untyped", "2.3.4", opts());
    const shas = (f: Record<string, string>) => Object.fromEntries(Object.entries(f).map(([p, t]) => [p, sha256Hex(t)]));
    const files = {
      [PACKAGE_JSON_PATH]: JSON.stringify({ dependencies: { typed: "^1.0.0", untyped: "^2.3.4" } }),
      [ESM_LOCK_PATH]: serializeEsmLock({
        lockfileVersion: 1,
        packages: { typed: lockFor("typed", "1.0.0", shas(typed!.files)), untyped: lockFor("untyped", "2.3.4", shas(untyped!.files), { name: "@types/untyped", version: "2.3.0" }) },
      }),
    };
    const store = memoryStore();
    const out = await npmTypesFor(files, "2026-11", store, fetch);
    expect(out).toEqual({ ...typed!.files, ...untyped!.files });
    for (const text of Object.values(out)) expect(await store.get(sha256Hex(text))).toBe(text);
  });

  it("CONTROL: what esm.sh gives back with another hash is not used", async () => {
    const files = {
      [PACKAGE_JSON_PATH]: JSON.stringify({ dependencies: { typed: "^1.0.0" } }),
      [ESM_LOCK_PATH]: serializeEsmLock({ lockfileVersion: 1, packages: { typed: lockFor("typed", "1.0.0", { "/node_modules/typed/dist/a.d.ts": sha256Hex("something else") }) } }),
    };
    expect(await npmTypesFor(files, "2026-11", memoryStore(), fetch)).toEqual({});
  });
});
