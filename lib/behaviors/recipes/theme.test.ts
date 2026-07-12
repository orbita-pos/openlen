import { describe, it, expect, beforeEach, vi } from "vitest";
import { theme } from "./theme";
import { mount, trackDocumentListeners } from "./test-helpers";
import { bakeBehaviors, buildBehaviorsHead } from "../build";

const MARKUP = `<button data-ol-theme aria-label="Cambiar entre modo claro y oscuro">Tema</button>`;

// localStorage.getItem/setItem no son `readonly` como métodos de la interfaz
// Storage, pero la PROPIEDAD `Window.localStorage` sí lo es en lib.dom.d.ts,
// y jsdom implementa Storage detrás de un Proxy (soporta `localStorage.x =
// 'v'` como alias de setItem, para el acceso "por nombre" del spec) cuyo
// comportamiento ante una reasignación directa de método no es de fiar.
// Reemplazar la propiedad ENTERA vía Object.defineProperty —mismo escape
// hatch que navigator.clipboard en copy.test.ts— evita pelear con ese Proxy:
// sustituye window.localStorage por un objeto propio y simple, sin tocar la
// implementación real de jsdom.
function stubLocalStorage(impl: Partial<Storage>) {
  Object.defineProperty(window, "localStorage", {
    value: impl,
    configurable: true,
  });
}

/** Storage en memoria, funcional — el estado por defecto de cada test. Nunca
 *  se reutiliza el localStorage real de jsdom entre tests (evita depender de
 *  si persiste o no de un `it()` a otro); cada test arranca con su propio
 *  Map vacío. */
function workingLocalStorage(): Partial<Storage> {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
  };
}

