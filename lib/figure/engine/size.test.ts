// @vitest-environment node
//
// THE ENGINE'S WEIGHT (spec local 2026-11-10-figuras-del-asistente, §6): it rides in a published page's bubble, on
// a visitor's phone and data plan. 60 KB gzipped is a CEILING, not a target to renegotiate: over it, trim.
import { build } from "esbuild";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

const CEILING = 61_440;

describe("the engine's bundle", () => {
  it("weighs at most 60 KB gzipped and carries nothing but itself", async () => {
    const result = await build({
      entryPoints: [path.join(process.cwd(), "lib/figure/engine/index.ts")],
      bundle: true,
      minify: true,
      format: "iife",
      globalName: "OpenLenFigure",
      target: "es2020",
      write: false,
    });
    const code = result.outputFiles[0]!.text;
    const bytes = gzipSync(Buffer.from(code)).length;
    expect(bytes, `the engine is ${bytes} bytes gzipped (${code.length} minified); the ceiling is ${CEILING}`).toBeLessThanOrEqual(CEILING);
    expect(code).not.toMatch(/\breact\b/i);
    expect(code).not.toContain("node:");
    expect(code).not.toContain("require(");
    console.log(`figure engine: ${bytes} bytes gzipped, ${code.length} minified`);
  }, 60_000);
});
