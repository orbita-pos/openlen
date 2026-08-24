// Smoke tests for lib/html-engine.ts — verifies the Option<T> → null shim
// fires at every documented site and that pass-through exports preserve
// the underlying napi-rs semantics.
//
// Run via: npx tsx --test lib/html-engine.test.ts
//
// Requires: `cd crates/html-engine && npm install && npm run build` so the
// `.node` binary exists and `index.{js,d.ts}` are generated.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { pageNetworkExtra, sealRelease } from "./html-engine";

import {
  applyOps,
  buildScopedView,
  detectSlotPath,
  HtmlStream,
  normalizeBornCanonical,
  optimizeForPublish,
  parseOps,
  resolveOpIdByPath,
  roundTrip,
  sanitizeForPublish,
  stripOpIds,
  tagWithOpIds,
} from "./html-engine";

test("roundTrip preserves a clean fragment", () => {
  const html = "<div><p>hi</p></div>";
  assert.equal(typeof roundTrip(html), "string");
});

test("normalizeBornCanonical returns a string for empty input", () => {
  assert.equal(typeof normalizeBornCanonical(""), "string");
});

test("sanitizeForPublish: clean input → html is string, errors empty", () => {
  const r = sanitizeForPublish('<div class="card"><h1>Hi</h1></div>');
  assert.equal(typeof r.html, "string");
  assert.ok(r.html !== null, "shim should keep present html as string, not null");
  assert.deepEqual(r.errors, []);
  assert.equal(r.removed.scripts, 0);
  assert.equal(r.removed.eventHandlers, 0);
  assert.equal(r.removed.dangerousUrls, 0);
  assert.equal(r.removed.iframes, 0);
  assert.equal(r.removed.metaRefresh, 0);
});

test("sanitizeForPublish: slot-path gate → html === null (shim from undefined)", () => {
  const r = sanitizeForPublish('<div data-slot-path="hero.title">x</div>');
  // The Rust side returns html: undefined here; the shim normalises to null.
  assert.equal(r.html, null, "shim must convert undefined → null exactly");
  assert.notEqual(r.html, undefined, "shim should never leak undefined");
  assert.ok(r.errors.length > 0, "errors should be populated on gate trigger");
  assert.match(r.errors[0], /data-slot-path/);
});

test("sanitizeForPublish: inline <script> stripped", () => {
  const r = sanitizeForPublish("<div><script>alert(1)</script><p>x</p></div>");
  assert.ok(r.html !== null);
  assert.ok(!r.html!.includes("<script>"), "inline script must be removed");
  assert.equal(r.removed.scripts, 1);
});

test("optimizeForPublish: clean input → html string + stats", () => {
  const r = optimizeForPublish("<!doctype html><html><body><div>x</div></body></html>");
  assert.ok(r.html !== null);
  assert.equal(typeof r.stats.bytesIn, "number");
  assert.equal(typeof r.stats.bytesOut, "number");
  assert.deepEqual(r.errors, []);
});

test("optimizeForPublish: slot-path gate → html null via shim", () => {
  const r = optimizeForPublish('<div data-slot-path="x">y</div>');
  assert.equal(r.html, null);
  assert.notEqual(r.html, undefined);
  assert.ok(r.errors.length > 0);
});

test("tagWithOpIds: assigns IDs + count matches", () => {
  const r = tagWithOpIds("<div><p>a</p><p>b</p></div>");
  assert.ok(r.taggedCount >= 3, `expected ≥3 tags, got ${r.taggedCount}`);
  assert.ok(r.taggedHtml.includes("data-op-id"));
});

test("stripOpIds: removes data-op-id attributes", () => {
  const tagged = tagWithOpIds("<div><p>x</p></div>").taggedHtml;
  assert.ok(tagged.includes("data-op-id"));
  const stripped = stripOpIds(tagged);
  assert.ok(!stripped.includes("data-op-id"), "all data-op-id attrs must be gone");
});

test("parseOps: empty envelope errors", () => {
  const r = parseOps("");
  assert.equal(r.ops.length, 0);
  assert.ok(r.errors.length > 0);
});

test("parseOps: parses a delete op", () => {
  const r = parseOps('<edits><edit op="delete" target="a1"/></edits>');
  assert.equal(r.errors.length, 0);
  assert.equal(r.ops.length, 1);
  assert.equal(r.ops[0].type, "delete");
  assert.equal(r.ops[0].target, "a1");
  assert.equal(r.ops[0].newHtml, undefined);
});

test("applyOps: html=null shim when validation fails", () => {
  // Empty ops array → Rust returns html: undefined, errors should still be empty
  // because phase-1 validation never runs. The shim must still surface null.
  const r = applyOps("<div></div>", []);
  assert.equal(r.html, null, "empty ops → html null (shim from undefined)");
  assert.notEqual(r.html, undefined);
  assert.equal(r.appliedCount, 0);
});

