// Tests for lib/html-ops.ts — the public surface of the ID-tagged DOM
// addressing engine (Chat tab's patch protocol). Backed by Rust's
// `@openlen/html-engine` since F1 S9.
//
// Run via: npx tsx --test lib/html-ops.test.ts
//
// Prerequisites:
//   cd crates/html-engine && npm install && npm run build      (.node binding)
//   npm install                                                (workspace symlink)

import { test } from "node:test";
import { strict as assert } from "node:assert";

import {
  applyOps,
  buildScopedView,
  parseOps,
  resolveOpIdByPath,
  stripOpIds,
  tagWithOpIds,
  rejectDocumentWideOps,
} from "./html-ops";

// ─── tagWithOpIds ──────────────────────────────────────────────────────────

test("tagWithOpIds: empty input → 0 count", () => {
  const r = tagWithOpIds("");
  assert.equal(r.taggedCount, 0);
});

test("tagWithOpIds: tags every non-skipped element in a full doc", () => {
  const html =
    "<html><body><section><h1>Hi</h1><p>body</p></section></body></html>";
  const r = tagWithOpIds(html);
  // body + section + h1 + p = 4
  assert.equal(r.taggedCount, 4);
  const matches = r.taggedHtml.match(/data-op-id="[^"]+"/g) ?? [];
  assert.equal(matches.length, 4);
});

test("tagWithOpIds: skip script/style/meta/etc and preserve existing id", () => {
  const html =
    '<html><head><meta charset="utf-8"><style>x{}</style></head><body><div data-op-id="preset"><script>1</script></div></body></html>';
  const r = tagWithOpIds(html);
  // body + div tagged; script/style/meta/head/html skipped; preset preserved.
  assert.ok(!/<head[^>]*data-op-id/.test(r.taggedHtml));
  assert.ok(!/<script[^>]*data-op-id/.test(r.taggedHtml));
  assert.ok(!/<style[^>]*data-op-id/.test(r.taggedHtml));
  assert.ok(r.taggedHtml.includes('data-op-id="preset"'));
});

// ─── stripOpIds ────────────────────────────────────────────────────────────

test("stripOpIds: removes data-op-id, leaves other attributes intact", () => {
  const html = '<a data-op-id="x" href="/h" data-foo="bar">x</a>';
  const r = stripOpIds(html);
  assert.ok(!r.includes("data-op-id"));
  assert.ok(r.includes('href="/h"'));
  assert.ok(r.includes('data-foo="bar"'));
});

test("stripOpIds: empty input → empty output", () => {
  assert.equal(stripOpIds(""), "");
});

// ─── parseOps ──────────────────────────────────────────────────────────────

test("parseOps: empty body → error, no ops", () => {
  const r = parseOps("");
  assert.equal(r.ops.length, 0);
  assert.equal(r.errors.length, 1);
});

test("parseOps: no <edits> envelope → error", () => {
  const r = parseOps("<p>just html, no envelope</p>");
  assert.equal(r.ops.length, 0);
  assert.equal(r.errors.length, 1);
});

test("parseOps: self-closing delete", () => {
  const raw = '<edits><edit op="delete" target="a" /></edits>';
  const r = parseOps(raw);
  assert.equal(r.errors.length, 0);
  assert.equal(r.ops.length, 1);
  assert.equal(r.ops[0].type, "delete");
  assert.equal(r.ops[0].target, "a");
  assert.equal(r.ops[0].newHtml, undefined);
});

test("parseOps: open-close replace (with <new> wrapper and natural form)", () => {
  const wrapped =
    '<edits><edit op="replace" target="a"><new><p>new</p></new></edit></edits>';
  const natural =
    '<edits><edit op="replace" target="b"><p>direct</p></edit></edits>';
  const w = parseOps(wrapped);
  const n = parseOps(natural);
  assert.equal(w.ops[0].newHtml, "<p>new</p>");
  assert.equal(n.ops[0].newHtml, "<p>direct</p>");
});

test("parseOps: unknown op type → error", () => {
  const raw = '<edits><edit op="nukeit" target="x">y</edit></edits>';
  const r = parseOps(raw);
  assert.equal(r.ops.length, 0);
  assert.ok(r.errors.length >= 1);
});

// ─── applyOps ──────────────────────────────────────────────────────────────

