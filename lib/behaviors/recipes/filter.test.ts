import { describe, it, expect, beforeEach } from "vitest";
import { filter } from "./filter";
import { mount, trackDocumentListeners } from "./test-helpers";

const MENU = `
  <div data-ol-filter-group="menu">
    <button data-ol-filter="*" aria-pressed="true">Todo</button>
    <button data-ol-filter="tacos" aria-pressed="false">Tacos</button>
    <button data-ol-filter="bebidas" aria-pressed="false">Bebidas</button>
  </div>
  <div data-ol-filter-target="menu">
    <article data-ol-tag="tacos" id="a1">Tacos al pastor</article>
    <article data-ol-tag="bebidas" id="a2">Agua de horchata</article>
    <article data-ol-tag="tacos vegano" id="a3">Tacos de nopal</article>
  </div>
`;

describe("filter", () => {
  // Por qué el tracking de listeners es obligatorio aquí (y no un extra):
  // ver el comentario en test-helpers.ts. filter es idempotente (togglear el
  // mismo data-ol-filtered un número par/impar de veces da el mismo estado
  // observable), así que una fuga de listeners pasaría en VERDE sin este
  // tracking — exactamente la trampa que describe test-helpers.ts.
  trackDocumentListeners();
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("click en una etiqueta oculta los items que no la llevan; conserva los que sí (incluida la multi-etiqueta)", () => {
    mount(MENU);
    document.querySelector<HTMLButtonElement>('[data-ol-filter="tacos"]')!.click();
    expect(document.getElementById("a1")!.hasAttribute("data-ol-filtered")).toBe(false); // tacos
    expect(document.getElementById("a2")!.hasAttribute("data-ol-filtered")).toBe(true); // bebidas
    expect(document.getElementById("a3")!.hasAttribute("data-ol-filtered")).toBe(false); // "tacos vegano" — multi-etiqueta
  });

  it("click en * no deja ningún item con data-ol-filtered, incluso tras haber filtrado", () => {
    mount(MENU);
    document.querySelector<HTMLButtonElement>('[data-ol-filter="tacos"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-ol-filter="*"]')!.click();
    expect(document.querySelectorAll("[data-ol-filtered]").length).toBe(0);
  });

  it("aria-pressed se mueve: solo el botón pulsado queda en true", () => {
    mount(MENU);
    document.querySelector<HTMLButtonElement>('[data-ol-filter="bebidas"]')!.click();
    expect(document.querySelector('[data-ol-filter="*"]')!.getAttribute("aria-pressed")).toBe("false");
    expect(document.querySelector('[data-ol-filter="tacos"]')!.getAttribute("aria-pressed")).toBe("false");
    expect(document.querySelector('[data-ol-filter="bebidas"]')!.getAttribute("aria-pressed")).toBe("true");
  });

  it("se calla en modo edición (no secuestra el click del creador)", () => {
    document.body.setAttribute("data-openlen-edit-mode", "");
    mount(MENU);
    document.querySelector<HTMLButtonElement>('[data-ol-filter="tacos"]')!.click();
    expect(document.querySelectorAll("[data-ol-filtered]").length).toBe(0);
    expect(document.querySelector('[data-ol-filter="tacos"]')!.getAttribute("aria-pressed")).toBe("false");
    document.body.removeAttribute("data-openlen-edit-mode");
  });

  it("dos grupos de filtro independientes no se pisan", () => {
    mount(`
      <div data-ol-filter-group="menu">
        <button data-ol-filter="*" aria-pressed="true">Todo</button>
        <button data-ol-filter="tacos" aria-pressed="false">Tacos</button>
      </div>
      <div data-ol-filter-target="menu">
        <article data-ol-tag="tacos" id="m1">Taco</article>
        <article data-ol-tag="bebidas" id="m2">Agua</article>
      </div>
      <div data-ol-filter-group="portafolio">
        <button data-ol-filter="*" aria-pressed="true">Todo</button>
        <button data-ol-filter="foto" aria-pressed="false">Foto</button>
      </div>
      <div data-ol-filter-target="portafolio">
        <article data-ol-tag="foto" id="p1">Foto 1</article>
        <article data-ol-tag="video" id="p2">Video 1</article>
      </div>
    `);
    document.querySelector<HTMLButtonElement>('[data-ol-filter-group="menu"] [data-ol-filter="tacos"]')!.click();

    expect(document.getElementById("m1")!.hasAttribute("data-ol-filtered")).toBe(false);
    expect(document.getElementById("m2")!.hasAttribute("data-ol-filtered")).toBe(true);
    // El grupo "portafolio" no se tocó: ni sus items ni su aria-pressed.
    expect(document.getElementById("p1")!.hasAttribute("data-ol-filtered")).toBe(false);
    expect(document.getElementById("p2")!.hasAttribute("data-ol-filtered")).toBe(false);
    expect(
      document.querySelector('[data-ol-filter-group="portafolio"] [data-ol-filter="*"]')!.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      document.querySelector('[data-ol-filter-group="portafolio"] [data-ol-filter="foto"]')!.getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("declara content-intact: sin runtime la rejilla se ve entera", () => {
    expect(filter.degradation).toBe("content-intact");
  });
});
