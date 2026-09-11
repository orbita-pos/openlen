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
  enPalabras,
  mencionaEl,
  mencionaHerramientas,
  bloqueDe,
  checkTitularTotal,
  checkNotasDeGrupo,
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

test("números en letra, en los dos idiomas", () => {
  assert.deepEqual(enPalabras(27, "es"), ["veintisiete"]);
  assert.deepEqual(enPalabras(27, "en"), ["twenty-seven", "twenty seven"]);
  assert.deepEqual(enPalabras(28, "es"), ["veintiocho"]);
  assert.deepEqual(enPalabras(30, "es"), ["treinta"]);
  assert.deepEqual(enPalabras(31, "es"), ["treinta y uno", "treinta y un"]);
  assert.deepEqual(enPalabras(34, "es"), ["treinta y cuatro"]);
  assert.deepEqual(enPalabras(21, "es"), ["veintiuno", "veintiun"]);
  assert.deepEqual(enPalabras(120, "es"), []);
});

test("menciona el número: con cifra, con letra, y con tilde", () => {
  assert.ok(mencionaEl("Veintisiete herramientas y dos ojos", 27, "es"));
  assert.ok(mencionaEl("Twenty-seven tools and two eyes", 27, "en"));
  assert.ok(mencionaEl("27 herramientas", 27, "es"));
  assert.ok(mencionaEl("Dieciséis herramientas", 16, "es"), "la tilde no puede impedir el match");
  assert.ok(!mencionaEl("Veintisiete herramientas y dos ojos", 28, "es"));
  assert.ok(!mencionaEl("270 herramientas", 27, "es"), "270 no menciona el 27");
});

test("el número cuenta sólo si va pegado a «herramientas»", () => {
  assert.ok(mencionaHerramientas("Veintisiete herramientas y dos ojos", 27, "es"));
  assert.ok(mencionaHerramientas("Twenty-seven tools and two eyes", 27, "en"));
  assert.ok(mencionaHerramientas("1 herramienta · 2 modos", 1, "es"));
  assert.ok(mencionaHerramientas("1 tool · 2 modes", 1, "en"));
  // 🔴 EL AGUJERO QUE ESTO TAPA: la nota lleva un «2» que no cuenta herramientas.
  assert.ok(!mencionaHerramientas("1 herramienta · 2 modos", 2, "es"));
  assert.ok(!mencionaHerramientas("1 tool · 2 modes", 2, "en"));
  // Y el titular lleva «dos ojos», que tampoco son herramientas.
  assert.ok(!mencionaHerramientas("Veintisiete herramientas y dos ojos", 2, "es"));
});

test("bloqueDe: cuenta llaves, no se come el objeto vecino", () => {
  const src = `a: { x: { y: 1 }, z: 2 }, b: { w: 3 }`;
  assert.equal(bloqueDe(src, "a"), " x: { y: 1 }, z: 2 ");
  assert.equal(bloqueDe(src, "b"), " w: 3 ");
  assert.equal(bloqueDe(src, "nada"), null);
});

// 🔴 LA TRAMPA QUE ESTO CIERRA: el catálogo pasa de 27 a 28, la puerta de los
// nombres obliga a tocar el JSON, y el titular se queda diciendo «Veintisiete».
const TARJETA = `
  portada: {
    tarjeta: {
      antetitulo: "Len · septiembre 2026",
      titulo: "Veintisiete herramientas y dos ojos",
      grupos: {
        mirar: { titulo: "Mirar", nota: "1 herramienta · 2 modos", texto: "x" },
        leer: { titulo: "Leer", texto: "y" },
      },
    },
  },
`;
const GRUPOS = [
  { id: "mirar", herramientas: ["mirar_pagina"] },
  { id: "leer", herramientas: ["a", "b", "c"] },
];

test("el titular tiene que nombrar el total real de herramientas", () => {
  assert.deepEqual(checkTitularTotal(TARJETA, "i18n/es.ts", 27, "es"), []);
  assert.match(checkTitularTotal(TARJETA, "i18n/es.ts", 28, "es")[0], /el número está a mano/);
  assert.match(checkTitularTotal("nada", "i18n/es.ts", 27, "es")[0], /no encuentro el bloque/);
});

test("una nota escrita a mano tiene que cuadrar; sin nota no se comprueba", () => {
  assert.deepEqual(checkNotasDeGrupo(TARJETA, "i18n/es.ts", GRUPOS, "es"), []);
  const dos = [{ id: "mirar", herramientas: ["mirar_pagina", "otra"] }, GRUPOS[1]];
  assert.match(checkNotasDeGrupo(TARJETA, "i18n/es.ts", dos, "es")[0], /la nota de «mirar»/);
  const falta = [...GRUPOS, { id: "fotos", herramientas: ["x"] }];
  assert.match(checkNotasDeGrupo(TARJETA, "i18n/es.ts", falta, "es")[0], /está en el JSON y no en la tarjeta/);
});
