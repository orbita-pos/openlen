import { describe, expect, it } from "vitest";

import { changedPaths, fileHashes, fingerprintOf, REVIEW_VERSION } from "./fingerprint";
import type { ReviewInputs } from "./types";

const inputs = (over: Partial<ReviewInputs> = {}): ReviewInputs => ({
  projectId: "p1",
  ownerId: "u1",
  app: null,
  homeHtml: "<h1>Hola</h1>",
  pages: { menu: "<p>menú</p>" },
  files: { "/src/App.tsx": "a", "/supabase/functions/x/index.ts": "b", "/.env": "VITE_X=1" },
  productionEnv: { VITE_A: "1" },
  hasBackend: true,
  schema: { tables: [{ name: "pedidos", rls: true }], policies: [], buckets: [] },
  ...over,
});

describe("fingerprintOf", () => {
  it("is 64 hex characters and doesn't depend on the order the files were read in", () => {
    const a = fingerprintOf(inputs());
    const b = fingerprintOf(inputs({ files: { "/.env": "VITE_X=1", "/supabase/functions/x/index.ts": "b", "/src/App.tsx": "a" } }));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toBe(a);
  });

  it("changes with anything that can change the verdict", () => {
    const base = fingerprintOf(inputs());
    expect(fingerprintOf(inputs({ homeHtml: "<h1>Adiós</h1>" }))).not.toBe(base);
    expect(fingerprintOf(inputs({ pages: { menu: "<p>otro</p>" } }))).not.toBe(base);
    expect(fingerprintOf(inputs({ files: { ...inputs().files, "/src/App.tsx": "a2" } }))).not.toBe(base);
    expect(fingerprintOf(inputs({ files: { ...inputs().files, "/supabase/config.toml": "[functions.x]" } }))).not.toBe(base);
    expect(fingerprintOf(inputs({ productionEnv: { VITE_A: "2" } }))).not.toBe(base);
    expect(fingerprintOf(inputs({ schema: { tables: [{ name: "pedidos", rls: false }], policies: [], buckets: [] } }))).not.toBe(base);
    expect(fingerprintOf(inputs({ schema: null }))).not.toBe(base);
    expect(fingerprintOf(inputs(), REVIEW_VERSION + 1)).not.toBe(base);
  });

  it("does NOT change with a file the review doesn't look at (a test)", () => {
    expect(fingerprintOf(inputs({ files: { ...inputs().files, "/tests/flujo.spec.ts": "x" } }))).toBe(fingerprintOf(inputs()));
  });
});

describe("fileHashes and changedPaths", () => {
  it("hash the pages under their published paths and the reviewed files", () => {
    expect(Object.keys(fileHashes(inputs())).sort()).toEqual(["/.env", "/index.html", "/menu/index.html", "/src/App.tsx", "/supabase/functions/x/index.ts"]);
  });

  it("changedPaths lists new paths and paths whose content changed, sorted", () => {
    const before = fileHashes(inputs());
    const after = fileHashes(inputs({ homeHtml: "<h1>Adiós</h1>", files: { ...inputs().files, "/src/nuevo.ts": "n" } }));
    expect(changedPaths(before, after)).toEqual(["/index.html", "/src/nuevo.ts"]);
    expect(changedPaths(before, before)).toEqual([]);
  });
});