test("applyOps: successful replace returns string html", () => {
  const tagged = tagWithOpIds("<div><p>old</p></div>").taggedHtml;
  // Find the <p>'s op-id from the tagged HTML.
  const m = tagged.match(/data-op-id="(\w+)"[^>]*>old/);
  if (!m) throw new Error(`could not extract op-id from ${tagged}`);
  const pId = m[1];
  const r = applyOps(tagged, [
    { type: "replace", target: pId, newHtml: "<p>new</p>" },
  ]);
  assert.ok(r.html !== null, `expected string, got ${r.html}; errors=${JSON.stringify(r.errors)}`);
  assert.ok(r.html!.includes("<p>new</p>"));
});

test("resolveOpIdByPath: returns null (shim) when path doesn't match", () => {
  const tagged = tagWithOpIds("<body><div><p>x</p></div></body>").taggedHtml;
  const r = resolveOpIdByPath(tagged, "div > span");
  assert.equal(r, null);
  assert.notEqual(r, undefined);
});

test("resolveOpIdByPath: returns string when path matches", () => {
  const tagged = tagWithOpIds("<body><div><p>x</p></div></body>").taggedHtml;
  const r = resolveOpIdByPath(tagged, "div > p");
  assert.equal(typeof r, "string");
  assert.ok((r ?? "").length > 0);
});

test("buildScopedView: returns null (shim) on missing pin", () => {
  const tagged = tagWithOpIds("<body><section><p>x</p></section></body>").taggedHtml;
  const r = buildScopedView(tagged, "nonexistent-pin");
  assert.equal(r, null);
  assert.notEqual(r, undefined);
});

test("buildScopedView: returns object when pin exists", () => {
  const tagged = tagWithOpIds("<body><section><p>x</p></section></body>").taggedHtml;
  // Get the <section>'s op-id.
  const m = tagged.match(/<section[^>]*data-op-id="(\w+)"/);
  if (!m) throw new Error(`could not find section op-id in ${tagged}`);
  const r = buildScopedView(tagged, m[1]);
  assert.ok(r !== null);
  assert.equal(typeof r!.scopedHtml, "string");
  assert.equal(r!.containerOpId, m[1]);
});

test("HtmlStream: round-trip on a small doc preserves output", () => {
  const stream = new HtmlStream();
  const out1 = stream.write("<div><p>hi</p></div>");
  const result = stream.end();
  // bytesIn matches what we fed; finalHtml is the post-processed full document.
  assert.equal(result.bytesIn, "<div><p>hi</p></div>".length);
  assert.equal(typeof result.finalHtml, "string");
  // Per-write return may be empty (lol-html buffering); that's expected.
  assert.equal(typeof out1, "string");
});

test("HtmlStream: rejects data-slot-path mid-stream", () => {
  const stream = new HtmlStream();
  assert.throws(
    () => stream.write('<div data-slot-path="x">'),
    /data-slot-path/,
  );
});

// ─── detectSlotPath helper (S7 — consolidates 9 inline call sites) ────────

test("detectSlotPath: clean HTML → false", () => {
  assert.equal(detectSlotPath("<div>hi</div>"), false);
});

test("detectSlotPath: empty input → false", () => {
  assert.equal(detectSlotPath(""), false);
});

test("detectSlotPath: literal lowercase marker → true", () => {
  assert.equal(detectSlotPath('<div data-slot-path="hero.title">x</div>'), true);
});

test("detectSlotPath: mixed-case marker → true (TS String.includes missed this)", () => {
  assert.equal(detectSlotPath('<div Data-Slot-Path="x">y</div>'), true);
});

test("detectSlotPath: entity-encoded equals sign → true (TS String.includes missed this)", () => {
  assert.equal(
    detectSlotPath('<div data-slot-path&#x3d;"x">y</div>'),
    true,
  );
});

test("detectSlotPath: whitespace around equals → true (TS String.includes missed this)", () => {
  assert.equal(detectSlotPath('<div data-slot-path ="x">y</div>'), true);
});

test("detectSlotPath: substring 'data-slot-path' without '=' is not a marker", () => {
  // The Rust gate requires the attribute-equals shape, not just the
  // substring. A bare 'data-slot-path' in text content is not a marker.
  assert.equal(detectSlotPath("<p>see data-slot-path docs</p>"), false);
});

test("detectSlotPath: marker buried inside a larger document → true", () => {
  const html =
    "<html><head><title>x</title></head><body>" +
    "<header>top</header>" +
    "<main><section><p data-slot-path=\"hero.title\">x</p></section></main>" +
    "</body></html>";
  assert.equal(detectSlotPath(html), true);
});

// ── Reparación de scripts de tema (bug 2026-07-29) ──────────────────────────
// El strip de Rust mata <script data-ol-{radius,space,type}> pero sus <style>
// sobreviven; el wrapper debe re-inyectar los scripts canónicos para que el
// editor no pierda el mapeo var() de las utilities en cada save/publish.

