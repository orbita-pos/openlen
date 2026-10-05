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

import { lanzarChromium } from "@/lib/ai/visual-quality-renderer";

import { PRELUDIO_DE_USO, usarPagina, type PasoDeUso } from "./usar-pagina";

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
    expect(rota).toContain("I moved the slider «Metros» to «3»");
    expect(rota).toMatch(/nothing (else )?changed/);
    expect(rota).toContain("it reads: «Total: $ 76.000");
    expect(bien).toContain("«Total: $ 76.000» → «Total: $ 114.000»");
    expect(bien).not.toMatch(/nothing (else )?changed/);
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
    expect(muerto).toContain("there is nothing behind it");
    expect(vivo).toContain("«Sin aplicar» → «Aplicado»");
    expect(vivo).not.toContain("there is nothing behind it");
  }, 90_000);

  it("🔴 NO acusa en falso: si alguien escucha pero no pinta nada, dice que no cambió, sin la nota", async () => {
    const informe = await visitar(boton("calla"), [{ pulsa: "Aplicar" }]);
    expect(informe).toContain("nothing changed");
    expect(informe).not.toContain("there is nothing behind it");
  }, 90_000);

  it("la delegación también cuenta: el oyente en document escucha al botón", async () => {
    const html = marco(`
      <p id="msg">0</p><button class="sumar">Sumar</button>
      <script>document.addEventListener("click", function (e) { if (e.target.closest(".sumar")) console.log("x"); });</script>`);
    const informe = await visitar(html, [{ pulsa: "Sumar" }]);
    expect(informe).not.toContain("there is nothing behind it");
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
    expect(muerto).toContain("also changes by itself");
    expect(muerto).toContain("there is nothing behind it");
    expect(vivo).toContain("«Cerrado» → «Abierto»");
    const lineaDelClic = vivo.split("\n").find((l) => l.includes("«Cerrado» → «Abierto»")) ?? "";
    expect(lineaDelClic).not.toContain("changes by itself");
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
    expect(normal).toContain("sent the form with: nombre=«Ana»");
    expect(normal).toContain("forms aren't sent");
    expect(normal).not.toContain("CANCELED");
    expect(cancelado).toContain("CANCELED the form submission");
  }, 90_000);

  it("un enlace a WhatsApp no se abre y dice a dónde iba; la visita sigue", async () => {
    const html = marco(`
      <a href="https://wa.me/5215512345678?text=Hola%20quiero%20pedir">Pedir por WhatsApp</a>
      <p id="p">Uno</p><button id="b">Siguiente</button>
      <script>document.getElementById("b").addEventListener("click", function () { document.getElementById("p").textContent = "Dos"; });</script>`);
    const informe = await visitar(html, [{ pulsa: "Pedir por WhatsApp" }, { pulsa: "Siguiente" }]);
    expect(informe).toContain("it was sending to «https://wa.me/5215512345678?text=Hola quiero pedir» (not opened)");
    expect(informe).toContain("«Uno» → «Dos»");
  }, 90_000);

  it("un `location.href` del script a WhatsApp tampoco sale, y se dice", async () => {
    const html = marco(`
      <button id="b">Pedir</button>
      <script>document.getElementById("b").addEventListener("click", function () { location.href = "https://wa.me/5215500000000?text=pedido"; });</script>`);
    const informe = await visitar(html, [{ pulsa: "Pedir" }]);
    expect(informe).toContain("it was sending to «https://wa.me/5215500000000?text=pedido» (not opened)");
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
    expect(guarda).toContain("saved in the browser «n» = «1»");
    expect(guarda).toContain("after reloading, the page looks the same");
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
    expect(ambiguo).toContain("there are 2 controls that say «Agregar»");
    expect(ambiguo).toContain("Step 2 wasn't done");
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
    expect(conOtros).toContain("it was sending to «https://wa.me/5215511111111»");
    expect(conOtros).toContain("other controls also say «WhatsApp» and I didn't press them: «Agenda por WhatsApp →»");
    expect(solo).not.toContain("other controls");
    const roto = await visitar(html, [{ pulsa: "Agenda por WhatsApp →" }]);
    expect(roto).toContain("it is a link to «#visitanos»");
  }, 90_000);

  it("uno que no existe se dice con lo que sí hay", async () => {
    const informe = await visitar(tienda, [{ pulsa: "Comprar ahora" }]);
    expect(informe).toContain("there is no visible control that says «Comprar ahora»");
    expect(informe).toContain("«Agregar»");
  }, 90_000);
});