test("applyOps: empty ops → html null, no errors", () => {
  const r = applyOps('<div data-op-id="a">x</div>', []);
  assert.equal(r.html, null);
  assert.equal(r.errors.length, 0);
  assert.equal(r.appliedCount, 0);
});

test("applyOps: replace works + ids stripped from output", () => {
  const tagged = '<div data-op-id="a"><p data-op-id="b">old</p></div>';
  const r = applyOps(tagged, [
    { type: "replace", target: "b", newHtml: "<p>new</p>" },
  ]);
  assert.ok(r.html !== null);
  assert.ok(r.html!.includes("new"));
  assert.ok(!r.html!.includes("old"));
  assert.ok(!r.html!.includes("data-op-id"));
});

test("applyOps: insert_before / insert_after / delete all apply", () => {
  const tagged =
    '<div data-op-id="a"><p data-op-id="b">old</p></div>';
  const inserted = applyOps(tagged, [
    { type: "insert_before", target: "b", newHtml: "<h1>head</h1>" },
    { type: "insert_after", target: "b", newHtml: "<aside>x</aside>" },
  ]);
  assert.ok(inserted.html!.includes("<h1>head</h1>"));
  assert.ok(inserted.html!.includes("<aside>x</aside>"));

  const deleted = applyOps(
    '<div data-op-id="a"><p data-op-id="b">gone</p></div>',
    [{ type: "delete", target: "b" }],
  );
  assert.ok(!deleted.html!.includes("gone"));
});

test("applyOps: missing target → html null + error", () => {
  const tagged = '<div data-op-id="a">x</div>';
  const r = applyOps(tagged, [
    { type: "replace", target: "ghost", newHtml: "<p>nope</p>" },
  ]);
  assert.equal(r.html, null);
  assert.ok(r.errors.length >= 1);
});

test("applyOps: non-delete op without newHtml → error", () => {
  const tagged = '<div data-op-id="a">x</div>';
  const r = applyOps(tagged, [{ type: "replace", target: "a" }]);
  assert.equal(r.html, null);
  assert.ok(r.errors.length >= 1);
});

// ─── resolveOpIdByPath ─────────────────────────────────────────────────────

test("resolveOpIdByPath: matches body-level descendant", () => {
  const tagged =
    '<html><body><main data-op-id="m"><section data-op-id="s"><p data-op-id="p">x</p></section></main></body></html>';
  assert.equal(resolveOpIdByPath(tagged, "main > section > p"), "p");
});

test("resolveOpIdByPath: empty path or no match → null", () => {
  const tagged = '<html><body><div data-op-id="a">x</div></body></html>';
  assert.equal(resolveOpIdByPath(tagged, ""), null);
  assert.equal(resolveOpIdByPath(tagged, "main > section"), null);
});

// ─── buildScopedView ───────────────────────────────────────────────────────

test("buildScopedView: walks up to section ancestor + outline includes siblings", () => {
  const tagged =
    '<html><body><header data-op-id="hd"><h1 data-op-id="h1">Top</h1></header><main data-op-id="m"><section data-op-id="s"><p data-op-id="p">x</p></section></main></body></html>';
  const r = buildScopedView(tagged, "p");
  assert.ok(r !== null);
  assert.equal(r!.containerOpId, "s");
  assert.ok(r!.scopedHtml.includes('data-op-id="p"'));
  assert.ok(r!.outline.includes("[hd]"));
  assert.ok(r!.outline.includes("[m]"));
});

test("buildScopedView: missing pin → null", () => {
  const tagged =
    '<html><body><section data-op-id="s"><p data-op-id="p">x</p></section></body></html>';
  assert.equal(buildScopedView(tagged, "ghost"), null);
});

// Medido con la sonda: pidiendo "cambia el titular y pon el acento en verde",
// el modelo emite el replace correcto del <h1> y luego apunta al <body> para
// meter un `:root`. Dos de cada cinco veces la página pasaba de 13,788 chars a
// 9,524, sin una sola op `delete` y sin ningún error.
test("descarta la op que reemplazaría el documento entero", () => {
  const tagged = '<html data-op-id="r"><body data-op-id="0"><h1 data-op-id="2">Hola</h1></body></html>';
  const { ops, rejected } = rejectDocumentWideOps(tagged, [
    { type: "replace", target: "2", newHtml: "<h1>Adiós</h1>" },
    { type: "replace", target: "0", newHtml: "<style>:root{--ol-accent:#6b8e23}</style>" },
  ]);
  assert.equal(ops.length, 1);
  assert.equal(ops[0].target, "2");
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].target, "0");
});

