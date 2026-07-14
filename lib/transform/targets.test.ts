import { describe, it, expect } from "vitest";
import { findBakeTargets } from "./targets";

const doc = (body: string) => `<!doctype html><html><head></head><body>${body}</body></html>`;

// La lógica es la de la sonda de daño (scratch/sanitize-damage-probe-full.mts),
// convertida a producción: un contenedor VACÍO EN EL FUENTE que un script
// (que el sanitizer borrará) llena vía innerHTML/appendChild/… es un objetivo
// de bake; un <path>/<polyline> sin d=/points= es geometría muerta. El
// pre-etiquetado data-ol-bake-c/g es TEMPORAL — bake.ts lo consume y lo
// elimina; jamás llega al HTML final (lo afirma bake.test.ts).
describe("findBakeTargets — contenedores", () => {
  it("etiqueta un contenedor vacío que un script llena por getElementById", () => {
    const html = doc(
      `<div id="grid"></div><script>const g=document.getElementById("grid");g.innerHTML="<b>x</b>";</script>`,
    );
    const t = findBakeTargets(html);
    expect(t.containers).toBe(1);
    expect(t.taggedHtml).toMatch(/<div id="grid" data-ol-bake-c="0">/);
  });
  it("sink DIRECTO encadenado (sin variable): document.getElementById('x').innerHTML=", () => {
    // La sonda original solo veía la forma con binding (var g = ...; g.innerHTML=)
    // — el test de la trampa de bake.test.ts cazó este hueco (2026-07-14).
    const html = doc(
      `<div id="grid"></div><script>document.getElementById("grid").innerHTML="x";</script>`,
    );
    expect(findBakeTargets(html).containers).toBe(1);
  });
  it("querySelector('#id') también resuelve como binding", () => {
    const html = doc(
      `<section id="team"></section><script>var s=document.querySelector("#team");s.appendChild(document.createElement("p"));</script>`,
    );
    expect(findBakeTargets(html).containers).toBe(1);
  });
  it("un contenedor CON contenido en el fuente NO es objetivo", () => {
    const html = doc(
      `<div id="grid"><p>ya tengo</p></div><script>document.getElementById("grid").innerHTML="x";</script>`,
    );
    expect(findBakeTargets(html).containers).toBe(0);
  });
  it("un contenedor vacío que NINGÚN script referencia NO es objetivo", () => {
    const html = doc(`<div id="solo"></div><script>console.log(1)</script>`);
    expect(findBakeTargets(html).containers).toBe(0);
  });
  it("el <script src> del CDN de Tailwind no cuenta como script de autor", () => {
    const html = doc(`<div id="g"></div><script src="https://cdn.tailwindcss.com"></script>`);
    expect(findBakeTargets(html).containers).toBe(0);
  });
});

describe("findBakeTargets — geometría", () => {
  it("etiqueta un <path> sin d= y un <polyline> sin points=", () => {
    const html = doc(`<svg><path stroke="red"></path><polyline fill="none"></polyline></svg>`);
    const t = findBakeTargets(html);
    expect(t.geoms).toBe(2);
    expect(t.taggedHtml).toMatch(/<path stroke="red" data-ol-bake-g="0">/);
    expect(t.taggedHtml).toMatch(/<polyline fill="none" data-ol-bake-g="1">/);
  });
  it("un <path d='M0 0'> NO es objetivo", () => {
    const html = doc(`<svg><path d="M0 0L5 5"></path></svg>`);
    expect(findBakeTargets(html).geoms).toBe(0);
  });
});

describe("findBakeTargets — sin objetivos", () => {
  it("página sin scripts: cero objetivos y el html vuelve INTACTO byte a byte", () => {
    const html = doc(`<h1>Hola</h1><div id="vacio"></div>`);
    const t = findBakeTargets(html);
    expect(t.containers).toBe(0);
    expect(t.geoms).toBe(0);
    expect(t.taggedHtml).toBe(html);
  });
});
