// USAR LA PÁGINA (H9) — con un navegador de verdad.
//
// Cada prueba lleva su BRAZO DE CONTROL dentro: la misma página con el fallo
// arreglado (o al revés) y la exigencia de que el informe diga cosas distintas.
// Sin eso, que el informe traiga una frase no demuestra que la frase dependa de
// la página. Es la lección de la prueba declarada, que pasaba en verde sobre un
// botón muerto porque algo se animaba solo.
//
// Lo que estas pruebas sujetan es que la herramienta dice HECHOS y no acusa en
// falso: un botón que alguien escucha no sale «sin nada detrás» aunque no pinte
// nada, y lo que cambia solo se marca como tal.
import { describe, expect, it } from "vitest";

import { usarPagina, type PasoDeUso } from "./usar-pagina";

const marco = (cuerpo: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>Prueba</title>
<style>body{font-family:Arial,sans-serif;margin:24px}button,a,input{font-size:18px;margin:8px;padding:6px}</style>
</head><body>${cuerpo}</body></html>`;

const visitar = async (html: string, pasos: PasoDeUso[]) => (await usarPagina({ html, pasos, ruta: "/index.html" })).informe;

// La calculadora del 25/09: se ve bien y la barra no mueve el precio.
const calculadora = (arreglada: boolean) =>
  marco(`
  <label>Metros <input type="range" id="metros" min="1" max="10" value="2"></label>
  <p>Total: <span id="total">$ 76.000</span></p>
  <script>
    var barra = document.getElementById("metros");
    barra.addEventListener("input", function () {
      ${arreglada ? 'document.getElementById("total").textContent = "$ " + (Number(barra.value) * 38000).toLocaleString("es-CL");' : "var m = 2; /* lee lo que no es */"}
    });
  </script>`);

describe("usar_pagina — la barra que no mueve el precio", () => {
  it("🔴 con el fallo dice que no cambió nada; arreglada, dice el precio nuevo", async () => {
    const pasos: PasoDeUso[] = [{ escribe: "3", en: "Metros" }, { lee: "Total" }];
    const rota = await visitar(calculadora(false), pasos);
    const bien = await visitar(calculadora(true), pasos);
    expect(rota).toContain("moví la barra «Metros» a «3»");
    expect(rota).toContain("no cambió nada");
    expect(rota).toContain("se lee: «Total: $ 76.000");
    expect(bien).toContain("«Total: $ 76.000» → «Total: $ 114.000»");
    expect(bien).not.toContain("no cambió nada");
  }, 90_000);
});

describe("usar_pagina — el clic que nadie escucha", () => {
  const boton = (conOyente: "nada" | "pinta" | "calla") =>
    marco(`
    <p id="msg">Sin aplicar</p>
    <button id="aplicar">Aplicar</button>
    <script>
      ${conOyente === "pinta" ? 'document.getElementById("aplicar").addEventListener("click", function () { document.getElementById("msg").textContent = "Aplicado"; });' : ""}
      ${conOyente === "calla" ? 'document.getElementById("aplicar").addEventListener("click", function () { console.log("pulsado"); });' : ""}
    </script>`);

  it("🔴 sin oyente lo dice; con oyente que pinta, dice el cambio y no la nota", async () => {
    const muerto = await visitar(boton("nada"), [{ pulsa: "Aplicar" }]);
    const vivo = await visitar(boton("pinta"), [{ pulsa: "Aplicar" }]);
    expect(muerto).toContain("no tiene nada detrás");
    expect(vivo).toContain("«Sin aplicar» → «Aplicado»");
    expect(vivo).not.toContain("no tiene nada detrás");
  }, 90_000);

  it("🔴 NO acusa en falso: si alguien escucha pero no pinta nada, dice que no cambió, sin la nota", async () => {
    const informe = await visitar(boton("calla"), [{ pulsa: "Aplicar" }]);
    expect(informe).toContain("no cambió nada");
    expect(informe).not.toContain("no tiene nada detrás");
  }, 90_000);

  it("la delegación también cuenta: el oyente en document escucha al botón", async () => {
    const html = marco(`
      <p id="msg">0</p><button class="sumar">Sumar</button>
      <script>document.addEventListener("click", function (e) { if (e.target.closest(".sumar")) console.log("x"); });</script>`);
    const informe = await visitar(html, [{ pulsa: "Sumar" }]);
    expect(informe).not.toContain("no tiene nada detrás");
  }, 90_000);
});

describe("usar_pagina — lo que cambia solo", () => {
  const contador = (botonVivo: boolean) =>
    marco(`
    <p>Visitas hoy: <span id="n">100</span></p>
    <p id="estado">Cerrado</p>
    <button id="abrir">Abrir</button>
    <script>
      setInterval(function () { var n = document.getElementById("n"); n.textContent = String(Number(n.textContent) + 1); }, 250);
      ${botonVivo ? 'document.getElementById("abrir").addEventListener("click", function () { document.getElementById("estado").textContent = "Abierto"; });' : ""}
    </script>`);

  it("🔴 el contador que se mueve solo sale marcado; lo que movió el clic, no", async () => {
    const muerto = await visitar(contador(false), [{ pulsa: "Abrir" }]);
    const vivo = await visitar(contador(true), [{ pulsa: "Abrir" }]);
    expect(muerto).toContain("también cambia solo");
    expect(muerto).toContain("no tiene nada detrás");
    expect(vivo).toContain("«Cerrado» → «Abierto»");
    const lineaDelClic = vivo.split("\n").find((l) => l.includes("«Cerrado» → «Abierto»")) ?? "";
    expect(lineaDelClic).not.toContain("cambia solo");
  }, 90_000);
});

describe("usar_pagina — nada sale de la visita", () => {
  it("🔴 un formulario normal dice qué habría mandado; si el script cancela el envío, lo dice", async () => {
    const form = (cancela: boolean) =>
      marco(`
      <form id="f"><label>Nombre <input name="nombre"></label><button type="submit">Enviar</button></form>
      ${cancela ? '<script>document.getElementById("f").addEventListener("submit", function (e) { e.preventDefault(); });</script>' : ""}`);
    const pasos: PasoDeUso[] = [{ escribe: "Ana", en: "Nombre" }, { pulsa: "Enviar" }];
    const normal = await visitar(form(false), pasos);
    const cancelado = await visitar(form(true), pasos);
    expect(normal).toContain("envió el formulario con: nombre=«Ana»");
    expect(normal).toContain("no se mandan");
    expect(normal).not.toContain("CANCELÓ");
    expect(cancelado).toContain("CANCELÓ el envío");
  }, 90_000);

  it("un enlace a WhatsApp no se abre y dice a dónde iba; la visita sigue", async () => {
    const html = marco(`
      <a href="https://wa.me/5215512345678?text=Hola%20quiero%20pedir">Pedir por WhatsApp</a>
      <p id="p">Uno</p><button id="b">Siguiente</button>
      <script>document.getElementById("b").addEventListener("click", function () { document.getElementById("p").textContent = "Dos"; });</script>`);
    const informe = await visitar(html, [{ pulsa: "Pedir por WhatsApp" }, { pulsa: "Siguiente" }]);
    expect(informe).toContain("mandaba a «https://wa.me/5215512345678?text=Hola quiero pedir» (no se abrió)");
    expect(informe).toContain("«Uno» → «Dos»");
  }, 90_000);

  it("un `location.href` del script a WhatsApp tampoco sale, y se dice", async () => {
    const html = marco(`
      <button id="b">Pedir</button>
      <script>document.getElementById("b").addEventListener("click", function () { location.href = "https://wa.me/5215500000000?text=pedido"; });</script>`);
    const informe = await visitar(html, [{ pulsa: "Pedir" }]);
    expect(informe).toContain("mandaba a «https://wa.me/5215500000000?text=pedido» (no se abrió)");
  }, 90_000);
});

describe("usar_pagina — lo que se recuerda al volver", () => {
  const carrito = (guarda: boolean) =>
    marco(`
    <p id="c">Carrito vacío</p><button id="a">Agregar</button>
    <script>
      var n = ${guarda ? 'Number(localStorage.getItem("n") || 0)' : "0"};
      function pintar() { document.getElementById("c").textContent = n ? n + " en el carrito" : "Carrito vacío"; }
      pintar();
      document.getElementById("a").addEventListener("click", function () { n++; ${guarda ? 'localStorage.setItem("n", String(n));' : ""} pintar(); });
    </script>`);

  it("🔴 si guarda, tras recargar se ve igual; si no, lo dice", async () => {
    const pasos: PasoDeUso[] = [{ pulsa: "Agregar" }, { recarga: true }];
    const guarda = await visitar(carrito(true), pasos);
    const olvida = await visitar(carrito(false), pasos);
    expect(guarda).toContain("guardó en el navegador «n» = «1»");
    expect(guarda).toContain("tras recargar, la página se ve igual");
    expect(olvida).toContain("«1 en el carrito» → «Carrito vacío»");
  }, 90_000);
});

describe("usar_pagina — un control que no es único o no existe no se pulsa al azar", () => {
  const tienda = marco(`
    <div class="card"><h3>Jabón de romero</h3><button class="add" data-p="romero">Agregar</button></div>
    <div class="card"><h3>Vela de cera</h3><button class="add" data-p="vela">Agregar</button></div>
    <p id="t">Nada</p>
    <script>document.querySelectorAll(".add").forEach(function (b) { b.addEventListener("click", function () { document.getElementById("t").textContent = "Pediste " + b.dataset.p; }); });</script>`);

  it("🔴 dos «Agregar» se nombran y no se pulsa ninguno; con dentro_de, el suyo", async () => {
    const ambiguo = await visitar(tienda, [{ pulsa: "Agregar" }, { lee: "Pediste" }]);
    const elegido = await visitar(tienda, [{ pulsa: "Agregar", dentro_de: "Vela de cera" }]);
    expect(ambiguo).toContain("hay 2 controles que dicen «Agregar»");
    expect(ambiguo).toContain("El paso 2 no se hizo");
    expect(elegido).toContain("«Nada» → «Pediste vela»");
  }, 90_000);

  it("🔴 si uno lo dice exacto y otros lo contienen, pulsa el exacto y NOMBRA los otros", async () => {
    // precios-y-whatsapp #3 de E: el «WhatsApp» del menú iba bien y el roto era
    // «Agenda por WhatsApp →». Callar los otros escondía justo el roto.
    const html = marco(`
      <a href="https://wa.me/5215511111111">WhatsApp</a>
      <a href="#visitanos">Agenda por WhatsApp →</a>
      <section id="visitanos"><p>Visítanos</p></section>`);
    const conOtros = await visitar(html, [{ pulsa: "WhatsApp" }]);
    const solo = await visitar(marco(`<a href="https://wa.me/5215511111111">WhatsApp</a>`), [{ pulsa: "WhatsApp" }]);
    expect(conOtros).toContain("mandaba a «https://wa.me/5215511111111»");
    expect(conOtros).toContain("otros controles también dicen «WhatsApp» y no los pulsé: «Agenda por WhatsApp →»");
    expect(solo).not.toContain("otros controles");
    const roto = await visitar(html, [{ pulsa: "Agenda por WhatsApp →" }]);
    expect(roto).toContain("es un enlace a «#visitanos»");
  }, 90_000);

  it("uno que no existe se dice con lo que sí hay", async () => {
    const informe = await visitar(tienda, [{ pulsa: "Comprar ahora" }]);
    expect(informe).toContain("no hay ningún control visible que diga «Comprar ahora»");
    expect(informe).toContain("«Agregar»");
  }, 90_000);
});

describe("usar_pagina — elegir", () => {
  it("🔴 una opción de desplegable y un radio con etiqueta mueven el precio; sin oyente, no", async () => {
    const pagina = (conOyente: boolean) =>
      marco(`
      <label>Acabado <select id="s"><option>Natural</option><option>Nogal</option></select></label>
      <label><input type="radio" name="t" value="1" checked> Chico</label>
      <label><input type="radio" name="t" value="2"> Grande</label>
      <p id="precio">$ 100</p>
      <script>
        function calc() { var base = document.getElementById("s").value === "Nogal" ? 150 : 100; var t = Number(document.querySelector("input[name=t]:checked").value); document.getElementById("precio").textContent = "$ " + base * t; }
        ${conOyente ? 'document.getElementById("s").addEventListener("change", calc); document.querySelectorAll("input[name=t]").forEach(function (r) { r.addEventListener("change", calc); });' : ""}
      </script>`);
    const pasos: PasoDeUso[] = [{ elige: "Nogal" }, { elige: "Grande" }];
    const vivo = await visitar(pagina(true), pasos);
    const muerto = await visitar(pagina(false), pasos);
    expect(vivo).toContain("elegí «Nogal» en el desplegable «Acabado");
    expect(vivo).toContain("«$ 100» → «$ 150»");
    expect(vivo).toContain("«$ 150» → «$ 300»");
    expect(muerto).not.toContain("«$ 100» → «$ 150»");
  }, 90_000);
});

describe("usar_pagina — un almacén de la página va al sustituto, no a la base", () => {
  it("dice la llamada y que la copia se tira", async () => {
    const html = marco(`
      <script type="application/json" data-ol-stores>{"notas":{"visitante":"propio","campos":{"texto":"texto"}}}</script>
      <p id="r">Sin guardar</p><button id="g">Guardar</button>
      <script>
        document.getElementById("g").addEventListener("click", function () {
          fetch("/api/d/notas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ texto: "hola" }) })
            .then(function (r) { document.getElementById("r").textContent = r.ok ? "Guardado" : "Error " + r.status; });
        });
      </script>`);
    const informe = await visitar(html, [{ pulsa: "Guardar" }]);
    expect(informe).toContain("POST /api/d/notas");
    expect(informe).toContain("«Sin guardar» → «Guardado»");
    expect(informe).toContain("se tira al terminar");
  }, 90_000);
});
