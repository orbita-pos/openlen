import { describe, expect, it } from "vitest";

import { avisoHandlersMuertos, esHandler, handlersMuertos } from "./handlers-muertos";

// DOS BRAZOS EN TODO. Que cace el manejador que va a morir (si no, es el
// detector que no existía, que es lo que había) y que CALLE en todo lo demás
// (si no, es el detector que llora al lobo — y un aviso que salta sobre algo
// correcto enseña a ignorar los avisos).

describe("manejadores en línea que el guardado borra", () => {
  it("caza el onclick de un botón", () => {
    const html = '<button id="add" class="btn" onclick="add()">Añadir</button>';
    const r = handlersMuertos(html);
    expect(r).toHaveLength(1);
    expect(r[0].atributo).toBe("onclick");
    // Y dice CUÁL, que es lo que lo hace accionable.
    expect(r[0].donde).toContain("button");
  });

  it("caza varios y con distintos eventos", () => {
    const html =
      '<form onsubmit="go()"><input oninput="calc()"><button onclick="x()">Ir</button></form>';
    expect(handlersMuertos(html).map((h) => h.atributo).sort()).toEqual([
      "onclick",
      "oninput",
      "onsubmit",
    ]);
  });

  it("BRAZO DE CONTROL: no confunde un atributo que empieza por «on»", () => {
    // `on[a-z]+=` genérico casaría con estos, y saltar sobre algo correcto es
    // como muere una guarda.
    expect(handlersMuertos('<div class="one two">x</div>')).toEqual([]);
    expect(handlersMuertos('<div once="true">x</div>')).toEqual([]);
    expect(handlersMuertos('<div data-only="1">x</div>')).toEqual([]);
    expect(handlersMuertos('<x online="si">y</x>')).toEqual([]);
  });

  it("BRAZO DE CONTROL: DENTRO de un <script> no se toca", () => {
    // Ahí `el.onclick = fn` es JavaScript y SOBREVIVE al guardado: sólo se
    // borran los atributos del marcado. Avisar de esto seria mentir.
    const html =
      '<button id="b">Ir</button><script>document.getElementById("b").onclick = function () { go(); };</script>';
    expect(handlersMuertos(html)).toEqual([]);
  });

  it("BRAZO DE CONTROL: dentro de un comentario tampoco", () => {
    expect(handlersMuertos('<!-- <button onclick="viejo()">x</button> --><p>hola</p>')).toEqual([]);
  });

  it("una página bien cableada no dice nada", () => {
    const sana = `<!doctype html><html><body>
      <button id="girar" class="btn">Girar</button>
      <p id="resultado">—</p>
      <script>document.getElementById("girar").addEventListener("click", function () {
        document.getElementById("resultado").textContent = "1";
      });</script>
    </body></html>`;
    expect(handlersMuertos(sana)).toEqual([]);
  });

  it("`esHandler` reconoce el nombre suelto, para la op attrs", () => {
    // El otro camino por el que puede entrar: op="attrs" con name:"onclick".
    expect(esHandler("onclick")).toBe(true);
    expect(esHandler("onSubmit")).toBe(true);
    expect(esHandler(" onchange ")).toBe(true);
    expect(esHandler("once")).toBe(false);
    expect(esHandler("class")).toBe(false);
    expect(esHandler("data-onclick")).toBe(false);
  });

  it("el aviso dice qué se borra, POR QUÉ no se va a enterar, y con qué se arregla", () => {
    const a = avisoHandlersMuertos([{ atributo: "onclick", donde: '<button id="add"' }]);
    expect(a).toContain("onclick");
    // Por qué es invisible: sin error en consola.
    expect(a).toMatch(/consola/i);
    // El camino, que es lo que separa un aviso de una queja.
    expect(a).toMatch(/addEventListener/);
    expect(a).toMatch(/target="runtime"/);
    expect(a).toMatch(/prueba/);
  });
});
