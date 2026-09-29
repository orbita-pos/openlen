import { describe, expect, it } from "vitest";

import { cambiarTexto } from "./cambiar-texto";

describe("cambiarTexto — como el Edit de Claude Code: dos textos, cero marcado", () => {
  it("cambia el texto y deja el onclick del botón como estaba, byte a byte", () => {
    const boton = `<button class="btn" onclick="agregar(1)">Agregar</button>`;
    const r = cambiarTexto(boton, { modo: "elemento", antes: "Agregar", despues: "Añadir al carrito" });
    expect(r).toEqual({ ok: true, html: `<button class="btn" onclick="agregar(1)">Añadir al carrito</button>` });
  });

  it("en un párrafo con marcas, toca SÓLO el nodo nombrado", () => {
    const p = `<p onclick="x()">Hola &amp; <strong onclick="y()">mundo</strong> y más</p>`;
    const r = cambiarTexto(p, { modo: "nodo", antes: " y más", despues: " y adiós" });
    expect(r).toEqual({ ok: true, html: `<p onclick="x()">Hola &amp; <strong onclick="y()">mundo</strong> y adiós</p>` });
  });

  it("compara el texto que el usuario vio: sin entidades y con los finales de línea del navegador", () => {
    const p = `<p>Pan &amp; café\r\n  del día<em>!</em></p>`;
    const r = cambiarTexto(p, { modo: "nodo", antes: "Pan & café\n  del día", despues: "Pan y café" });
    expect(r).toEqual({ ok: true, html: `<p>Pan y café<em>!</em></p>` });
  });

  it("lo que escribe el usuario va ESCAPADO: un <script> tecleado es texto", () => {
    const r = cambiarTexto(`<h1>Hola</h1>`, {
      modo: "elemento",
      antes: "Hola",
      despues: `<script>alert(1)</script> & <b>`,
    });
    expect(r).toEqual({ ok: true, html: `<h1>&lt;script&gt;alert(1)&lt;/script&gt; &amp; &lt;b&gt;</h1>` });
  });

  it("un salto de línea en modo elemento es un <br>", () => {
    const r = cambiarTexto(`<p>Una línea</p>`, { modo: "elemento", antes: "Una línea", despues: "Una\nDos" });
    expect(r).toEqual({ ok: true, html: `<p>Una<br>Dos</p>` });
  });

  it("si el texto ya no está, FALLA y lo dice — no escribe en otro sitio", () => {
    // El JavaScript de la página había cambiado el texto en pantalla: el
    // guardado dice otra cosa.
    const r = cambiarTexto(`<span id="n">0 productos</span>`, {
      modo: "elemento",
      antes: "3 productos",
      despues: "Tu carrito",
    });
    expect(r).toMatchObject({ ok: false, motivo: "texto_no_encontrado" });
  });

  it("modo elemento sobre un elemento que ya tiene hijos: falla, no los aplasta", () => {
    const r = cambiarTexto(`<p>Hola <b>mundo</b></p>`, { modo: "elemento", antes: "Hola mundo", despues: "x" });
    expect(r).toMatchObject({ ok: false, motivo: "texto_no_encontrado" });
  });

  it("dos nodos iguales sin decir cuál: ambiguo, como old_string no único", () => {
    const p = `<p>Sí<br>Sí</p>`;
    expect(cambiarTexto(p, { modo: "nodo", antes: "Sí", despues: "No" })).toMatchObject({
      ok: false,
      motivo: "texto_ambiguo",
    });
    expect(cambiarTexto(p, { modo: "nodo", antes: "Sí", despues: "No", ocurrencia: 1 })).toEqual({
      ok: true,
      html: `<p>Sí<br>No</p>`,
    });
  });

  it("el texto de un <script> hijo no es texto del usuario", () => {
    const p = `<div>Precio<script>var t="Precio"</script></div>`;
    const r = cambiarTexto(p, { modo: "nodo", antes: "Precio", despues: "Coste" });
    expect(r).toEqual({ ok: true, html: `<div>Coste<script>var t="Precio"</script></div>` });
  });
});
