import { describe, it, expect, beforeEach, vi } from "vitest";
import { sticky } from "./sticky";
import { mount, trackDocumentListeners } from "./test-helpers";

const MARKUP = `<nav data-ol-sticky class="fixed top-0 w-full transition-colors">
  <a href="/">Mi negocio</a>
  <a href="/menu">Menú</a>
</nav>`;

/** jsdom no implementa scroll real: window.scrollY es un getter que SIEMPRE
 *  da 0 (no hay layout/viewport de verdad detrás). Object.defineProperty
 *  sobre `window` (configurable:true) sombrea ese getter con un valor fijo
 *  que el test controla — mismo escape hatch que stubMatchMedia en
 *  autoplay.test.ts y stubLocalStorage en theme.test.ts. Se resetea a 0 en
 *  cada test (beforeEach) para no heredar el valor que dejó el test
 *  anterior: `window` es el MISMO objeto reutilizado para todo el archivo. */
function stubScrollY(v: number) {
  Object.defineProperty(window, "scrollY", { value: v, configurable: true });
}

describe("sticky", () => {
  // trackDocumentListeners() no protege nada en ESTA receta — sticky escucha
  // sobre `window`, no sobre `document` (ver el comentario en sticky.ts:
  // scroll de página es un evento único y global, nada que delegar en
  // document). Se llama de todos modos por consistencia con el resto del
  // catálogo — mismo criterio que autoplay.test.ts, que tampoco fuga por esa
  // vía específica. La acumulación de listeners de `window` entre mounts SÍ
  // ocurre (nada la limpia, a diferencia de document), pero es inofensiva:
  // cada listener captura su propio `n` (el <nav> de SU mount) en el
  // closure; tras el siguiente `document.body.innerHTML = ""` ese nodo queda
  // huérfano, y un listener viejo que dispare después solo muta un elemento
  // que ya nadie consulta — document.querySelector y cualquier spy de este
  // archivo apuntan siempre al <nav> del mount MÁS RECIENTE.
  trackDocumentListeners();

  beforeEach(() => {
    document.body.innerHTML = "";
    stubScrollY(0);
  });

  it("scrollY=100 + evento scroll: el nav gana data-ol-stuck", () => {
    vi.useFakeTimers();
    mount(MARKUP);
    const nav = document.querySelector("[data-ol-sticky]")!;
    expect(nav.hasAttribute("data-ol-stuck")).toBe(false);

    stubScrollY(100);
    window.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(20);

    expect(nav.hasAttribute("data-ol-stuck")).toBe(true);
    vi.useRealTimers();
  });

  it("de vuelta a scrollY=0 + evento scroll: el nav pierde data-ol-stuck", () => {
    vi.useFakeTimers();
    stubScrollY(100);
    mount(MARKUP); // nace ya con el atributo (estado inicial) — ver el test dedicado abajo
    const nav = document.querySelector("[data-ol-sticky]")!;
    expect(nav.hasAttribute("data-ol-stuck")).toBe(true);

    stubScrollY(0);
    window.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(20);

    expect(nav.hasAttribute("data-ol-stuck")).toBe(false);
    vi.useRealTimers();
  });

  it("estado inicial: si la página nace ya scrolleada, el nav nace CON el atributo sin esperar ningún scroll", () => {
    stubScrollY(100);
    mount(MARKUP);
    const nav = document.querySelector("[data-ol-sticky]")!;
    // Ni dispatchEvent ni avance de reloj: el estado se aplica en el
    // arranque del script, síncrono, no a través del listener de scroll.
    expect(nav.hasAttribute("data-ol-stuck")).toBe(true);
  });

  it("se calla en modo edición: el scroll no cambia el atributo", () => {
    vi.useFakeTimers();
    document.body.setAttribute("data-openlen-edit-mode", "");
    mount(MARKUP);
    const nav = document.querySelector("[data-ol-sticky]")!;
    expect(nav.hasAttribute("data-ol-stuck")).toBe(false);

    stubScrollY(100);
    window.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(20);

    expect(nav.hasAttribute("data-ol-stuck")).toBe(false);
    document.body.removeAttribute("data-openlen-edit-mode");
    vi.useRealTimers();
  });

  it("el listener es pasivo: se registra sobre window con {passive:true}", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    mount(MARKUP);
    const call = addSpy.mock.calls.find(([type]) => type === "scroll");
    expect(call, "no se registró ningún listener de scroll sobre window").toBeDefined();
    expect(call![2]).toMatchObject({ passive: true });
    addSpy.mockRestore();
  });

  it("el throttle de rAF existe: N eventos de scroll seguidos no producen N escrituras al DOM", () => {
    vi.useFakeTimers();
    mount(MARKUP);
    const nav = document.querySelector("[data-ol-sticky]")!;
    const toggleSpy = vi.spyOn(nav, "toggleAttribute");

    stubScrollY(100);
    for (let i = 0; i < 5; i++) window.dispatchEvent(new Event("scroll"));
    // Coalescido: 5 eventos síncronos seguidos y TODAVÍA ningún frame corrió
    // — si esto ya hubiera escrito el DOM, no habría throttle, solo un
    // wrapper de rAF decorativo.
    expect(toggleSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(20);
    // Un solo frame pendiente, una sola escritura — no 5.
    expect(toggleSpy).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it("declara content-intact y no trae css propio (el aspecto de [data-ol-stuck] lo autora la IA)", () => {
    expect(sticky.degradation).toBe("content-intact");
    expect(sticky.css).toBeUndefined();
  });
});
