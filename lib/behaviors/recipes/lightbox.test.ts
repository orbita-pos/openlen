import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { lightbox } from "./lightbox";
import { buildBehaviorsScript } from "../build";

function mount(body: string) {
  document.body.innerHTML = body;
  const script = buildBehaviorsScript(`<html><body>${body}</body></html>`)!;
  // eslint-disable-next-line no-new-func
  new Function(script)();   // solo en el TEST; el runtime nunca hace esto
}

// mount() delega vía document.addEventListener('click', ...), y jsdom/vitest
// reutilizan el MISMO `document` para todo el archivo — solo body.innerHTML se
// resetea entre tests, los listeners puestos sobre `document` NO. Sin este
// tracking, cada it() acumula otro listener de los tests anteriores: un solo
// click dispara N handlers y crea N modales, así que un test que cierra
// clickeando UN modal deja vivos los N-1 restantes (falso rojo). En una página
// publicada esto no ocurre nunca — bakeBehaviors es idempotente vía
// BEHAVIORS_MARKER, un único <script> por página — es higiene de ESTE archivo.
let tracked: Array<[string, EventListenerOrEventListenerObject]>;
let origAddEventListener: typeof document.addEventListener;

describe("lightbox", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    tracked = [];
    origAddEventListener = document.addEventListener.bind(document);
    document.addEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject,
      opts?: boolean | AddEventListenerOptions,
    ) => {
      tracked.push([type, listener]);
      origAddEventListener(type, listener, opts);
    }) as typeof document.addEventListener;
  });

  afterEach(() => {
    document.addEventListener = origAddEventListener;
    for (const [type, listener] of tracked) document.removeEventListener(type, listener);
  });

  it("abre un overlay con la imagen del href al hacer click", () => {
    mount(`<a data-ol-lightbox href="https://images.openlen.com/g.jpg"><img src="t.jpg" alt="taco"></a>`);
    document.querySelector<HTMLAnchorElement>("[data-ol-lightbox]")!.click();
    const img = document.querySelector<HTMLImageElement>("[data-ol-lb-modal] img");
    expect(img).not.toBeNull();
    expect(img!.src).toBe("https://images.openlen.com/g.jpg");
  });

  it("cierra con Escape", () => {
    mount(`<a data-ol-lightbox href="https://images.openlen.com/g.jpg"><img src="t.jpg" alt="t"></a>`);
    document.querySelector<HTMLAnchorElement>("[data-ol-lightbox]")!.click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.querySelector("[data-ol-lb-modal]")).toBeNull();
  });

  it("SEGURIDAD: ignora un href que no sea http(s) — el sanitizer es una capa, no la única", () => {
    mount(`<a data-ol-lightbox href="javascript:alert(1)"><img src="t.jpg" alt="t"></a>`);
    document.querySelector<HTMLAnchorElement>("[data-ol-lightbox]")!.click();
    expect(document.querySelector("[data-ol-lb-modal]")).toBeNull();
  });

  it("se calla en modo edición (no secuestra el click del creador)", () => {
    document.body.setAttribute("data-openlen-edit-mode", "");
    mount(`<a data-ol-lightbox href="https://images.openlen.com/g.jpg"><img src="t.jpg" alt="t"></a>`);
    document.querySelector<HTMLAnchorElement>("[data-ol-lightbox]")!.click();
    expect(document.querySelector("[data-ol-lb-modal]")).toBeNull();
    document.body.removeAttribute("data-openlen-edit-mode");
  });

  it("declara content-intact: sin runtime el <a> abre la foto por sí solo", () => {
    expect(lightbox.degradation).toBe("content-intact");
  });

  // --- Requeridos por task-7 además de los del brief ---

  it("cierra al hacer click en el backdrop", () => {
    mount(`<a data-ol-lightbox href="https://images.openlen.com/g.jpg"><img src="t.jpg" alt="t"></a>`);
    document.querySelector<HTMLAnchorElement>("[data-ol-lightbox]")!.click();
    document.querySelector<HTMLElement>("[data-ol-lb-modal]")!.click();
    expect(document.querySelector("[data-ol-lb-modal]")).toBeNull();
  });

  it("el modal nace con role=dialog y aria-modal=true", () => {
    mount(`<a data-ol-lightbox href="https://images.openlen.com/g.jpg"><img src="t.jpg" alt="t"></a>`);
    document.querySelector<HTMLAnchorElement>("[data-ol-lightbox]")!.click();
    const modal = document.querySelector<HTMLElement>("[data-ol-lb-modal]")!;
    expect(modal.getAttribute("role")).toBe("dialog");
    expect(modal.getAttribute("aria-modal")).toBe("true");
  });

  it("propaga el alt de la miniatura a la imagen grande", () => {
    mount(`<a data-ol-lightbox href="https://images.openlen.com/g.jpg"><img src="t.jpg" alt="Plato de tacos al pastor"></a>`);
    document.querySelector<HTMLAnchorElement>("[data-ol-lightbox]")!.click();
    const img = document.querySelector<HTMLImageElement>("[data-ol-lb-modal] img")!;
    expect(img.alt).toBe("Plato de tacos al pastor");
  });

  // --- Foco: no lo pedía el brief; se añadió porque cabía en presupuesto (ver lightbox.ts) ---

  it("mueve el foco al modal al abrir y lo devuelve al <a> al cerrar (Escape)", () => {
    mount(`<a data-ol-lightbox href="https://images.openlen.com/g.jpg"><img src="t.jpg" alt="t"></a>`);
    const a = document.querySelector<HTMLAnchorElement>("[data-ol-lightbox]")!;
    a.click();
    const modal = document.querySelector<HTMLElement>("[data-ol-lb-modal]")!;
    expect(document.activeElement).toBe(modal);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.activeElement).toBe(a);
  });

  it("devuelve el foco al <a> al cerrar por click en el backdrop también", () => {
    mount(`<a data-ol-lightbox href="https://images.openlen.com/g.jpg"><img src="t.jpg" alt="t"></a>`);
    const a = document.querySelector<HTMLAnchorElement>("[data-ol-lightbox]")!;
    a.click();
    document.querySelector<HTMLElement>("[data-ol-lb-modal]")!.click();
    expect(document.activeElement).toBe(a);
  });
});