describe("usar_pagina — la página con scroll suave", () => {
  // 🔴 El turno de producción del 2026-09-28: la página traía
  // `html{scroll-behavior:smooth}`, así que llevar el control a la vista era un
  // desplazamiento ANIMADO. El mousedown caía en el enlace y el mouseup, 20 ms
  // después, ya en otra cosa: el `click` iba a la sección y el informe decía
  // «no cambió nada» sobre un script que funcionaba. En la portada, 21 de 25
  // clics volvieron así, y el modelo persiguió el fantasma 11 minutos.
  //
  // Medido en esa página: el desplazamiento suave dura ~900 ms; `quieta()` mira
  // el TEXTO, que no cambia al desplazarse, y la da por quieta a los ~400 ms.
  // Puppeteer salta entonces al control sin cancelar la animación, que sigue
  // 50 px hasta SU destino durante el clic. Reproducirlo de punta a punta
  // depende de esos tiempos (en una página sencilla los dos destinos coinciden
  // y el clic entra); lo que se sujeta aquí es la causa: tras acercar el
  // control, la página ya no se mueve.
  const pagina = (suave: boolean) =>
    marco(`
    ${suave ? "<style>html{scroll-behavior:smooth}</style>" : ""}
    <div style="height:3000px">Arriba</div>
    <a href="#reportes">Reportar</a>
    <div style="height:3000px" id="reportes">Abajo</div>`);

  const desplazamientoTrasAcercar = async (html: string) => {
    const browser = await lanzarChromium();
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 900 });
      // `setContent` no navega, así que el preludio no se instalaría con
      // `evaluateOnNewDocument`: se pone tras cargar (aquí no hay oyentes que cazar).
      await page.setContent(html, { waitUntil: "load" });
      await page.evaluate(PRELUDIO_DE_USO);
      await page.evaluate(`window.__olUsar.control("Reportar", "")`);
      await page.evaluate(`window.__olUsar.antesDeActuar()`);
      const justo = (await page.evaluate("scrollY")) as number;
      await new Promise((r) => setTimeout(r, 300));
      return { justo, luego: (await page.evaluate("scrollY")) as number };
    } finally {
      await browser.close();
    }
  };

  it("🔴 tras llevar el control a la vista, la página ya no se mueve (con scroll suave también)", async () => {
    const control = await desplazamientoTrasAcercar(pagina(false));
    const suave = await desplazamientoTrasAcercar(pagina(true));
    expect(control.justo).toBeGreaterThan(2000);
    expect(control.luego).toBe(control.justo);
    expect(suave.justo).toBe(control.justo);
    expect(suave.luego).toBe(suave.justo);
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
    expect(vivo).toContain("I chose «Nogal» in the dropdown «Acabado");
    expect(vivo).toContain("«$ 100» → «$ 150»");
    expect(vivo).toContain("«$ 150» → «$ 300»");
    expect(muerto).not.toContain("«$ 100» → «$ 150»");
  }, 90_000);
});

// ⚰️ «usar_pagina — un almacén de la página va al sustituto, no a la base»: lo
// que la visita guardaba en `/api/d` iba a un sustituto que se tiraba al final.
// Se retiró con `data-ol-stores` el 2026-10-04.

