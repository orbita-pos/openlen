import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { copy } from "./copy";
import { mount, trackDocumentListeners } from "./test-helpers";

const MARKUP = `<code id="cupon-verano">TACOS20</code>
<button data-ol-copy="cupon-verano" data-ol-copied="¡Copiado!" aria-label="Copiar el cupón">Copiar</button>`;

// navigator.clipboard es `readonly` en lib.dom.d.ts (y jsdom ni siquiera lo
// define) — Object.defineProperty es el escape hatch estándar para stubearlo
// sin pelear con tsc. Mismo problema con document.execCommand: no lo define
// jsdom, así que un stub explícito es la única forma de comprobar que el
// fallback de verdad lo invoca (sin stub, la llamada real lanzaría y el
// try/catch de la receta se la comería en silencio — cierto, pero no prueba
// que el mecanismo correcto se disparó).
function stubClipboard(writeText?: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    value: writeText ? { writeText } : undefined,
    configurable: true,
  });
}

function stubExecCommand(fn?: (commandId: string) => boolean) {
  Object.defineProperty(document, "execCommand", {
    value: fn,
    configurable: true,
    writable: true,
  });
}

describe("copy", () => {
  // Por qué el tracking de listeners es obligatorio aquí (y no un extra): ver
  // el comentario en test-helpers.ts — mount() delega vía
  // document.addEventListener('click', ...) y jsdom/vitest reutilizan el
  // MISMO document para todo este archivo.
  trackDocumentListeners();

  beforeEach(() => {
    document.body.innerHTML = "";
    vi.useFakeTimers();
    // jsdom no define navigator.clipboard NI document.execCommand por
    // defecto — se resetean igual antes de cada test para que el stub de un
    // test no sobreviva al siguiente (mismo document/navigator reutilizado).
    stubClipboard(undefined);
    stubExecCommand(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("lee el valor del DOM (textContent del #id), no del atributo — EL test de la receta", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    mount(MARKUP);
    document.querySelector<HTMLButtonElement>("[data-ol-copy]")!.click();
    expect(writeText).toHaveBeenCalledWith("TACOS20");
    expect(writeText).not.toHaveBeenCalledWith("cupon-verano");
  });

  it("si el textContent del <code> cambia tras montar, el siguiente click copia el valor nuevo (no lo cachea)", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    mount(MARKUP);
    const btn = document.querySelector<HTMLButtonElement>("[data-ol-copy]")!;
    btn.click();
    expect(writeText).toHaveBeenLastCalledWith("TACOS20");
    document.getElementById("cupon-verano")!.textContent = "OTONO10";
    btn.click();
    expect(writeText).toHaveBeenLastCalledWith("OTONO10");
  });

  it("el texto del botón cambia a data-ol-copied y se restaura tras 2s", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    mount(MARKUP);
    const btn = document.querySelector<HTMLButtonElement>("[data-ol-copy]")!;
    const original = btn.textContent;
    btn.click();
    // writeText() resuelve en un microtask: la continuación .then(k) ya
    // quedó encolada ANTES de este await (orden FIFO de microtasks), y las
    // promesas nativas no las gobierna vi.useFakeTimers (solo
    // setTimeout/setInterval/Date) — un solo tick de microtask basta.
    await Promise.resolve();
    expect(btn.textContent).toBe("¡Copiado!");
    vi.advanceTimersByTime(2000);
    expect(btn.textContent).toBe(original);
  });

  it("doble click no deja el botón atascado: el 2º click no debe leer '¡Copiado!' como si fuera el texto original", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    mount(MARKUP);
    const btn = document.querySelector<HTMLButtonElement>("[data-ol-copy]")!;
    const original = btn.textContent;

    btn.click();
    await Promise.resolve(); // microtask de writeText() — ver comentario más arriba
    expect(btn.textContent).toBe("¡Copiado!");

    vi.advanceTimersByTime(1000); // a medio camino del restore de 2s del 1er click
    btn.click();
    await Promise.resolve();

    // El timer del 1er click restaura en t=2000 (1000ms desde aquí). Si el 2º
    // click reprogramó un timer propio con el "original" mal capturado
    // ("¡Copiado!"), ese timer dispara en t=3000 y pisa el restore correcto.
    vi.advanceTimersByTime(2000);
    expect(btn.textContent).toBe(original);
  });

  // Este es EL test del guard try/catch de la receta (ver comentario en
  // copy.ts): un vi.fn() que nunca lanza — como usaban los dos tests de
  // fallback antes de este cambio — prueba que el mecanismo de fallback SE
  // INVOCA, pero no prueba que el try/catch haga falta: quitar el
  // try/catch de copy.ts deja esta suite en verde igual, porque
  // execCommand nunca lanza en el stub. Aquí el stub SÍ lanza (imita un
  // entorno real sin esa API legacy, como jsdom mismo) — así el textarea
  // huérfano y el texto de confirmación sin aplicar solo se evitan si el
  // try/catch de verdad está ahí.
  it("fallback: si navigator.clipboard no existe Y execCommand LANZA (entorno sin esa API legacy), el try/catch igual limpia el textarea y aplica la confirmación", () => {
    stubClipboard(undefined);
    const execCommand = vi.fn(() => {
      throw new Error("execCommand no implementado");
    });
    stubExecCommand(execCommand);
    mount(MARKUP);
    document.querySelector<HTMLButtonElement>("[data-ol-copy]")!.click();
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull();
    expect(document.querySelector<HTMLButtonElement>("[data-ol-copy]")!.textContent).toBe("¡Copiado!");
  });

  it("fallback: si navigator.clipboard.writeText rechaza, cae al textarea + execCommand, y lo limpia del DOM", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    stubClipboard(writeText);
    const execCommand = vi.fn();
    stubExecCommand(execCommand);
    mount(MARKUP);
    document.querySelector<HTMLButtonElement>("[data-ol-copy]")!.click();
    await Promise.resolve();
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("se calla en modo edición: no copia ni cambia el texto del botón", () => {
    document.body.setAttribute("data-openlen-edit-mode", "");
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    mount(MARKUP);
    const btn = document.querySelector<HTMLButtonElement>("[data-ol-copy]")!;
    const original = btn.textContent;
    btn.click();
    expect(writeText).not.toHaveBeenCalled();
    expect(btn.textContent).toBe(original);
    document.body.removeAttribute("data-openlen-edit-mode");
  });

  it("declara content-intact: sin runtime el cupón sigue visible y seleccionable", () => {
    expect(copy.degradation).toBe("content-intact");
  });
});
