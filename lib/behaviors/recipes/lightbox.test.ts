import { describe, it, expect, beforeEach } from "vitest";
import { lightbox } from "./lightbox";
import { mount, trackDocumentListeners } from "./test-helpers";

describe("lightbox", () => {
  // Por qué el tracking de listeners es obligatorio aquí (y no un extra):
  // ver el comentario en test-helpers.ts — mount() delega vía
  // document.addEventListener('click', ...) y jsdom/vitest reutilizan el
  // MISMO `document` para todo este archivo.
  trackDocumentListeners();
  beforeEach(() => {
    document.body.innerHTML = "";
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
