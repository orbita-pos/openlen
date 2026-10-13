// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clearPackumentCache } from "./registry";
import { fetchTypes } from "./types";
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
    expect(Object.keys(files ?? {}).sort()).toEqual([
      "/node_modules/typed/dist/a.d.ts",
      "/node_modules/typed/dist/b.d.ts",
      "/node_modules/typed/dist/globals.d.ts",
      "/node_modules/typed/dist/index.d.ts",
      "/node_modules/typed/package.json",
    ]);
  });

  it("without its own types, @types/<name> at the same major.minor", async () => {
    const files = await fetchTypes("untyped", "2.3.4", opts());
    expect(files?.["/node_modules/@types/untyped/index.d.ts"]).toBe("export declare function u(): void;");
  });

  it("no types anywhere → null", async () => {
    expect(await fetchTypes("nothing", "1.0.0", opts())).toBeNull();
  });
});