test("sanitizeForPublish repara los scripts de tema que el strip mató", () => {
  const doc =
    '<html><head><script src="https://cdn.tailwindcss.com"></script></head><body><div class="rounded-lg p-4 text-xl">x</div></body></html>';
  const normalized = normalizeBornCanonical(doc);
  const r = sanitizeForPublish(normalized);
  assert.ok(r.html !== null);
  assert.ok(r.html!.includes("<script data-ol-radius>"), "radius script de vuelta");
  assert.ok(r.html!.includes("<script data-ol-space>"), "space script de vuelta");
  assert.ok(r.html!.includes("<script data-ol-type>"), "type script de vuelta");
});

test("sanitizeForPublish: la reparación es idempotente entre saves consecutivos", () => {
  const doc =
    '<html><head><script src="https://cdn.tailwindcss.com"></script></head><body><div class="rounded-lg">x</div></body></html>';
  let html = normalizeBornCanonical(doc);
  for (let i = 0; i < 3; i++) {
    const r = sanitizeForPublish(html);
    assert.ok(r.html !== null, `save ${i + 1}`);
    html = r.html!;
    assert.equal((html.match(/<script data-ol-radius>/g) ?? []).length, 1, `save ${i + 1}: sin duplicados`);
    assert.equal((html.match(/<style data-ol-radius/g) ?? []).length, 1, `save ${i + 1}: style único`);
  }
});

test("sanitizeForPublish NO inyecta tema en documentos vírgenes (scrape/autofill)", () => {
  const virgin = "<html><head></head><body><p>externo</p></body></html>";
  const r = sanitizeForPublish(virgin);
  assert.ok(r.html !== null);
  assert.ok(!r.html!.includes("data-ol-radius"), "sin tokens regalados");
  assert.ok(!r.html!.includes("data-ol-space"));
  assert.ok(!r.html!.includes("data-ol-type"));
});

test("sanitizeForPublish: un script de tema FORJADO muere y vuelve el canónico", () => {
  const doc =
    '<html><head><script src="https://cdn.tailwindcss.com"></script></head><body><div class="rounded-lg">x</div></body></html>';
  const normalized = normalizeBornCanonical(doc);
  // El atacante reemplaza el script canónico por uno malicioso con el mismo attr
  const forged = normalized.replace(
    /<script data-ol-radius>[\s\S]*?<\/script>/,
    '<script data-ol-radius>evil()</script>',
  );
  const r = sanitizeForPublish(forged);
  assert.ok(r.html !== null);
  assert.ok(!r.html!.includes("evil()"), "el script forjado NO sobrevive");
  assert.ok(r.html!.includes("<script data-ol-radius>"), "el canónico vuelve");
  assert.ok(r.html!.includes("var(--ol-r-sm)"), "con el contenido nuestro");
});


// ── LA RED DE UNA PÁGINA PUBLICADA ──────────────────────────────────────────
//
// Decisión de Jesús (2026-08-24), tomada a sabiendas: las páginas de usuario
// pueden llamar a cualquier origen HTTPS, como en cualquier hosting que sirva
// páginas de usuario —vercel.app, netlify.app, github.io: ninguno restringe
// `connect-src`—. Lo que lo hace defendible es que el script del modelo va
// FIJADO POR HASH en la misma CSP y que el creador puede leerlo desde el visor
// `</>`. La política vive en TypeScript para que revertirla cueste una variable
// de entorno y no un despliegue del módulo nativo.

const CSP_HTML = `<!doctype html><html><head><title>x</title></head><body><h1>h</h1><form></form></body></html>`;
const cspDe = (extra?: string) =>
  /content="([^"]+)"/.exec(sealRelease(CSP_HTML, "https://openlen.com", extra).html)?.[1] ?? "";

test("pageNetworkExtra abre https y wss por defecto", () => {
  assert.equal(pageNetworkExtra({}), "https: wss:");
});

test("pageNetworkExtra: el kill-switch es EXACTO", () => {
  assert.equal(pageNetworkExtra({ OPENLEN_PAGE_NETWORK: "0" }), undefined);
  // Sólo "0": un valor mal escrito no puede apagarlo por accidente, que es la
  // convención del resto de interruptores del repo.
  assert.equal(pageNetworkExtra({ OPENLEN_PAGE_NETWORK: "false" }), "https: wss:");
  assert.equal(pageNetworkExtra({ OPENLEN_PAGE_NETWORK: "" }), "https: wss:");
});

test("el sello abre connect-src y NO form-action", () => {
  const p = cspDe(pageNetworkExtra({}));
  assert.ok(p.includes("connect-src 'self' https://openlen.com https: wss:"), p);
  // La promesa que sigue en pie: los envíos de formulario van sólo a OpenLen.
  assert.ok(p.includes("form-action 'self' https://openlen.com"), p);
  assert.equal(/form-action[^;"]*https:(?!\/\/openlen\.com)/.test(p), false, p);
});

test("con el kill-switch, el sello es byte a byte el de antes", () => {
  assert.equal(
    sealRelease(CSP_HTML, "https://openlen.com", pageNetworkExtra({ OPENLEN_PAGE_NETWORK: "0" })).html,
    sealRelease(CSP_HTML, "https://openlen.com").html,
  );
});
