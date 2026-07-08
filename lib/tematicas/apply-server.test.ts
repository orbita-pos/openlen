import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyTematicaToHtml, removeTematicaFromHtml } from "./apply-server";
import { TEMATICA_PRESETS } from "./presets";

const DOC = `<!doctype html><html lang="es"><head><title>x</title></head><body><h1>Hola</h1></body></html>`;
const FIRST = TEMATICA_PRESETS[0].id;

describe("applyTematicaToHtml", () => {
  it("stamps style, attrs and kit tokens", () => {
    const r = applyTematicaToHtml(DOC, FIRST);
    assert.ok(!("error" in r));
    const html = (r as { html: string }).html;
    assert.ok(html.includes("<style data-ol-tematica"));
    assert.match(html, new RegExp(`<html[^>]*data-ol-tematica="${FIRST}"`));
    assert.match(html, /<html[^>]*style="[^"]*--ol-/);
  });
  it("is idempotent-ish: re-applying another tematica replaces, not stacks", () => {
    const second = TEMATICA_PRESETS[1].id;
    const a = applyTematicaToHtml(DOC, FIRST) as { html: string };
    const b = applyTematicaToHtml(a.html, second) as { html: string };
    assert.equal((b.html.match(/<style data-ol-tematica/g) ?? []).length, 1);
    assert.ok(b.html.includes(`data-ol-tematica="${second}"`));
  });
  it("unknown id returns error", () => {
    const r = applyTematicaToHtml(DOC, "no-existe");
    assert.ok("error" in r);
  });
  it("remove strips everything it stamped", () => {
    const a = applyTematicaToHtml(DOC, FIRST) as { html: string };
    const clean = removeTematicaFromHtml(a.html);
    assert.ok(!clean.includes("data-ol-tematica"));
    assert.ok(!clean.includes("<style data-ol-tematica"));
  });
});
