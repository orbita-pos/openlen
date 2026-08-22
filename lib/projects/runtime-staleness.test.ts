import { describe, expect, it } from "vitest";
import { staleRuntimeDetail, staleRuntimeRefs } from "./runtime-staleness";

const DOC = (cuerpo: string) =>
  `<!doctype html><html lang="es"><head><title>t</title></head><body>${cuerpo}</body></html>`;

describe("staleRuntimeRefs", () => {
  /**
   * EL FALLO. `resealRuntime` re-ata el código viejo a cualquier documento
   * nuevo. Si la edición quitó el elemento, `getElementById(...)` LANZA en la
   * página publicada — y la excepción aborta el script ENTERO, así que se lleva
   * por delante todo lo que viniera después.
   */
  it("caza el elemento que la edición quitó", () => {
    const code = `document.getElementById('carrito').addEventListener('click', f);`;
    expect(staleRuntimeRefs(code, DOC("<h1>hola</h1>"))).toEqual(["carrito"]);
  });

  it("calla cuando el elemento sigue ahí", () => {
    const code = `document.getElementById('carrito').addEventListener('click', f);`;
    expect(staleRuntimeRefs(code, DOC(`<div id="carrito"></div>`))).toEqual([]);
  });

  it("también lee querySelector('#id')", () => {
    const code = `const n = document.querySelector('#total'); document.querySelectorAll('#fila');`;
    expect(staleRuntimeRefs(code, DOC("<p>x</p>"))).toEqual(["fila", "total"]);
  });

  // Falla hacia CALLAR: una alarma falsa sobre la página de alguien vale menos
  // que nada. El script que se fabrica su propio elemento no está roto.
  it("no acusa a un elemento que el propio script crea", () => {
    const conProp = `const d = document.createElement('div'); d.id = 'aviso'; document.body.appendChild(d); document.getElementById('aviso').textContent = 'ok';`;
    expect(staleRuntimeRefs(conProp, DOC("<p>x</p>"))).toEqual([]);

    const conSetAttr = `el.setAttribute('id', 'panel'); document.getElementById('panel');`;
    expect(staleRuntimeRefs(conSetAttr, DOC("<p>x</p>"))).toEqual([]);

    const conPlantilla = `host.innerHTML = '<div id="lista"></div>'; document.getElementById('lista');`;
    expect(staleRuntimeRefs(conPlantilla, DOC("<p>x</p>"))).toEqual([]);
  });

  it("sin código o sin búsquedas por id no dice nada", () => {
    expect(staleRuntimeRefs("", DOC("<p>x</p>"))).toEqual([]);
    expect(staleRuntimeRefs("console.log(1);", DOC("<p>x</p>"))).toEqual([]);
    // Selectores por clase quedan fuera a propósito: `querySelector('.x')`
    // devuelve null igual, pero una clase ausente es MUCHO más común de forma
    // legítima (estado, variantes) y acusaría en falso.
    expect(staleRuntimeRefs(`document.querySelector('.oculto');`, DOC("<p>x</p>"))).toEqual([]);
  });

  // Los regex son constantes con /g compartidas entre llamadas: sin reiniciar
  // `lastIndex` la segunda invocación empieza a mitad de la cadena y se salta
  // aciertos. Silencioso y dependiente del orden.
  it("da el mismo resultado llamándolo dos veces", () => {
    const code = `document.getElementById('a'); document.getElementById('b');`;
    const una = staleRuntimeRefs(code, DOC("<p>x</p>"));
    const dos = staleRuntimeRefs(code, DOC("<p>x</p>"));
    expect(una).toEqual(["a", "b"]);
    expect(dos).toEqual(una);
  });

  it("un html ilegible no acusa a nadie", () => {
    expect(staleRuntimeRefs(`document.getElementById('x');`, "")).toEqual([]);
  });
});

describe("staleRuntimeDetail", () => {
  it("dice que el script se DETIENE, no que falte un botón", () => {
    // Es la diferencia entre "un control no responde" y "la interactividad de
    // la página se apagó entera", que es lo que de verdad pasa.
    const d = staleRuntimeDetail(["carrito"]);
    expect(d[0]).toMatch(/detiene el script entero/);
    expect(d[0]).toContain("carrito");
  });

  it("se acota a tres — es texto de máquina en la fila, no un registro", () => {
    const d = staleRuntimeDetail(["a", "b", "c", "d", "e"]);
    expect(d[0]).toContain("y 2 más");
    expect(d[0]).not.toContain("e,");
  });
});
