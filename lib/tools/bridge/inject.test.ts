// @vitest-environment node
//
// `injectToolBridge` (spec local 2026-11-04-herramientas-hechas-por-len, §4.4) after it took the shared linear head scan
// (`head-scan.ts`): the output for an ordinary shell is what it always was (`lib/tools/serve.test.ts` pins that, unedited),
// and the three things the old pattern got wrong are pinned here — a hostile shell, a `>` inside an attribute, and an
// idempotency check that looked at the whole document.
import { describe, expect, it } from "vitest";

import { injectToolBridge, TOOL_BRIDGE_PATH } from "./inject";

const TAG = `<script src="${TOOL_BRIDGE_PATH}"></script>`;

describe("injectToolBridge", () => {
  it("ordinary shells come out as they always did", () => {
    expect(injectToolBridge("<html><head><title>x</title></head></html>")).toBe(`<html><head>${TAG}<title>x</title></head></html>`);
    expect(injectToolBridge(`<!doctype html><html lang="es"><head lang="es"><meta charset="utf-8"></head><body></body></html>`)).toBe(
      `<!doctype html><html lang="es"><head lang="es">${TAG}<meta charset="utf-8"></head><body></body></html>`,
    );
    expect(injectToolBridge("<p>hi</p>")).toBe(`${TAG}<p>hi</p>`);
  });

  it("a `>` inside a quoted attribute of <head> does not take the tag into the value", () => {
    expect(injectToolBridge(`<html><head data-x="a>b"><title>x</title></head></html>`)).toBe(`<html><head data-x="a>b">${TAG}<title>x</title></head></html>`);
  });

  it("idempotent when the tag is first in the head; the same tag elsewhere in the document does not count", () => {
    const once = injectToolBridge("<html><head></head><body></body></html>");
    expect(injectToolBridge(once)).toBe(once);
    expect(injectToolBridge(`<html><head></head><body>${TAG}</body></html>`)).toBe(`<html><head>${TAG}</head><body>${TAG}</body></html>`);
    expect(injectToolBridge(TAG + "<p>hi</p>")).toBe(TAG + "<p>hi</p>");
  });

  it("🔴 stays linear on a shell built to make a pattern backtrack (a tool author's shell, on every request)", () => {
    for (const hostile of ["<head ".repeat(200_000), "<head x".repeat(200_000), '<head x="'.repeat(120_000), "<head\n".repeat(200_000)]) {
      const started = performance.now();
      const out = injectToolBridge(hostile);
      expect(performance.now() - started).toBeLessThan(200);
      expect(out.endsWith(hostile)).toBe(true);
    }
  });
});
