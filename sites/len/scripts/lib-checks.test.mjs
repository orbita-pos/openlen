import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkParity,
  extractCommits,
  checkCifrasSinCommit,
  checkCommits,
  checkDenylist,
  checkAbierto,
  checkIndice,
  catalogToolNames,
  checkToolGroups,
} from "./lib-checks.mjs";

test("paridad: un artículo sin una de sus versiones rompe", () => {
  assert.deepEqual(checkParity(["research/a.en.mdx", "research/a.es.mdx"]), []);
  assert.deepEqual(checkParity(["research/a.en.mdx"]), ["research/a: falta la versión es"]);
  assert.match(checkParity(["research/a.mdx"])[0], /\.en\.mdx o \.es\.mdx/);
});

test("commits: se extraen los hashes de las cifras y fuentes", () => {
  assert.deepEqual(
    extractCommits('<Cifra valor="1/12" commit="2d0c474f">x</Cifra> <Fuente commit="616c054b" />'),
    ["2d0c474f", "616c054b"],
  );
});

test("una Cifra sin commit rompe", () => {
  assert.deepEqual(checkCifrasSinCommit('<Cifra valor="1" commit="abcdef1">', "f"), []);
  assert.deepEqual(checkCifrasSinCommit('<Cifra valor="1">', "f"), ['f: <Cifra> sin commit — <Cifra valor="1">']);
});

test("commits: sólo pasan los públicos", () => {
  const publico = (h) => h === "aaaaaaa";
  assert.deepEqual(checkCommits(["aaaaaaa"], publico), []);
  assert.deepEqual(checkCommits(["bbbbbbb"], publico), ["bbbbbbb: no existe o no está en origin/master"]);
});

test("sin modelos ni proveedores", () => {
  assert.deepEqual(checkDenylist("Len mira la página", "f"), []);
  assert.match(checkDenylist("corre sobre Qwen", "f")[0], /Qwen/);
  assert.match(checkDenylist("un modelo de Anthropic", "f")[0], /Anthropic/);
});

test("todo artículo lleva <Abierto>", () => {
  assert.deepEqual(checkAbierto('<Abierto titulo="x">y</Abierto>', "research/a.es.mdx"), []);
  assert.equal(checkAbierto("nada", "research/a.es.mdx").length, 1);
  assert.deepEqual(checkAbierto("nada", "principles.es.mdx"), []);
});

test("cada entrada del índice apunta a un id que existe", () => {
  const src =
    'export const meta = { indice: [{ id: "la-curva", texto: "La curva" }] }\n<h2 id="la-curva">La curva</h2>';
  assert.deepEqual(checkIndice(src, "f"), []);
  assert.deepEqual(checkIndice(src.replace('id="la-curva">', 'id="otra">'), "f"), [
    "f: el índice apunta a #la-curva y no hay ningún id así",
  ]);
});

test("catálogo: se leen los nombres de herramientas", () => {
  const src = `  {\n      name: "leer_estado",\n      description: "x",\n  },\n  {\n      name: "editar_texto",\n`;
  assert.deepEqual(catalogToolNames(src), ["leer_estado", "editar_texto"]);
});

test("los grupos de la tarjeta cuadran con el catálogo", () => {
  const g = [{ id: "a", herramientas: ["x", "y"] }];
  assert.deepEqual(checkToolGroups(g, ["x", "y"]), []);
  assert.deepEqual(checkToolGroups(g, ["x", "y", "z"]), ["falta en la tarjeta: z"]);
  assert.deepEqual(checkToolGroups([{ id: "a", herramientas: ["x", "x"] }], ["x"]), ["repetida en la tarjeta: x"]);
  assert.deepEqual(checkToolGroups(g, ["x"]), ["no existe en el catálogo: y"]);
});
