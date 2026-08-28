import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import { autoplay } from "./autoplay";
import { mount, trackDocumentListeners } from "./test-helpers";

// El row lleva el marcador él mismo — el caso "de libro" del contrato de
// carousel.ts (lib/publish/carousel.ts): flechas FUERA del scroller,
// [data-ol-scroller] es la pista.
const ROW_MARKER_ON_ROW = `<div data-ol-row data-ol-autoplay="2000" id="row">
  <button data-ol-scroll="prev" aria-label="Anterior">‹</button>
  <button data-ol-scroll="next" aria-label="Siguiente">›</button>
  <div data-ol-scroller id="scroller">
    <article>Plato 1</article>
    <article>Plato 2</article>
  </div>
</div>`;

// El marcador vive en un DESCENDIENTE del row, no en el row mismo — el otro
// caso legal según matchesHost (validate.ts camina ancestro-o-sí-mismo desde
// el Task 8). Prueba que el runtime resuelve su host con closest() y no
// asume "mismo elemento".
const ROW_MARKER_ON_DESCENDANT = `<div data-ol-row id="row">
  <span data-ol-autoplay="2000"></span>
  <button data-ol-scroll="prev" aria-label="Anterior">‹</button>
  <button data-ol-scroll="next" aria-label="Siguiente">›</button>
  <div data-ol-scroller id="scroller">
    <article>Plato 1</article>
    <article>Plato 2</article>
  </div>
</div>`;

// clientWidth/scrollWidth/scrollLeft no existen de verdad en jsdom (no hay
// layout — siempre dan 0). Object.defineProperty sobre la INSTANCIA sombrea
// lo que sea que el prototipo devuelva, así cada test controla exactamente
// si el scroller está "al final" o no, sin depender de un layout real.
function stubScrollGeometry(
  el: Element,
  { scrollLeft, clientWidth, scrollWidth }: { scrollLeft: number; clientWidth: number; scrollWidth: number },
) {
  Object.defineProperty(el, "scrollLeft", { value: scrollLeft, configurable: true });
  Object.defineProperty(el, "clientWidth", { value: clientWidth, configurable: true });
  Object.defineProperty(el, "scrollWidth", { value: scrollWidth, configurable: true });
}