test("el <html> tampoco es un objetivo válido", () => {
  const tagged = '<html data-op-id="r"><body data-op-id="0"><p data-op-id="1">x</p></body></html>';
  const { ops, rejected } = rejectDocumentWideOps(tagged, [{ type: "delete", target: "r" }]);
  assert.equal(ops.length, 0);
  assert.equal(rejected.length, 1);
});

// Sin raíces marcadas no hay nada que proteger, y tragarse las ops en ese caso
// sería peor que el fallo original.
test("deja pasar todo cuando el documento no trae raíces marcadas", () => {
  const { ops, rejected } = rejectDocumentWideOps("<div data-op-id=\"1\">x</div>", [
    { type: "replace", target: "1", newHtml: "<div>y</div>" },
  ]);
  assert.equal(ops.length, 1);
  assert.equal(rejected.length, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// UN `<edit/>` AUTO-CERRADO SE COMÍA LA OP SIGUIENTE.
//
// MEDIDO el 2026-08-25 contra el parser real. El crate hace dos pasadas, y la
// expresión de la forma abierta —`<edit\b([^>]*)>(.*?)</edit>`— casa también la
// auto-cerrada, porque `/` no es `>`. Resultado: la primera op sale DUPLICADA y
// la segunda DESAPARECE, con `errors` VACÍO.
//
// «quítame el carrito y pon el título en rojo» borraba el carrito dos veces y
// dejaba el título como estaba, sin un solo aviso — la degradación silenciosa
// que este repo prohíbe. Se volvió alcanzable al aceptar `op="delete"` sobre
// `runtime`: el prompt enseña la forma auto-cerrada y el modelo la usa.
test("parseOps: una auto-cerrada NO se come la op siguiente", () => {
  const r = parseOps(
    '<edits><edit op="delete" target="a"/><edit op="replace" target="b"><p>x</p></edit></edits>',
  );
  assert.deepEqual(r.errors, []);
  assert.deepEqual(
    r.ops.map((o) => `${o.type}:${o.target}`),
    ["delete:a", "replace:b"],
  );
});

// El prompt promete «operations are applied in emission order — later ops see
// the DOM after earlier ones», y el propio comentario del crate admitía que las
// auto-cerradas salían TODAS primero. Normalizar a una sola forma lo arregla.
test("parseOps: el ORDEN de emisión se respeta con las dos formas mezcladas", () => {
  const r = parseOps(
    '<edits><edit op="replace" target="b"><p>x</p></edit><edit op="delete" target="a"/></edits>',
  );
  assert.deepEqual(
    r.ops.map((o) => `${o.type}:${o.target}`),
    ["replace:b", "delete:a"],
  );
});

test("parseOps: con espacio antes de la barra, igual", () => {
  const r = parseOps(
    '<edits><edit op="delete" target="a" /><edit op="replace" target="b"><p>x</p></edit></edits>',
  );
  assert.deepEqual(
    r.ops.map((o) => `${o.type}:${o.target}`),
    ["delete:a", "replace:b"],
  );
});

// CONTRA-PRUEBA: normalizar no puede convertir un `replace` sin contenido en
// una op válida. Un replace auto-cerrado no dice CON QUÉ reemplazar.
test("CONTRA-PRUEBA: un replace auto-cerrado sigue siendo un error", () => {
  const r = parseOps('<edits><edit op="replace" target="a"/></edits>');
  assert.equal(r.ops.length, 0);
  assert.equal(r.errors.length, 1);
});

// CONTRA-PRUEBA: una op abierta cuyo contenido lleva atributos con `/` (una
// URL, por ejemplo) no se toca.
test("CONTRA-PRUEBA: una URL dentro del contenido no confunde a la normalización", () => {
  const r = parseOps(
    '<edits><edit op="replace" target="a"><img src="https://x.com/a/b.webp" alt="f"></edit></edits>',
  );
  assert.deepEqual(r.errors, []);
  assert.equal(r.ops.length, 1);
  assert.ok(r.ops[0]!.newHtml!.includes("https://x.com/a/b.webp"));
});
