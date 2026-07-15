import { describe, it, expect, beforeEach } from "vitest";
import { mount, trackDocumentListeners } from "./test-helpers";
import { tabs } from "./tabs";

// Dos grupos independientes en la misma página, para probar de paso que no se
// pisan (cada click resuelve SU propio [data-ol-tabs] y su contenedor).
const TABS = `
  <div data-ol-tabs="inst" role="tablist">
    <button data-ol-tab="npm" id="t-npm" aria-selected="true">npm</button>
    <button data-ol-tab="pnpm" id="t-pnpm" aria-selected="false">pnpm</button>
  </div>
  <div data-ol-tab-panels="inst">
    <pre data-ol-tab-panel="npm" id="p-npm">npm i</pre>
    <pre data-ol-tab-panel="pnpm" id="p-pnpm">pnpm add</pre>
  </div>
  <div data-ol-tabs="plan">
    <button data-ol-tab="mes" id="t-mes" aria-selected="true">Mensual</button>
    <button data-ol-tab="ano" id="t-ano" aria-selected="false">Anual</button>
  </div>
  <div data-ol-tab-panels="plan">
    <div data-ol-tab-panel="mes" id="p-mes">$7/mes</div>
    <div data-ol-tab-panel="ano" id="p-ano">$70/año</div>
  </div>`;

const on = (id: string) => document.getElementById(id)!.hasAttribute("data-ol-tab-active");
const sel = (id: string) => document.getElementById(id)!.getAttribute("aria-selected");

describe("tabs", () => {
  trackDocumentListeners();
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("al montar: marca el contenedor ready y activa el PRIMER panel de cada grupo", () => {
    mount(TABS);
    expect(document.querySelector('[data-ol-tab-panels="inst"]')!.hasAttribute("data-ol-tab-ready")).toBe(true);
    expect(on("p-npm")).toBe(true);
    expect(on("p-pnpm")).toBe(false);
    expect(sel("t-npm")).toBe("true");
    expect(sel("t-pnpm")).toBe("false");
  });

  it("click en una pestaña activa su panel y desactiva el hermano; aria-selected sigue", () => {
    mount(TABS);
    document.getElementById("t-pnpm")!.click();
    expect(on("p-pnpm")).toBe(true);
    expect(on("p-npm")).toBe(false);
    expect(sel("t-pnpm")).toBe("true");
    expect(sel("t-npm")).toBe("false");
  });

  it("dos grupos independientes NO se pisan", () => {
    mount(TABS);
    document.getElementById("t-ano")!.click(); // solo el grupo 'plan'
    expect(on("p-ano")).toBe(true);
    expect(on("p-mes")).toBe(false);
    // el grupo 'inst' sigue en su primer panel, intacto
    expect(on("p-npm")).toBe(true);
    expect(on("p-pnpm")).toBe(false);
  });

  it("GUARDA anti-blanqueo: click en una pestaña SIN panel pareja no toca nada", () => {
    mount(`
      <div data-ol-tabs="g">
        <button data-ol-tab="real" id="t-real" aria-selected="true">Real</button>
        <button data-ol-tab="fantasma" id="t-fant" aria-selected="false">Fantasma</button>
      </div>
      <div data-ol-tab-panels="g"><div data-ol-tab-panel="real" id="p-real">x</div></div>`);
    expect(on("p-real")).toBe(true);
    document.getElementById("t-fant")!.click();
    // el panel real NO se apagó (jamás dejamos el contenedor sin panel activo)
    expect(on("p-real")).toBe(true);
    // y aria-selected tampoco cambió (la pestaña fantasma no ganó nada)
    expect(sel("t-real")).toBe("true");
  });

  it("se calla en modo edición: el click no cambia de pestaña", () => {
    document.body.setAttribute("data-openlen-edit-mode", "");
    mount(TABS);
    document.getElementById("t-pnpm")!.click();
    // el init SÍ corre (no depende de olEditing) — activa el primero — pero el
    // CLICK no: sigue en npm.
    expect(on("p-npm")).toBe(true);
    expect(on("p-pnpm")).toBe(false);
    document.body.removeAttribute("data-openlen-edit-mode");
  });

  it("declara content-intact: sin runtime (sin ready) se ven todos los paneles", () => {
    // La prueba de estilo computado vive en el arnés de conformidad; aquí solo
    // fijamos el contrato declarado.
    expect(tabs.degradation).toBe("content-intact");
  });
});
