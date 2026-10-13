// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { clearRefusalCache, installForApp, listPackages, pendingInstall, REFUSAL_TTL_MS, type InstallDeps } from "./install";
import { readEsmLock, readPackageJson } from "./lock";
import { ESM_LOCK_PATH, PACKAGE_JSON_PATH } from "./paths";
import { clearPackumentCache } from "./registry";
import { memoryStore, type ModuleStore } from "./store";
import { startFakeNpm, type FakeNpm } from "./test-support/fake-npm";

const NOW = new Date("2026-10-13T12:00:00.000Z");
const APP = { catalogo: "2026-11", entrada: "/src/main.tsx" };

/** The entry and the built module of a package in one mode, like the real ones: another `external` is another built path. */
function built(name: string, version: string, body: string, mode: "dev" | "prod", query = ""): Record<string, string> {
  const dev = mode === "dev";
  const variant = query ? `X-${query.replace(/[^a-z]/gi, "")}/` : "";
  const file = `/${name}@${version}/${variant}es2022/${name}${dev ? ".development" : ""}.mjs`;
  const q = `?target=es2022${query}${dev ? "&dev" : ""}`;
  return {
    [`/${name}@${version}${q}`]: `/* esm.sh - ${name}@${version} */\nexport * from "${file}";\nexport { default } from "${file}";`,
    [file]: body,
  };
}
const both = (name: string, version: string, body: string, query = "") => ({ ...built(name, version, body, "dev", query), ...built(name, version, body, "prod", query) });

let npm: FakeNpm;
let restore: () => void;
let store: ModuleStore;
const deps = (): InstallDeps => ({ fetch, now: () => NOW, store, origin: npm.origin });
const source = (code: string, extra: Record<string, string> = {}) => ({ "/src/main.tsx": code, ...extra });

beforeAll(async () => {
  npm = await startFakeNpm({
    now: NOW,
    packages: [
      { name: "tiny", createdDaysAgo: 400, versions: { "1.0.0": { daysAgo: 300 } } },
      { name: "dep", createdDaysAgo: 400, versions: { "2.0.0": { daysAgo: 300 } } },
      { name: "young", createdDaysAgo: 10, versions: { "1.0.0": { daysAgo: 10 } } },
      { name: "shaky", createdDaysAgo: 400, versions: { "1.0.0": { daysAgo: 300 } } },
      { name: "fresh", createdDaysAgo: 400, versions: { "1.0.0": { daysAgo: 2 } } },
      { name: "fiberish", createdDaysAgo: 400, versions: { "1.0.0": { daysAgo: 300, peerDependencies: { react: ">=19", three: ">=0.150" } } } },
      { name: "three", createdDaysAgo: 4000, versions: { "0.186.1": { daysAgo: 20 } } },
      { name: "nodey", createdDaysAgo: 400, versions: { "1.0.0": { daysAgo: 300 } } },
    ],
    modules: {
      ...both("tiny", "1.0.0", `import { dep } from "/dep@^2.0.0?target=es2022";\nexport default function tiny() { return "tiny" + dep; }`),
      "/dep@^2.0.0?target=es2022": `export * from "/dep@2.0.0/es2022/dep.mjs";`,
      "/dep@^2.0.0?target=es2022&dev": `export * from "/dep@2.0.0/es2022/dep.mjs";`,
      "/dep@2.0.0/es2022/dep.mjs": `export const dep = 1;`,
      ...both("shaky", "1.0.0", `import "/fresh@1.0.0/es2022/fresh.mjs";\nexport default 1;`),
      "/fresh@1.0.0/es2022/fresh.mjs": `export {};`,
      ...both("fiberish", "1.0.0", `import * as R from "react";\nexport default function Fiber() { return R; }`, "&external=react"),
      ...both("fiberish", "1.0.0", `import * as R from "react";\nimport * as T from "three";\nimport { Orbit } from "three/examples/jsm/controls/OrbitControls.js";\nexport default function Fiber() { return [R, T, Orbit]; }`, "&external=react,three"),
      ...both("three", "0.186.1", `export const REVISION = "186";`),
      ...built("three", "0.186.1/examples/jsm/controls/OrbitControls.js", `export const Orbit = 1;`, "dev"),
      ...built("three", "0.186.1/examples/jsm/controls/OrbitControls.js", `export const Orbit = 1;`, "prod"),
      ...both("nodey", "1.0.0", `import "/node/fs.mjs";\nexport default 1;`),
      "/node/fs.mjs": `export default {};`,
    },
    raw: {
      "tiny@1.0.0/package.json": JSON.stringify({ name: "tiny", types: "index.d.ts" }),
      "tiny@1.0.0/index.d.ts": "export default function tiny(): string;",
    },
  });
  restore = npm.useEnv();
});
afterAll(async () => {
  restore();
  await npm.close();
});
beforeEach(() => {
  store = memoryStore();
  clearPackumentCache();
  clearRefusalCache();
});

