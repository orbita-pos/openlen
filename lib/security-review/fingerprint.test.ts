import { describe, expect, it } from "vitest";

import { fileHashes, fingerprintOf, REVIEW_VERSION, reviewedTexts } from "./fingerprint";
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

describe("reviewedTexts", () => {
  it("is what a published copy keeps: the pages under their published paths and the reviewed files, not the tests", () => {
    const t = reviewedTexts(inputs({ files: { ...inputs().files, "/tests/flujo.spec.ts": "x" } }));
    expect(t).toEqual({
      "/index.html": "<h1>Hola</h1>",
      "/menu/index.html": "<p>menú</p>",
      "/src/App.tsx": "a",
      "/supabase/functions/x/index.ts": "b",
      "/.env": "VITE_X=1",
    });
  });
});

describe("fileHashes", () => {
  it("hash the pages under their published paths and the reviewed files", () => {
    expect(Object.keys(fileHashes(inputs())).sort()).toEqual(["/.env", "/index.html", "/menu/index.html", "/src/App.tsx", "/supabase/functions/x/index.ts"]);
  });
});
