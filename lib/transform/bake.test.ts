import { describe, it, expect, vi } from "vitest";
import { bakeGeneratedContent, type RunPage } from "./bake";

const doc = (body: string, htmlAttrs = "") =>
  `<!doctype html><html${htmlAttrs}><head></head><body>${body}</body></html>`;

const GRID_PAGE = doc(
  `<div id="grid"></div><svg><path stroke="red"></path></svg>` +
    `<script>const g=document.getElementById("grid");g.innerHTML="x";</script>`,
);

describe("bakeGeneratedContent", () => {
  it("inserta la captura en el contenedor y el d= en la geometría; NINGÚN data-ol-bake-* sobrevive", async () => {
    const fake: RunPage = async () => ({
      containers: { "0": "<article>Plato 1</article><article>Plato 2</article>" },
      geoms: { "0": "M0 0L10 10" },
    });
    const out = await bakeGeneratedContent(GRID_PAGE, fake);
    expect(out.bakedContainers).toBe(1);
    expect(out.bakedGeoms).toBe(1);
    expect(out.html).toContain("<article>Plato 1</article>");
    expect(out.html).toMatch(/<path stroke="red" d="M0 0L10 10">/);
    expect(out.html).not.toContain("data-ol-bake-");
  });

  it("limpia el opacity:0 INLINE de los fragmentos (artefacto de animación) pero RESPETA display:none", async () => {
    const fake: RunPage = async () => ({
      containers: {
        "0": `<article style="opacity:0">A</article><div style="display:none">menú</div><p style="opacity:0;color:red">B</p>`,
      },
      geoms: {},
    });
    const out = await bakeGeneratedContent(GRID_PAGE, fake);
    expect(out.html).not.toMatch(/opacity:\s*0/);
    expect(out.html).toContain('style="display:none"');
    expect(out.html).toContain("color:red");
  });

  it("captura vacía para un objetivo → ese contenedor queda como estaba (statu quo, jamás peor)", async () => {
    const fake: RunPage = async () => ({ containers: {}, geoms: {} });
    const out = await bakeGeneratedContent(GRID_PAGE, fake);
    expect(out.bakedContainers).toBe(0);
    expect(out.html).toMatch(/<div id="grid"><\/div>/);
    expect(out.html).not.toContain("data-ol-bake-");
  });

  it("cero objetivos → runPage NI SE LLAMA y el html vuelve intacto byte a byte", async () => {
    const spy = vi.fn<RunPage>(async () => ({ containers: {}, geoms: {} }));
    const html = doc(`<h1>Hola</h1>`);
    const out = await bakeGeneratedContent(html, spy);
    expect(spy).not.toHaveBeenCalled();
    expect(out.html).toBe(html);
  });

  it("LA TRAMPA: las clases/atributos de <html> y <body> del resultado son EXACTAMENTE los del fuente", async () => {
    // Simula lo que un runtime real haría: aunque la página en Chrome termine
    // con <html class="js"> (el patrón .js .reveal{opacity:0} de ~150
    // plantillas), el bake SOLO toma los fragmentos objetivo — capturar el
    // estado del documento entero produce páginas EN BLANCO.
    const trapped = doc(
      `<div id="grid"></div><script>document.documentElement.className="js";document.getElementById("grid").innerHTML="x";</script>`,
      ` lang="es"`,
    );
    const fake: RunPage = async () => ({ containers: { "0": "<b>vivo</b>" }, geoms: {} });
    const out = await bakeGeneratedContent(trapped, fake);
    expect(out.html).toMatch(/<html lang="es">/);
    expect(out.html).not.toMatch(/<html[^>]*class="js"/);
    expect(out.html).toContain("<b>vivo</b>");
  });

  it("un fragmento capturado NO puede contrabandear data-ol-bake-* al resultado (hallazgo publish-safety, 2026-07-14)", async () => {
    // Vector adversarial de from-html: el script del desconocido escribe
    // innerHTML que CONTIENE nuestros marcadores temporales — sin el barrido
    // final llegarían al HTML guardado (el sanitizer conserva data-*).
    const fake: RunPage = async () => ({
      containers: { "0": `<div data-ol-bake-c="0">contrabando</div><i data-ol-bake-g="7">x</i>` },
      geoms: {},
    });
    const out = await bakeGeneratedContent(GRID_PAGE, fake);
    expect(out.html).toContain("contrabando");
    expect(out.html).not.toContain("data-ol-bake-");
  });

  it("idempotencia: bake(bake(x)) === bake(x)", async () => {
    const fake: RunPage = async () => ({ containers: { "0": "<b>x</b>" }, geoms: { "0": "M1 1" } });
    const once = (await bakeGeneratedContent(GRID_PAGE, fake)).html;
    const twice = (await bakeGeneratedContent(once, fake)).html;
    expect(twice).toBe(once);
  });
});
