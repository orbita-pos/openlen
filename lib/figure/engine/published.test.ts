// @vitest-environment node
//
// THE ENGINE'S PUBLISHED FILE (spec local 2026-11-10-figuras-del-asistente, §5.7): what the bubble asks for is kept
// in the repo, so publishing bundles nothing. It must be what the engine builds to TODAY — a change to the engine
// without `npm run figure:engine` would publish the old one — and it keeps the engine's weight ceiling.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { FIGURE_ENGINE } from "./published";

describe("the engine's published file", () => {
  it("is named by its content and weighs at most 60 KB gzipped", () => {
    expect(FIGURE_ENGINE.file).toBe(`figure-${createHash("sha256").update(FIGURE_ENGINE.code).digest("hex").slice(0, 8)}.js`);
    expect(gzipSync(Buffer.from(FIGURE_ENGINE.code)).length).toBeLessThanOrEqual(61_440);
    // One global on a customer's page, and only that one.
    expect(FIGURE_ENGINE.code).toMatch(/^"use strict";var __openlenFigure=/);
    expect(FIGURE_ENGINE.code).not.toContain("OpenLenFigure");
  });

  it("🔴 is what the engine builds to today: after changing the engine, run `npm run figure:engine`", async () => {
    const { builtEngine } = (await import(pathToFileURL(path.join(process.cwd(), "scripts/figure-engine-build.mjs")).href)) as { builtEngine: () => Promise<{ file: string; source: string }> };
    const built = await builtEngine();
    const kept = (await readFile(path.join(process.cwd(), "lib/figure/engine/published.ts"), "utf8")).replace(/\r\n/g, "\n");
    expect(built.file).toBe(FIGURE_ENGINE.file);
    expect(kept).toBe(built.source);
  }, 60_000);
});
