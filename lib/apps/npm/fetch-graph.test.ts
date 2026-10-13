// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetchGraph } from "./fetch-graph";
import { startFakeNpm, type FakeNpm } from "./test-support/fake-npm";

let npm: FakeNpm;
const MODULES = {
  "/tiny@1.0.0?target=es2022": `/* esm.sh - tiny@1.0.0 */\nexport * from "/tiny@1.0.0/es2022/tiny.mjs";\nexport { default } from "/tiny@1.0.0/es2022/tiny.mjs";`,
  "/tiny@1.0.0/es2022/tiny.mjs": `import "/dep@^2.0.0?target=es2022";\nimport * as R from "react";\nexport default function tiny() { return "tiny"; }`,
  "/dep@^2.0.0?target=es2022": `export * from "/dep@2.0.1/es2022/dep.mjs";`,
  "/dep@2.0.1/es2022/dep.mjs": `export const dep = 1;`,
  "/evil@1.0.0?target=es2022": `import "https://evil.example/x.js";`,
};
const opts = () => ({ fetch, maxBytes: 1_000_000, deadline: Date.now() + 10_000 });

beforeAll(async () => {
  npm = await startFakeNpm({ now: new Date(), packages: [], modules: MODULES });
});
afterAll(() => npm.close());

describe("fetchGraph", () => {
  it("follows every esm.sh path from the entry and hashes each module; bare names are reported", async () => {
    const r = await fetchGraph(`${npm.origin}/tiny@1.0.0?target=es2022`, opts());
    if (!r.ok) throw new Error(r.error.message);
    // URLs are kept as `new URL()` writes them ("^" → "%5E"), the same form the bundler resolves to.
    expect(r.graph.modules.map((m) => decodeURI(m.url.replace(npm.origin, ""))).sort()).toEqual(Object.keys(MODULES).filter((k) => !k.startsWith("/evil")).sort());
    expect(r.graph.modules.every((m) => /^[0-9a-f]{64}$/.test(m.sha))).toBe(true);
    expect(r.graph.bare).toEqual(["react"]);
  });

  it("a 404 is not-found, with esm.sh's text", async () => {
    const r = await fetchGraph(`${npm.origin}/nope@1.0.0?target=es2022`, opts());
    expect(r).toEqual({ ok: false, error: { code: "not-found", message: "/nope@1.0.0?target=es2022 not found" } });
  });

  it("🔴 esm.sh failing with a 5xx (after one retry) is unavailable — the service, not the package — with its status and text, never a crash", async () => {
    // Measured 2026-10-12: «500 storage(put): … no space left on device» on every new build.
    npm.setDown("esm", true);
    const r = await fetchGraph(`${npm.origin}/tiny@1.0.0?target=es2022`, opts());
    npm.setDown("esm", false);
    expect(r).toEqual({ ok: false, error: { code: "unavailable", message: "esm.sh answered 503: esm.sh is down" } });
  });

  it("a server that doesn't answer is unavailable", async () => {
    const r = await fetchGraph("http://127.0.0.1:9/tiny@1.0.0?target=es2022", opts());
    expect(r).toMatchObject({ ok: false, error: { code: "unavailable" } });
  });

  it("a module from another origin is refused", async () => {
    const r = await fetchGraph(`${npm.origin}/evil@1.0.0?target=es2022`, opts());
    expect(r).toMatchObject({ ok: false, error: { code: "build-failed" } });
  });

  it("over the byte cap is too-large", async () => {
    const r = await fetchGraph(`${npm.origin}/tiny@1.0.0?target=es2022`, { ...opts(), maxBytes: 50 });
    expect(r).toMatchObject({ ok: false, error: { code: "too-large" } });
  });
});
