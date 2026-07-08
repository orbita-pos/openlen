import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyTematicaToHtml, injectBeforeHeadClose, removeTematicaFromHtml } from "./apply-server";
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
  it('remove also strips the editor-serialized stamp (data-ol-tematica="")', () => {
    // The iframe's setAttribute('data-ol-tematica','') saves as ="" — a doc
    // themed IN THE EDITOR must strip just as cleanly as one stamped here.
    const editorDoc =
      `<!doctype html><html lang="es" data-ol-tematica="${FIRST}" data-ol-tematica-bg="petals">` +
      `<head><title>x</title>` +
      `<link rel="stylesheet" data-ol-tematica="" href="https://fonts.example/x.css">` +
      `<style data-ol-tematica="">html{color:red}</style>` +
      `</head><body><h1>Hola</h1></body></html>`;
    const clean = removeTematicaFromHtml(editorDoc);
    assert.ok(!clean.includes("data-ol-tematica"));
    assert.ok(!clean.includes("<style"));
    assert.ok(!clean.includes("<link"));
    assert.ok(clean.includes("<h1>Hola</h1>"));
  });
  it("a valid fondo stamps that scene id", () => {
    const scene = TEMATICA_PRESETS[0].backdrops[1].id;
    const r = applyTematicaToHtml(DOC, FIRST, scene) as { html: string };
    assert.ok(r.html.includes(`data-ol-tematica-bg="${scene}"`));
  });
  it("an unknown fondo resolves to the kit's hero scene — the raw string never lands", () => {
    const hero = TEMATICA_PRESETS[0].backdrops[0].id;
    const r = applyTematicaToHtml(DOC, FIRST, "escena-inventada") as { html: string };
    assert.ok(r.html.includes(`data-ol-tematica-bg="${hero}"`));
    assert.ok(!r.html.includes("escena-inventada"));
  });
});

describe("injectBeforeHeadClose", () => {
  it("lands special replacement-pattern chars ($&, $`, $', $1) literally, not interpreted", () => {
    const html = `<!doctype html><html><head><title>x</title></head><body></body></html>`;
    const inject = "<style>/* $& $` $' $1 literal */</style>";
    const out = injectBeforeHeadClose(html, inject);
    assert.ok(out.includes(inject));
    assert.equal(out, `<!doctype html><html><head><title>x</title>${inject}</head><body></body></html>`);
  });
  it("falls back to inserting a <head> when the doc has none", () => {
    const html = `<!doctype html><html><body></body></html>`;
    const inject = "<style>x{color:red}</style>";
    const out = injectBeforeHeadClose(html, inject);
    assert.ok(out.includes(`<head>${inject}</head>`));
  });
});
