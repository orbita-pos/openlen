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

  it("fallback: si navigator.clipboard no existe, usa el textarea + execCommand, y lo limpia del DOM", () => {
    stubClipboard(undefined);
    const execCommand = vi.fn();
    stubExecCommand(execCommand);
    mount(MARKUP);
    document.querySelector<HTMLButtonElement>("[data-ol-copy]")!.click();
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull();
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