// Entrar como un usuario de la página, como Lovable: la sesión de supabase-js
// va en SU clave del `localStorage` antes de que corra la página. La sesión es
// de mentira aquí (no hay backend): lo que se prueba es la visita, no GoTrue
// (eso está en lib/backend/auth/visit-session.test.ts).
describe("usar_pagina — entrar como un usuario de la página", () => {
  const STORAGE_KEY = "sb-abcdefghijklmnopqrst-auth-token";
  const signedInAs = {
    email: "ana@tiendaluna.mx",
    storageKey: STORAGE_KEY,
    session: { access_token: "x.y.z", token_type: "bearer", expires_in: 3600, expires_at: 9999999999, refresh_token: "r", user: { id: "u1", email: "ana@tiendaluna.mx" } },
  };
  const pageHtml = marco(`
    <div><p id="quien"></p><button id="salir">Salir</button></div>
    <script>
      function pintar() {
        var s = localStorage.getItem("${STORAGE_KEY}");
        document.getElementById("quien").textContent = s ? "Hola, " + JSON.parse(s).user.email : "Sin sesión";
      }
      pintar();
      document.getElementById("salir").addEventListener("click", function () { localStorage.removeItem("${STORAGE_KEY}"); pintar(); });
    </script>`);

  it("🔴 la sesión ya está guardada cuando corre la página, y el informe lo dice; sin ella, nadie", async () => {
    const pasos: PasoDeUso[] = [{ lee: "Salir" }];
    const signedIn = (await usarPagina({ html: pageHtml, pasos, ruta: "/index.html", signedInAs })).informe;
    const anonymous = await visitar(pageHtml, pasos);
    expect(signedIn).toContain("Hola, ana@tiendaluna.mx");
    expect(signedIn).toContain("signed in as ana@tiendaluna.mx");
    expect(anonymous).toContain("Sin sesión");
    expect(anonymous).not.toContain("signed in as");
  }, 90_000);

  it("🔴 si la página cierra la sesión, recargar no la vuelve a abrir", async () => {
    const pasos: PasoDeUso[] = [{ pulsa: "Salir" }, { recarga: true }, { lee: "Salir" }];
    const report = (await usarPagina({ html: pageHtml, pasos, ruta: "/index.html", signedInAs })).informe;
    // Había sesión antes de pulsar «Salir»: si no, el resto no prueba nada.
    expect(report).toContain("«Hola, ana@tiendaluna.mx» → «Sin sesión»");
    const lastStep = report.split("\n").find((l) => l.startsWith("3."));
    expect(lastStep).toContain("Sin sesión");
    expect(lastStep).not.toContain("Hola, ana");
  }, 90_000);
});

// LA CARPETA (pieza 9 de Len 2.5): el JavaScript que vive en `/js/app.js` llega
// a la visita como llegaría a la publicada. Sin la carpeta, el mismo botón no
// tiene a nadie detrás: es lo que Len vería, y diría, si no viajara.
describe("usar_pagina — la carpeta del proyecto", () => {
  const pagina = marco(`
    <p id="msg">Sin aplicar</p>
    <button id="aplicar">Aplicar</button>
    <script src="/js/app.js"></script>`);
  const APP = 'document.getElementById("aplicar").addEventListener("click", function () { document.getElementById("msg").textContent = "Aplicado"; });';
  const vista = (files?: Record<string, string>) => ({
    projectId: "p-carpeta",
    title: null,
    sub: null,
    pagina: null,
    settings: undefined,
    logoUrl: null,
    ...(files ? { files } : {}),
  });

  it("🔴 el script de /js/app.js llega y el botón pinta; BRAZO DE CONTROL: sin la carpeta, nadie lo escucha", async () => {
    const pasos: PasoDeUso[] = [{ pulsa: "Aplicar" }];
    const con = (await usarPagina({ html: pagina, pasos, ruta: "/index.html", vista: vista({ "/js/app.js": APP }) })).informe;
    const sin = (await usarPagina({ html: pagina, pasos, ruta: "/index.html", vista: vista() })).informe;
    expect(con).toContain("«Sin aplicar» → «Aplicado»");
    expect(sin).toContain("there is nothing behind it");
  }, 90_000);
});