describe("theme", () => {
  // Por qué el tracking de listeners es obligatorio aquí (y no un extra): ver
  // el comentario en test-helpers.ts — mount() delega vía
  // document.addEventListener('click', ...), y jsdom/vitest reutilizan el
  // MISMO document para todo este archivo. MÁS peligroso aquí que en
  // copy/filter: classList.toggle('dark') no lleva el segundo argumento de
  // fuerza (a diferencia del toggleAttribute(name, force) de filter), así
  // que es un XOR real — 2 listeners acumulados harían que UN click deje el
  // estado EXACTAMENTE como estaba (toggle, toggle = no-op), no solo "corre
  // la mutación de más" — sin este tracking, el archivo sería flaky según
  // cuántos tests hubieran montado antes.
  trackDocumentListeners();

  beforeEach(() => {
    document.body.innerHTML = "";
    document.documentElement.className = "";
    stubLocalStorage(workingLocalStorage());
  });

  it("click activa modo oscuro: <html> gana .dark y localStorage['ol-theme'] queda en 'dark'", () => {
    mount(MARKUP);
    document.querySelector<HTMLButtonElement>("[data-ol-theme]")!.click();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("ol-theme")).toBe("dark");
  });

  it("segundo click revierte: .dark sale de <html> y localStorage queda en 'light'", () => {
    mount(MARKUP);
    const btn = document.querySelector<HTMLButtonElement>("[data-ol-theme]")!;
    btn.click();
    btn.click();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem("ol-theme")).toBe("light");
  });

  it("el pre-paint funciona: con localStorage['ol-theme']==='dark', ejecutar headJs pone .dark en <html> sin ningún click", () => {
    localStorage.setItem("ol-theme", "dark");
    const html = `<!doctype html><html><body>${MARKUP}</body></html>`;
    const headScript = buildBehaviorsHead(html);
    expect(headScript).not.toBeNull();
    // eslint-disable-next-line no-new-func
    new Function(headScript!)(); // solo en el TEST — igual que test-helpers.ts::mount()
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("se calla en modo edición: el click no toca <html> ni localStorage", () => {
    document.body.setAttribute("data-openlen-edit-mode", "");
    mount(MARKUP);
    document.querySelector<HTMLButtonElement>("[data-ol-theme]")!.click();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem("ol-theme")).toBeNull();
    document.body.removeAttribute("data-openlen-edit-mode");
  });

  it("localStorage que lanza: el runtime no revienta (la excepción no escapa sin manejar) y el toggle visual sigue funcionando, solo no persiste", () => {
    stubLocalStorage({
      getItem: () => {
        throw new Error("SecurityError: modo privado");
      },
      setItem: () => {
        throw new Error("SecurityError: modo privado");
      },
    });

    // Por qué esto NO se prueba con btn.click() + expect(...).not.toThrow():
    // dispatchEvent sigue el spec de "reportar la excepción" sin relanzarla
    // al llamador — jsdom no revienta el test aunque el listener explote (se
    // ve en el stderr de lightbox.test.ts, "Not implemented: window.alert",
    // sin que ese test falle) — así que ese assert pasaría en verde CON o
    // SIN el try/catch. Y classList.toggle('dark') corre ANTES del throw en
    // AMBOS casos (con o sin guard, ver el comentario en theme.ts), así que
    // tampoco distinguiría por sí solo — es la misma trampa "prueba el
    // efecto, no la causa" que este task existe para cerrar, aplicada a este
    // guard en concreto. La única forma fiable de observar si la excepción
    // escapa sin manejar es invocar el listener como función PLANA (no vía
    // dispatchEvent); vi.spyOn deja capturar la referencia real que mount()
    // registró, sin reinventar el monkey-patch de trackDocumentListeners.
    const addSpy = vi.spyOn(document, "addEventListener");
    mount(MARKUP);
    const call = addSpy.mock.calls.find(([type]) => type === "click")!;
    const handler = call[1] as unknown as (e: { target: EventTarget | null }) => void;
    addSpy.mockRestore();

    const btn = document.querySelector<HTMLButtonElement>("[data-ol-theme]")!;
    expect(() => handler({ target: btn })).not.toThrow();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("declara control-inert: sin runtime el botón no hace nada", () => {
    expect(theme.degradation).toBe("control-inert");
  });

  // headJs tiene SU PROPIO try/catch, textualmente distinto del de `js` — un
  // guard que se puede borrar sin que nada se queje es un guard que falta
  // probar (la instrucción de este task). A diferencia del try/catch de
  // `js` (protegido vía dispatchEvent, necesita vi.spyOn — ver el test de
  // arriba), headJs corre como script de nivel superior dentro de `new
  // Function(...)()`: una excepción sin capturar ahí SÍ se propaga directo a
  // la llamada, así que expect(...).not.toThrow() sobre el propio `new
  // Function` es fiable sin trucos adicionales.
  it("headJs: si localStorage lanza durante el pre-paint, el runtime no revienta (y simplemente no aplica .dark)", () => {
    stubLocalStorage({
      getItem: () => {
        throw new Error("SecurityError: modo privado");
      },
    });
    const html = `<!doctype html><html><body>${MARKUP}</body></html>`;
    const headScript = buildBehaviorsHead(html)!;
    // eslint-disable-next-line no-new-func
    expect(() => new Function(headScript)()).not.toThrow();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});

// Estrena el camino de injectIntoHead (build.ts) con la receta REAL — hasta
// hoy solo build.test.ts lo ejercitaba, y con un registro FALSO (fake() con
// headJs de relleno). bakeBehaviors por defecto usa el registro real
// (BEHAVIORS/BEHAVIOR_ORDER), y MARKUP solo trae el marcador de theme, así
// que ninguna otra receta se cuela en el script compuesto de estos 2 tests.
describe("theme — inyección real en <head> (headJs)", () => {
  it("bakeBehaviors: con </head> presente, el script del pre-paint va antes de </head>", () => {
    const html = `<!doctype html><html><head><title>Mi página</title></head><body>${MARKUP}</body></html>`;
    const out = bakeBehaviors(html);
    expect(out).toContain(theme.headJs!);
    expect(out.indexOf(theme.headJs!)).toBeLessThan(out.indexOf("</head>"));
  });

  it("bakeBehaviors: con <!DOCTYPE> y SIN </head>, el doctype sigue siendo lo primero del documento (fix de quirks-mode del Task 2) y el script del head está presente", () => {
    const html = `<!DOCTYPE html><html><body>${MARKUP}</body></html>`;
    const out = bakeBehaviors(html);
    expect(out.trimStart().startsWith("<!DOCTYPE")).toBe(true);
    expect(out).toContain(theme.headJs!);
  });
});