describe("pendingInstall", () => {
  it("what the sources import and nothing serves; React never", () => {
    expect(pendingInstall(source(`import { useState } from "react";\nimport tiny from "tiny";\nexport default [useState, tiny];`), APP)).toEqual({
      add: [{ name: "tiny", range: null, subpaths: [""] }],
      remove: [],
    });
  });
});

describe("installForApp", () => {
  it("installs from esm.sh: package.json like npm (with what it already imported from the catalog), the lock, the cache and a note", async () => {
    const files = source(`import { useState } from "react";\nimport tiny from "tiny";\nexport default [useState, tiny];`);
    const out = await installForApp({ files, app: APP, request: pendingInstall(files, APP), deps: deps() });
    expect(out.notes).toEqual([{ severity: "Info", message: "Installed tiny@1.0.0 from npm (esm.sh)." }]);
    expect(readPackageJson(out.files)?.dependencies).toEqual({ react: "^19.2.6", tiny: "^1.0.0" });
    const locked = readEsmLock(out.files).packages.tiny!;
    expect(locked.version).toBe("1.0.0");
    expect(Object.keys(locked.development[""]!.modules)).toHaveLength(4);
    expect(locked.types).not.toBeNull();
    expect(locked.typesFrom).toEqual({ name: "tiny", version: "1.0.0" });
    for (const sha of Object.values(locked.production[""]!.modules)) expect(await store.get(sha)).not.toBeNull();
  });

  it("🔴 the modules go into the cache several at a time (each put may be an upload to R2), not one after another", async () => {
    const files = source(`import tiny from "tiny";\nexport default tiny;`);
    let inFlight = 0;
    let most = 0;
    const slow: ModuleStore = {
      get: (sha) => store.get(sha),
      async put(sha, text) {
        inFlight++;
        most = Math.max(most, inFlight);
        await new Promise((r) => setTimeout(r, 20));
        await store.put(sha, text);
        inFlight--;
      },
    };
    const out = await installForApp({ files, app: APP, request: pendingInstall(files, APP), deps: { ...deps(), store: slow } });
    expect(out.installed).toEqual(["tiny@1.0.0"]);
    for (const sha of Object.values(readEsmLock(out.files).packages.tiny!.development[""]!.modules)) expect(await store.get(sha)).not.toBeNull();
    expect(most).toBeGreaterThan(1);
    expect(most).toBeLessThanOrEqual(8);
  });

  it("a refused package is an Error note and nothing is written", async () => {
    const files = source(`import y from "young";\nexport default y;`);
    const out = await installForApp({ files, app: APP, request: pendingInstall(files, APP), deps: deps() });
    expect(out.files).toEqual({});
    expect(out.notes).toEqual([{ severity: "Error", message: "young: published 10 days ago; packages must be at least 30 days old." }]);
  });

  it("🔴 a refusal is remembered: saving again doesn't ask npm again for 10 minutes, and npm install <name> always asks", async () => {
    const files = source(`import y from "young";\nexport default y;`);
    const at = (ms: number): InstallDeps => ({ ...deps(), now: () => new Date(NOW.getTime() + ms) });
    const first = await installForApp({ files, app: APP, request: pendingInstall(files, APP), deps: at(0) });
    const asked = npm.requests.length;
    const again = await installForApp({ files, app: APP, request: pendingInstall(files, APP), deps: at(60_000) });
    expect(again).toEqual(first);
    expect(npm.requests.length).toBe(asked);
    await installForApp({ files, app: APP, request: { add: [{ name: "young", range: null, subpaths: [""], explicit: true }], remove: [] }, deps: at(60_000) });
    expect(npm.requests.length).toBeGreaterThan(asked);
    const explicitAsked = npm.requests.length;
    // The explicit one, at the minute, remembered it again: ten minutes from then.
    await installForApp({ files, app: APP, request: pendingInstall(files, APP), deps: at(60_000 + REFUSAL_TTL_MS - 1) });
    expect(npm.requests.length).toBe(explicitAsked);
    await installForApp({ files, app: APP, request: pendingInstall(files, APP), deps: at(60_000 + REFUSAL_TTL_MS + 1) });
    expect(npm.requests.length).toBeGreaterThan(explicitAsked);
  });

  it("🔴 a refusal is remembered while /package.json doesn't change: a different /package.json asks again", async () => {
    const files = source(`import y from "young";\nexport default y;`, { [PACKAGE_JSON_PATH]: JSON.stringify({ dependencies: {} }) });
    await installForApp({ files, app: APP, request: pendingInstall(files, APP), deps: deps() });
    const asked = npm.requests.length;
    await installForApp({ files, app: APP, request: pendingInstall(files, APP), deps: deps() });
    expect(npm.requests.length).toBe(asked);
    const edited = { ...files, [PACKAGE_JSON_PATH]: JSON.stringify({ dependencies: { recharts: "^2.15.4" } }) };
    await installForApp({ files: edited, app: APP, request: pendingInstall(edited, APP), deps: deps() });
    expect(npm.requests.length).toBeGreaterThan(asked);
  });

  it("🔴 esm.sh failing (5xx) is the service, not the package: the note says so, and the next save asks again", async () => {
    const files = source(`import tiny from "tiny";\nexport default tiny;`);
    npm.setDown("esm", true);
    const down = await installForApp({ files, app: APP, request: pendingInstall(files, APP), deps: deps() });
    npm.setDown("esm", false);
    expect(down.notes).toEqual([
      { severity: "Error", message: "tiny: esm.sh answered 503: esm.sh is down; nothing was installed. It's the package service, not the package: try again." },
    ]);
    const up = await installForApp({ files, app: APP, request: pendingInstall(files, APP), deps: deps() });
    expect(up.installed).toEqual(["tiny@1.0.0"]);
  });

  it("CONTROL: a registry that didn't answer isn't remembered — the next save asks again", async () => {
    const files = source(`import y from "young";\nexport default y;`);
    const down = await installForApp({ files, app: APP, request: pendingInstall(files, APP), deps: { ...deps(), fetch: () => Promise.reject(new Error("down")) } });
    expect(down.notes[0]!.message).toMatch(/did not answer/);
    const asked = npm.requests.length;
    const up = await installForApp({ files, app: APP, request: pendingInstall(files, APP), deps: deps() });
    expect(up.notes[0]!.message).toMatch(/published 10 days ago/);
    expect(npm.requests.length).toBeGreaterThan(asked);
  });

  it("a dependency esm.sh picked that is too new refuses the package", async () => {
    const files = source(`import s from "shaky";\nexport default s;`);
    const out = await installForApp({ files, app: APP, request: pendingInstall(files, APP), deps: deps() });
    expect(out.notes[0]).toEqual({ severity: "Error", message: "shaky@1.0.0 depends on fresh@1.0.0, published 2 days ago; not installed." });
  });

  it("🔴 installing three after fiberish re-fetches fiberish with three external (one copy), and locks the three subpath it imports", async () => {
    const first = source(`import F from "fiberish";\nexport default F;`);
    const a = await installForApp({ files: first, app: APP, request: pendingInstall(first, APP), deps: deps() });
    expect(readEsmLock(a.files).packages.fiberish!.externals).toEqual(["react"]);
    const second = { ...first, ...a.files };
    const b = await installForApp({ files: second, app: APP, request: { add: [{ name: "three", range: null, subpaths: [""] }], remove: [] }, deps: deps() });
    const lock = readEsmLock(b.files);
    expect(lock.packages.fiberish!.externals).toEqual(["react", "three"]);
    expect(lock.packages.fiberish!.development[""]!.entry).toContain("external=react,three");
    expect(Object.keys(lock.packages.three!.development).sort()).toEqual(["", "examples/jsm/controls/OrbitControls.js"]);
  });

  it("react stays the catalog's", async () => {
    const out = await installForApp({ files: source("export {};"), app: APP, request: { add: [{ name: "react", range: "^18.0.0", subpaths: [""] }], remove: [] }, deps: deps() });
    expect(out.notes).toEqual([{ severity: "Error", message: "react is fixed to 19.2.6 in this app (one copy); other versions can't be installed." }]);
  });

  it("a catalog package with a range its version satisfies only goes to package.json, without esm.sh", async () => {
    const files = source("export {};", { [PACKAGE_JSON_PATH]: JSON.stringify({ dependencies: {} }) });
    const before = npm.requests.length;
    const out = await installForApp({ files, app: APP, request: { add: [{ name: "recharts", range: null, subpaths: [""] }], remove: [] }, deps: deps() });
    expect(readPackageJson(out.files)?.dependencies).toEqual({ recharts: "^2.15.4" });
    expect(npm.requests.slice(before).filter((r) => !r.includes("/-/"))).toEqual([]);
  });

  it("🔴 npm install of a catalog package in an app with no package.json writes one, with it and what the app already imports", async () => {
    const files = source(`import { useState } from "react";\nexport default useState;`);
    const out = await installForApp({ files, app: APP, request: { add: [{ name: "recharts", range: null, subpaths: [""], explicit: true }], remove: [] }, deps: deps() });
    expect(readPackageJson(out.files)?.dependencies).toEqual({ react: "^19.2.6", recharts: "^2.15.4" });
    expect(out.files[ESM_LOCK_PATH]).toBeUndefined();
  });

  it("uninstall removes it from package.json and the lock", async () => {
    const files = source(`import tiny from "tiny";\nexport default tiny;`);
    const a = await installForApp({ files, app: APP, request: pendingInstall(files, APP), deps: deps() });
    const b = await installForApp({ files: { ...files, ...a.files }, app: APP, request: { add: [], remove: ["tiny"] }, deps: deps() });
    expect(readPackageJson(b.files)?.dependencies?.tiny).toBeUndefined();
    expect(readEsmLock(b.files).packages.tiny).toBeUndefined();
  });

  it("a package that pulls in Node's fs installs with a warning", async () => {
    const files = source(`import n from "nodey";\nexport default n;`);
    const out = await installForApp({ files, app: APP, request: pendingInstall(files, APP), deps: deps() });
    expect(out.notes).toContainEqual({ severity: "Warning", message: "nodey@1.0.0 uses Node's fs; that part won't work in the browser." });
  });

  it("over the deadline nothing more is installed", async () => {
    const files = source(`import tiny from "tiny";\nexport default tiny;`);
    const out = await installForApp({ files, app: APP, request: pendingInstall(files, APP), deps: { ...deps(), deadlineMs: -1 } });
    expect(out.notes[0]?.severity).toBe("Error");
    expect(out.files).toEqual({});
  });
});

describe("listPackages", () => {
  it("lists package.json with who serves each", async () => {
    const files = source(`import tiny from "tiny";\nimport { useState } from "react";\nexport default [tiny, useState];`);
    const out = await installForApp({ files, app: APP, request: pendingInstall(files, APP), deps: deps() });
    expect(listPackages({ ...files, ...out.files }, APP)).toBe("app\n├── react@19.2.6 (preinstalled)\n└── tiny@1.0.0 (esm.sh)\n");
  });
});