// jsdom no define window.matchMedia EN ABSOLUTO — no es que devuelva
// matches:false por defecto, la propiedad ni siquiera existe (typeof
// "undefined"). stubMatchMedia(undefined) restaura ese estado nativo entre
// tests; un test concreto pide stubMatchMedia(true) para simular
// prefers-reduced-motion. Mismo problema de fondo que navigator.clipboard en
// copy.test.ts (ver su comentario) — aquí no hace falta Object.defineProperty
// porque matchMedia no es `readonly` en lib.dom.d.ts, pero `delete` de una
// propiedad no-opcional sí exige el mismo escape hatch de tsc.
function stubMatchMedia(matches?: boolean) {
  if (matches === undefined) {
    // @ts-expect-error — matchMedia no es opcional en lib.dom.d.ts; se borra
    // a propósito para volver al estado real de jsdom (no definida).
    delete window.matchMedia;
    return;
  }
  window.matchMedia = (() => ({
    matches,
    media: "",
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

describe("autoplay", () => {
  // Por qué el tracking de listeners es obligatorio aquí (y no un extra): ver
  // el comentario en test-helpers.ts. autoplay NO llama a
  // document.addEventListener (hover/stop se cablean sobre `row`, no sobre
  // `document` — ver el comentario en autoplay.ts), así que no hay nada que
  // fugue por esa vía específica hoy — pero es el patrón compartido de todas
  // las recetas de este catálogo (mismo razonamiento que countdown.test.ts).
  trackDocumentListeners();

  let scrollBy: Mock;

  beforeEach(() => {
    document.body.innerHTML = "";
    vi.useFakeTimers();
    // jsdom no implementa Element.prototype.scrollBy — sin este stub,
    // s.scrollBy(...) lanzaría "is not a function" en cuanto el runtime lo
    // tocara. Se asigna en el PROTOTIPO: el runtime resuelve `s` (el
    // scroller) recién al montar, y cualquier elemento lo hereda igual.
    scrollBy = vi.fn();
    Element.prototype.scrollBy = scrollBy;
    stubMatchMedia(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("avanza solo: tras data-ol-autoplay ms, scrollBy se llama con un left positivo", () => {
    mount(ROW_MARKER_ON_ROW);
    stubScrollGeometry(document.getElementById("scroller")!, { scrollLeft: 0, clientWidth: 200, scrollWidth: 1000 });

    vi.advanceTimersByTime(2000);

    expect(scrollBy).toHaveBeenCalledTimes(1);
    const call = scrollBy.mock.calls[0][0] as { left: number; behavior: string };
    expect(call.left).toBeGreaterThan(0);
    expect(call.behavior).toBe("smooth");
  });

  it("prefers-reduced-motion: con matchMedia stubeado a matches:true, scrollBy NUNCA se llama", () => {
    stubMatchMedia(true);
    mount(ROW_MARKER_ON_ROW);
    stubScrollGeometry(document.getElementById("scroller")!, { scrollLeft: 0, clientWidth: 200, scrollWidth: 1000 });

    vi.advanceTimersByTime(2000 * 5);

    expect(scrollBy).not.toHaveBeenCalled();
  });

  it("pausa en hover: con el puntero encima del row, avanzar el reloj no llama a scrollBy", () => {
    mount(ROW_MARKER_ON_ROW);
    stubScrollGeometry(document.getElementById("scroller")!, { scrollLeft: 0, clientWidth: 200, scrollWidth: 1000 });

    document.getElementById("row")!.dispatchEvent(new Event("mouseenter"));
    vi.advanceTimersByTime(2000);

    expect(scrollBy).not.toHaveBeenCalled();
  });

  it("pausa con el foco dentro del row (:focus-within) — el otro lado del OR de la regla 3, no solo hover", () => {
    mount(ROW_MARKER_ON_ROW);
    stubScrollGeometry(document.getElementById("scroller")!, { scrollLeft: 0, clientWidth: 200, scrollWidth: 1000 });

    document.querySelector<HTMLButtonElement>('[data-ol-scroll="next"]')!.focus();
    vi.advanceTimersByTime(2000);

    expect(scrollBy).not.toHaveBeenCalled();
  });

  it("para definitivamente al interactuar: un pointerdown detiene el avance para siempre, incluso al quitar el puntero después", () => {
    mount(ROW_MARKER_ON_ROW);
    const row = document.getElementById("row")!;
    stubScrollGeometry(document.getElementById("scroller")!, { scrollLeft: 0, clientWidth: 200, scrollWidth: 1000 });

    row.dispatchEvent(new Event("mouseenter")); // el visitante está mirando (pausa temporal)...
    document.getElementById("scroller")!.dispatchEvent(new Event("pointerdown", { bubbles: true })); // ...y ahora interactúa: se para PARA SIEMPRE
    row.dispatchEvent(new Event("mouseleave")); // quita el puntero — si el stop fuera solo "pausa", esto lo reanudaría

    vi.advanceTimersByTime(2000 * 5);

    expect(scrollBy).not.toHaveBeenCalled();
    // El assert de arriba prueba el EFECTO (scrollBy no se llama), no la
    // CAUSA: un mutante que cambia `function k(){clearInterval(iv)}` por un
    // flag (`stopped=true`, comprobado al inicio de tick) deja el tick
    // retornando temprano — ese assert seguiría en verde — pero el
    // setInterval JAMÁS se limpia: un tick cada `ms` para siempre en una
    // página publicada que el visitante puede dejar abierta horas.
    // vi.getTimerCount() caza la fuga directamente, sin pasar por scrollBy —
    // exactamente el mutante que coló los 11 tests de esta suite en verde
    // (ver progress.md, Task 11/12).
    expect(vi.getTimerCount()).toBe(0);
  });

  it("para definitivamente al interactuar: un keydown dentro del row también detiene el avance para siempre", () => {
    mount(ROW_MARKER_ON_ROW);
    stubScrollGeometry(document.getElementById("scroller")!, { scrollLeft: 0, clientWidth: 200, scrollWidth: 1000 });

    document.querySelector<HTMLButtonElement>('[data-ol-scroll="next"]')!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    vi.advanceTimersByTime(2000 * 5);

    expect(scrollBy).not.toHaveBeenCalled();
    // Mismo razonamiento que en la variante pointerdown de arriba: el mismo
    // `k()` compartido limpia el mismo `iv`, así que la misma fuga (flag en
    // vez de clearInterval) amenaza esta rama también — necesita su propia
    // red, no basta con que la otra variante la tenga.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("wraparound: con el scroller al final, el siguiente tick vuelve al principio (left negativo)", () => {
    mount(ROW_MARKER_ON_ROW);
    stubScrollGeometry(document.getElementById("scroller")!, { scrollLeft: 800, clientWidth: 200, scrollWidth: 1000 });

    vi.advanceTimersByTime(2000);

    expect(scrollBy).toHaveBeenCalledWith({ left: -800, behavior: "smooth" });
  });

  it("se calla en modo edición: avanzar el reloj no llama a scrollBy", () => {
    document.body.setAttribute("data-openlen-edit-mode", "");
    mount(ROW_MARKER_ON_ROW);
    stubScrollGeometry(document.getElementById("scroller")!, { scrollLeft: 0, clientWidth: 200, scrollWidth: 1000 });

    vi.advanceTimersByTime(2000);

    expect(scrollBy).not.toHaveBeenCalled();
    document.body.removeAttribute("data-openlen-edit-mode");
  });

  it("el marcador funciona sobre el propio [data-ol-row]", () => {
    mount(ROW_MARKER_ON_ROW);
    stubScrollGeometry(document.getElementById("scroller")!, { scrollLeft: 0, clientWidth: 200, scrollWidth: 1000 });

    vi.advanceTimersByTime(2000);

    expect(scrollBy).toHaveBeenCalledTimes(1);
  });

  it("el marcador funciona en un descendiente de [data-ol-row] (el invariante closest())", () => {
    mount(ROW_MARKER_ON_DESCENDANT);
    stubScrollGeometry(document.getElementById("scroller")!, { scrollLeft: 0, clientWidth: 200, scrollWidth: 1000 });

    vi.advanceTimersByTime(2000);

    expect(scrollBy).toHaveBeenCalledTimes(1);
  });

  it("declara content-intact: sin runtime el carrusel se desliza con el dedo y las flechas de carousel.ts siguen funcionando", () => {
    expect(autoplay.degradation).toBe("content-intact");
  });
});
