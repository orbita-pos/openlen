// lib/len-bench/graders.browser.test.ts — los graders que abren Chromium.
// @vitest-environment node
//
// El «Next» de aquí sólo GUARDA lo que el navegador le mandó, sin filtrar
// nada: no imita la ruta /api/f/, así que lo que se comprueba es qué hizo el
// grader con el formulario, no un simulacro de lo que la ruta haría.
import http from "node:http";
import type { Browser } from "puppeteer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { datosDeLaFicha, enlacesInternosVan, flujo, formularioLlega, sigueAhi, sinDesbordeMovil, textoSeLee } from "./graders";
import { OPENLEN_STATIC_HOSTS } from "@/lib/publish/base-host";
import { cerrarPestana, lanzarNavegador, REGLAS_SIN_PRODUCCION } from "./navegador";
import { calificarCon, INICIO_TAQUERIA, SOLUCION_TAQUERIA } from "./publicada-de-prueba";
import { cargarEncargos } from "./casos/cargar";
import type { Encargo, Grader } from "./tipos";
import type { ProjectData } from "@/lib/projects/types";

let navegador: Browser;
let next: http.Server;
let nextUrl = "";
const recibidos: Record<string, string>[] = [];
/** El «Next» contesta 429, como el limitador de /api/f/ (20 envíos/hora/IP). */
let limitado = false;

beforeAll(async () => {
  // El MISMO navegador con el que califica Len-Bench.
  navegador = await lanzarNavegador();
  next = http.createServer((req, res) => {
    const trozos: Buffer[] = [];
    req.on("data", (t: Buffer) => trozos.push(t));
    req.on("end", () => {
      if (limitado) {
        res.writeHead(429, { "content-type": "text/html; charset=utf-8" }).end("<p>demasiados envíos</p>");
        return;
      }
      void (async () => {
        const cuerpo = new Response(Buffer.concat(trozos), {
          headers: { "content-type": String(req.headers["content-type"] ?? "") },
        });
        const fila: Record<string, string> = {};
        for (const [k, v] of (await cuerpo.formData()).entries()) fila[k] = String(v);
        recibidos.push(fila);
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end("<p>gracias</p>");
      })().catch(() => res.writeHead(400).end());
    });
  });
  await new Promise<void>((r) => next.listen(0, "127.0.0.1", r));
  nextUrl = `http://127.0.0.1:${(next.address() as { port: number }).port}`;
}, 60_000);

afterAll(async () => {
  await navegador?.close();
  await new Promise<void>((r) => next.close(() => r()));
});

// El campo trampa, tal cual lo inyecta la publicación
// (crates/html-engine/src/publish/forms.rs, HONEYPOT). Un humano no lo ve.
const TRAMPA =
  '<input type="text" name="_openlen_hp" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0">';

// Como en producción: la página envía a OTRO origen, el ápice (aquí, el «Next»
// de la prueba), no a su propio host. Lo hornea `submitBase()` al publicar.
const formulario = (next: string) => `<section id="contacto"><form action="${next}/api/f/demo" method="post">
  <input name="nombre" required>
  <input type="email" name="correo" required>
  <textarea name="mensaje"></textarea>
  ${TRAMPA}
  <button>Enviar</button>
</form></section>`;

describe("el navegador de Len-Bench", () => {
  it("no puede ni resolver producción: ni la app ni una página publicada de verdad", async () => {
    // Una página que enviara a producción —un `action` mal horneado, el
    // widget, el JavaScript del modelo— se queda en el navegador.
    // Puerto 81: si la regla se rompiera, la prueba fallaría igual (no hay nada
    // escuchando) SIN haber mandado una petición a producción.
    const page = await navegador.newPage();
    try {
      await expect(page.goto("https://openlen.com:81/api/f/x")).rejects.toThrow(/ERR_NAME_NOT_RESOLVED/);
      await expect(page.goto("https://alguien.openlen.app:81/")).rejects.toThrow(/ERR_NAME_NOT_RESOLVED/);
    } finally {
      // Tras una navegación fallida, `page.close()` a secas no vuelve nunca.
      await cerrarPestana(page);
    }
  }, 30_000);
  it("pero SÍ resuelve lo que el visitante carga de verdad: los hosts estáticos de imágenes", async () => {
    for (const h of OPENLEN_STATIC_HOSTS) expect(REGLAS_SIN_PRODUCCION).toContain(`EXCLUDE ${h}`);
    const page = await navegador.newPage();
    try {
      // Resuelve: el error ya no es de DNS. El puerto 81 no contesta, así que
      // tampoco aquí sale ninguna petición.
      const error = await page.goto("https://images.openlen.com:81/x", { timeout: 5_000 }).then(
        () => "",
        (e: Error) => e.message,
      );
      expect(error).not.toMatch(/ERR_NAME_NOT_RESOLVED/);
      await expect(page.goto("https://len.openlen.com:81/")).rejects.toThrow(/ERR_NAME_NOT_RESOLVED/);
    } finally {
      await cerrarPestana(page);
    }
  }, 30_000);
});

describe("sin-desborde-movil", () => {
  it("verde con la solución, rojo si algo pasa de 390 px", async () => {
    expect((await calificarCon(sinDesbordeMovil(), { html: SOLUCION_TAQUERIA }, { navegador })).paso).toBe(true);
    const html = SOLUCION_TAQUERIA.replace("</footer>", '<div style="width:900px">x</div></footer>');
    const r = await calificarCon(sinDesbordeMovil(), { html }, { navegador });
    expect(r.paso).toBe(false);
    expect(r.explicacion).toMatch(/\/ \(\d+px\)/);
  }, 60_000);
});

describe("texto-se-lee — el contraste medido en el píxel, como los ojos de Len", () => {
  // La «foto» es un fondo claro: el píxel no distingue una foto de un color.
  const portada = (velo: string) =>
    SOLUCION_TAQUERIA.replace(
      "<footer>",
      `<section style="position:relative;background:#f4efe4;padding:80px 20px"><div style="position:absolute;inset:0;background:${velo}"></div><h1 style="position:relative;color:#ffffff;font-size:40px">Olas todo el año</h1></section>\n<footer>`,
    );
  const g = () => textoSeLee("titulo-se-lee", "/", /olas todo el a[ñn]o/i);
  it("rojo si el título blanco se pierde sobre la foto clara, y dice el contraste", async () => {
    const r = await calificarCon(g(), { html: portada("transparent") }, { navegador });
    expect(r.paso).toBe(false);
    expect(r.explicacion).toMatch(/Olas todo el año.*\d[.,]\d+:1/);
  }, 60_000);
  it("verde con un velo oscuro encima de la foto", async () => {
    const r = await calificarCon(g(), { html: portada("rgba(0,0,0,.6)") }, { navegador });
    expect(r.paso, r.explicacion).toBe(true);
  }, 60_000);
  it("rojo si el título ya no está (quitarlo no es arreglarlo)", async () => {
    const r = await calificarCon(g(), { html: SOLUCION_TAQUERIA }, { navegador });
    expect(r.paso).toBe(false);
    expect(r.explicacion).toMatch(/no está/);
  }, 60_000);
});

describe("formulario-llega", () => {
  it("rellena lo que ve un humano, NO el campo trampa, envía y el envío llega", async () => {
    recibidos.length = 0;
    const html = SOLUCION_TAQUERIA.replace("<footer>", `${formulario(nextUrl)}\n<footer>`);
    const r = await calificarCon(formularioLlega(), { html }, { navegador, next: nextUrl, leerEnvios: async () => recibidos });
    expect(r.paso, r.explicacion).toBe(true);
    expect(recibidos).toHaveLength(1);
    expect(recibidos[0].nombre).toBe("Prueba Len-Bench");
    expect(recibidos[0].correo).toBe("len-bench@example.com");
    // Lleno, la ruta de verdad finge éxito y NO guarda nada (app/api/f/[sub]/route.ts):
    // cada formulario de Len saldría como «no llegó».
    expect(recibidos[0]._openlen_hp).toBe("");
  }, 60_000);
  it("si /api/f/ contesta 429 (el limitador), REVIENTA diciéndolo: no es un formulario de Len que no llega", async () => {
    const html = SOLUCION_TAQUERIA.replace("<footer>", `${formulario(nextUrl)}\n<footer>`);
    limitado = true;
    try {
      await expect(calificarCon(formularioLlega(), { html }, { navegador, next: nextUrl, leerEnvios: async () => recibidos })).rejects.toThrow(/429/);
    } finally {
      limitado = false;
    }
  }, 60_000);
  // 🔴 reservas-sin-motor #2 (control del 26/09): todas las fechas salían
  // 2026-12-01, la salida quedaba igual a la llegada y el `min` que pone el JS
  // de Len (llegada + 1) bloqueaba el envío de una página que está bien.
  it("🔴 llegada y salida: la salida va DESPUÉS de la llegada, y la reserva llega", async () => {
    recibidos.length = 0;
    const reserva = `<section id="reservar"><form action="${nextUrl}/api/f/demo" method="post">
  <input name="nombre" required>
  <input type="date" name="llegada" id="llegada" required>
  <input type="date" name="salida" id="salida" required>
  ${TRAMPA}
  <button>Reservar</button>
</form></section>
<script>
  document.getElementById("llegada").addEventListener("change", function (e) {
    var d = new Date(e.target.value); d.setDate(d.getDate() + 1);
    document.getElementById("salida").min = d.toISOString().slice(0, 10);
  });
</script>`;
    const html = SOLUCION_TAQUERIA.replace("<footer>", `${reserva}\n<footer>`);
    const r = await calificarCon(formularioLlega(), { html }, { navegador, next: nextUrl, leerEnvios: async () => recibidos });
    expect(r.paso, r.explicacion).toBe(true);
    expect(recibidos[0].salida > recibidos[0].llegada).toBe(true);
  }, 60_000);
  it("rojo si el formulario no tiene con qué enviarse", async () => {
    const sinBoton = formulario(nextUrl).replace("<button>Enviar</button>", "");
    const html = SOLUCION_TAQUERIA.replace("<footer>", `${sinBoton}\n<footer>`);
    const r = await calificarCon(formularioLlega(), { html }, { navegador, next: nextUrl, leerEnvios: async () => recibidos });
    expect(r.paso).toBe(false);
  }, 60_000);
});

// Una tienda de dos productos: «Agregar» suma al carrito y «Pedir por
// WhatsApp» manda el pedido. `persiste` guarda el carrito en localStorage;
// `salida` es cómo sale el pedido (las tres formas que escribe un modelo).
const tienda = (persiste: boolean, salida: "open" | "location" | "href") => `<section id="tienda">
  <div><h3>Miel de azahar</h3><button data-p="Miel de azahar">Agregar</button></div>
  <div><h3>Mermelada de huerto</h3><button data-p="Mermelada de huerto">Agregar</button></div>
  <p id="cuenta">Carrito (0)</p>
  <a id="pedir" href="#">Pedir por WhatsApp</a>
</section>
<script>
  var c = ${persiste} ? JSON.parse(localStorage.getItem("carrito") || "[]") : [];
  function pinta() { document.getElementById("cuenta").textContent = "Carrito (" + c.length + ")"; }
  document.querySelectorAll("[data-p]").forEach(function (b) {
    b.addEventListener("click", function () { c.push(b.dataset.p); if (${persiste}) localStorage.setItem("carrito", JSON.stringify(c)); pinta(); });
  });
  document.getElementById("pedir").addEventListener("click", function (e) {
    var u = "https://wa.me/34600000000?text=" + encodeURIComponent("Pedido: " + c.join(", "));
    ${
      salida === "open"
        ? "e.preventDefault(); window.open(u, '_blank');"
        : salida === "location"
          ? "e.preventDefault(); location.href = u;"
          : "this.href = u; this.target = '_blank';"
    }
  });
  pinta();
</script>`;

const conTienda = (persiste: boolean, salida: "open" | "location" | "href") => ({
  html: SOLUCION_TAQUERIA.replace("<footer>", `${tienda(persiste, salida)}\n<footer>`),
});

describe("flujo — pulsar, recargar y mirar, como un visitante", () => {
  const recuerda = flujo("carrito-recuerda", "/", [
    { pulsa: /agregar/i },
    { pulsa: /agregar/i, n: 1 },
    { ve: /carrito \(2\)/i },
    { recarga: true },
    { ve: /carrito \(2\)/i },
  ]);
  it("verde si el carrito sobrevive a la recarga", async () => {
    const r = await calificarCon(recuerda, conTienda(true, "open"), { navegador });
    expect(r.paso, r.explicacion).toBe(true);
  }, 60_000);
  it("rojo si se pierde al recargar, y dice en qué paso", async () => {
    const r = await calificarCon(recuerda, conTienda(false, "open"), { navegador });
    expect(r.paso).toBe(false);
    expect(r.explicacion).toMatch(/paso 5/);
  }, 60_000);
  for (const salida of ["open", "location", "href"] as const) {
    it(`«abre» ve a dónde manda el pedido (${salida}), con lo que se pidió`, async () => {
      const pedido = flujo("pedido-llega", "/", [
        { pulsa: /agregar/i },
        { pulsa: /agregar/i, n: 1 },
        { pulsa: /pedir por whatsapp/i },
        { abre: /wa\.me\/34600000000\?text=.*Miel de azahar.*Mermelada de huerto/ },
      ]);
      const r = await calificarCon(pedido, conTienda(false, salida), { navegador });
      expect(r.paso, r.explicacion).toBe(true);
    }, 60_000);
  }
  it("rojo si el pedido no lleva lo que se agregó", async () => {
    const pedido = flujo("pedido-llega", "/", [{ pulsa: /pedir por whatsapp/i }, { abre: /text=.*Miel de azahar/ }]);
    const r = await calificarCon(pedido, conTienda(false, "open"), { navegador });
    expect(r.paso).toBe(false);
    expect(r.explicacion).toMatch(/paso 2/);
  }, 60_000);
  it("«ve» lee también lo que está en un cajón cerrado (el total del carrito suele vivir ahí), pero no el código", async () => {
    const cajon = SOLUCION_TAQUERIA.replace(
      "<footer>",
      '<aside style="display:none"><p>Total: $740</p></aside><script>var total = "$999";</script>\n<footer>',
    );
    expect((await calificarCon(flujo("x", "/", [{ ve: /total: \$740/i }]), { html: cajon }, { navegador })).paso).toBe(true);
    expect((await calificarCon(flujo("x", "/", [{ ve: /\$999/ }]), { html: cajon }, { navegador })).paso).toBe(false);
  }, 60_000);
  it("acepta los diálogos, como un visitante: un «¿Cobrar?» con confirm() y un alert() no cuelgan el recorrido", async () => {
    const caja = SOLUCION_TAQUERIA.replace(
      "<footer>",
      `<button id="cobrar">Cobrar</button><p id="estado">Sin cobrar</p>
<script>
  document.getElementById("cobrar").addEventListener("click", function () {
    if (confirm("¿Cobrar $61?")) { document.getElementById("estado").textContent = "Cobrado"; alert("Venta apuntada"); }
  });
</script>
<footer>`,
    );
    const r = await calificarCon(flujo("cobra", "/", [{ pulsa: /cobrar/i }, { ve: /cobrado/i }]), { html: caja }, { navegador });
    expect(r.paso, r.explicacion).toBe(true);
  }, 60_000);
  it("cada recorrido es un visitante NUEVO: no ve lo que dejó en el navegador el recorrido anterior en el mismo origen", async () => {
    const memoria = SOLUCION_TAQUERIA.replace(
      "<footer>",
      `<p id="visita">Primera visita</p>
<script>
  if (localStorage.getItem("visto")) document.getElementById("visita").textContent = "Ya estuviste aquí";
  localStorage.setItem("visto", "1");
</script>
<footer>`,
    );
    const r = await calificarCon(flujo("x", "/", [{ ve: /ya estuviste/i }]), { html: memoria }, { navegador, repetir: 2 });
    expect(r.paso, r.explicacion).toBe(false);
  }, 60_000);
  it("rojo si no hay nada que pulsar con ese texto", async () => {
    const r = await calificarCon(flujo("x", "/", [{ pulsa: /añadir al carrito/i }]), conTienda(true, "open"), { navegador });
    expect(r.paso).toBe(false);
    expect(r.explicacion).toMatch(/paso 1/);
  }, 60_000);
  it("«pulsa … siHay»: si no hay nada con ese texto, sigue; si lo hay, lo pulsa", async () => {
    const tienda = conTienda(false, "open");
    const sinPanel = flujo("x", "/", [{ pulsa: /ver mi pedido/i, siHay: true }, { pulsa: /agregar/i }]);
    expect((await calificarCon(sinPanel, tienda, { navegador })).paso).toBe(true);
  }, 60_000);
});

// 🔴 V10 (dev y sellado del 27/09): `enlaces-internos-van` leía el HTML SERVIDO,
// y un «Mandar el pedido por WhatsApp» con `href="#"` al que el script le pone
// el `wa.me` al cargar salía «no va a ningún sitio». Un `#` nuevo cuenta como
// muerto sólo si en el navegador tampoco hace nada.
describe("enlaces-internos-van — un `#` nuevo sólo está muerto si en el navegador no hace nada", () => {
  const conBoton = (script: string) => ({
    html: SOLUCION_TAQUERIA.replace(
      "<footer>",
      `<a id="nuevo" href="#" class="btn">Mandar el pedido por WhatsApp</a><div id="panel" hidden>Tu pedido</div>${script}\n<footer>`,
    ),
  });
  it("🔴 verde si el script le pone destino al cargar", async () => {
    const r = await calificarCon(
      enlacesInternosVan(),
      conBoton(`<script>document.getElementById("nuevo").href = "https://wa.me/?text=" + encodeURIComponent("Pedido");</script>`),
      { navegador },
    );
    expect(r.paso, r.explicacion).toBe(true);
  }, 60_000);
  it("🔴 verde si al pulsarlo hace algo (abre un panel, abre WhatsApp)", async () => {
    const panel = `<script>document.getElementById("nuevo").addEventListener("click", function (e) { e.preventDefault(); document.getElementById("panel").hidden = false; });</script>`;
    expect((await calificarCon(enlacesInternosVan(), conBoton(panel), { navegador })).paso).toBe(true);
    const abre = `<script>document.getElementById("nuevo").addEventListener("click", function (e) { e.preventDefault(); window.open("https://wa.me/?text=hola"); });</script>`;
    expect((await calificarCon(enlacesInternosVan(), conBoton(abre), { navegador })).paso).toBe(true);
  }, 60_000);
  it("BRAZO DE CONTROL: rojo si el `#` nuevo no hace nada tampoco en el navegador", async () => {
    const r = await calificarCon(enlacesInternosVan(), conBoton(""), { navegador });
    expect(r.paso).toBe(false);
    expect(r.explicacion).toContain("Mandar el pedido por WhatsApp");
  }, 60_000);
});

// 🔴 SELLADO del 27/09, los dos brazos: el flujo de `pedido-por-whatsapp`
// elegía los tarros POR POSICIÓN («el 2º "Agregar"»), exigía un botón que
// dijera «agregar», y pulsaba «Enviar» sin abrir el panel del pedido. Tres
// tiendas bien hechas suspendían. El flujo nuevo —`pide` por NOMBRE, y abrir
// «Ver mi pedido» si lo hay— las aprueba, y sigue suspendiendo el número malo.
describe("flujo — el pedido por WhatsApp de una tienda como la hace Len", () => {
  const TARROS = ["Miel de azahar", "Mermelada de huerto", "Conservas del campo"];
  const flujoDelPedido = (numero: string) =>
    flujo("pedido-llega-a-su-whatsapp", "/", [
      { pide: 1, de: /Miel de azahar/ },
      { pide: 1, de: /Mermelada de huerto/ },
      { pulsa: /ver (mi |el |tu )?(pedido|carrito)|mi pedido/i, siHay: true },
      { pulsa: /(enviar|mandar|hacer|pedir|confirmar).{0,25}(pedido|whatsapp)|pedido.{0,20}whatsapp/i },
      { abre: new RegExp(`^(?=.*wa\\.me\\/${numero})(?=.*Miel de azahar)(?=.*Mermelada de huerto)`, "s") },
    ]);
  // El botón pulsado cambia a «Añadido ✓» y el de enviar vive en un panel.
  const conPanel = (numero: string) => ({
    html: SOLUCION_TAQUERIA.replace(
      "<footer>",
      `${TARROS.map((t) => `<article><h3>${t}</h3><button class="add" data-t="${t}">Añadir al pedido</button></article>`).join("")}
<button id="ver">Ver mi pedido</button>
<div id="panel" style="display:none"><button id="enviar">Enviar el pedido por WhatsApp</button></div>
<script>
  var c = [];
  document.querySelectorAll(".add").forEach(function (b) {
    b.addEventListener("click", function () { c.push(b.getAttribute("data-t")); b.textContent = "Añadido ✓"; });
  });
  document.getElementById("ver").addEventListener("click", function () { document.getElementById("panel").style.display = "block"; });
  document.getElementById("enviar").addEventListener("click", function () {
    window.open("https://wa.me/34611234567?text=" + encodeURIComponent("Pedido: " + c.join(", ")), "_blank");
  });
</script>
<footer>`,
    ),
  });
  // Un selector «− 0 +» por tarro, sin ningún «Agregar».
  const conSelector = {
    html: SOLUCION_TAQUERIA.replace(
      "<footer>",
      `${TARROS.map((t) => `<article><h3>${t}</h3><span>¿Cuántos tarros?</span><button class="menos" data-t="${t}">−</button><span>0</span><button class="mas" data-t="${t}">+</button></article>`).join("")}
<button id="enviar">Pedir por WhatsApp</button>
<script>
  var c = [];
  document.querySelectorAll(".mas").forEach(function (b) { b.addEventListener("click", function () { c.push(b.getAttribute("data-t")); }); });
  document.getElementById("enviar").addEventListener("click", function () {
    window.open("https://wa.me/34611234567?text=" + encodeURIComponent("Pedido: " + c.join(", ")), "_blank");
  });
</script>
<footer>`,
    ),
  };
  it("🔴 verde con el panel «Ver mi pedido» y botones que cambian a «Añadido ✓»", async () => {
    const r = await calificarCon(flujoDelPedido("34611234567"), conPanel("34611234567"), { navegador });
    expect(r.paso, r.explicacion).toBe(true);
  }, 60_000);
  it("🔴 verde con un selector «− 0 +» por tarro", async () => {
    const r = await calificarCon(flujoDelPedido("34611234567"), conSelector, { navegador });
    expect(r.paso, r.explicacion).toBe(true);
  }, 60_000);
  it("el flujo VIEJO (por posición, sin panel) suspendía estas dos tiendas bien hechas", async () => {
    const viejo = flujo("pedido-llega-a-su-whatsapp", "/", [
      { pulsa: /agregar|añadir|al (carrito|pedido)|lo quiero/i },
      { pulsa: /agregar|añadir|al (carrito|pedido)|lo quiero/i, n: 1 },
      { pulsa: /(enviar|mandar|hacer|pedir|confirmar).{0,25}(pedido|whatsapp)|pedido.{0,20}whatsapp/i },
      { abre: /^(?=.*wa\.me\/34611234567)(?=.*Miel de azahar)(?=.*Mermelada de huerto)/s },
    ]);
    expect((await calificarCon(viejo, conPanel("34611234567"), { navegador })).paso).toBe(false);
    expect((await calificarCon(viejo, conSelector, { navegador })).paso).toBe(false);
  }, 90_000);
  it("BRAZO DE CONTROL: rojo si el pedido va a OTRO número", async () => {
    const r = await calificarCon(flujoDelPedido("34699999999"), conPanel("34611234567"), { navegador });
    expect(r.paso).toBe(false);
  }, 60_000);
});

// Una calculadora de presupuesto: metros × precio del acabado. El acabado se
// elige como lo construya el modelo (un <select>, radios o botones), y los
// metros se escriben en un número o se arrastran en un deslizador.
const calculadora = (acabado: "select" | "radio" | "botones", metros: "number" | "range" = "number") => `<section id="calc">
  <label>Metros de cubierta <input id="m" type="${metros}" min="1" max="10" step="1" value="1"></label>
  ${
    acabado === "select"
      ? '<label>Acabado <select id="a"><option value="950">Barniz mate</option><option value="1200">Aceite natural</option></select></label>'
      : acabado === "radio"
        ? '<fieldset><legend>Acabado</legend><label><input type="radio" name="a" value="950" checked> Barniz mate</label><label><input type="radio" name="a" value="1200"> Aceite natural</label></fieldset>'
        : '<div><button type="button" data-a="950">Barniz mate</button><button type="button" data-a="1200">Aceite natural</button></div>'
  }
  <p>Total: <strong id="t">$950</strong></p>
</section>
<script>
  var precio = 950;
  function total() { document.getElementById("t").textContent = "$" + ((Number(document.getElementById("m").value) || 0) * precio).toLocaleString("en-US"); }
  document.getElementById("m").addEventListener("input", total);
  ${
    acabado === "select"
      ? 'document.getElementById("a").addEventListener("change", function (e) { precio = Number(e.target.value); total(); });'
      : acabado === "radio"
        ? 'document.querySelectorAll("input[name=a]").forEach(function (r) { r.addEventListener("change", function () { precio = Number(r.value); total(); }); });'
        : 'document.querySelectorAll("[data-a]").forEach(function (b) { b.addEventListener("click", function () { precio = Number(b.dataset.a); total(); }); });'
  }
  total();
</script>`;
const conCalculadora = (acabado: "select" | "radio" | "botones", metros: "number" | "range" = "number") => ({
  html: SOLUCION_TAQUERIA.replace("<footer>", `${calculadora(acabado, metros)}\n<footer>`),
});

describe("flujo — escribir y elegir, como un visitante", () => {
  const presupuesto = flujo("presupuesto", "/", [{ escribe: "3", en: /metros/i }, { elige: /aceite/i }, { ve: /total: \$3,600/i }]);
  for (const [acabado, metros] of [["select", "number"], ["radio", "number"], ["botones", "number"], ["select", "range"]] as const) {
    it(`escribe los metros (${metros}) y elige el acabado (${acabado}): el total sale`, async () => {
      const r = await calificarCon(presupuesto, conCalculadora(acabado, metros), { navegador });
      expect(r.paso, r.explicacion).toBe(true);
    }, 60_000);
  }
  it("rojo si no hay ningún campo con esa etiqueta, y lo dice", async () => {
    const r = await calificarCon(flujo("x", "/", [{ escribe: "3", en: /ancho/i }]), conCalculadora("select"), { navegador });
    expect(r.paso).toBe(false);
    expect(r.explicacion).toMatch(/paso 1 .*ningún campo/);
  }, 60_000);
  it("rojo si no hay ninguna opción con ese texto, y lo dice", async () => {
    const r = await calificarCon(flujo("x", "/", [{ elige: /laca blanca/i }]), conCalculadora("radio"), { navegador });
    expect(r.paso).toBe(false);
    expect(r.explicacion).toMatch(/paso 1 .*ninguna opción/);
  }, 60_000);
});

// Un pedido suelto con mínimo de $20, de las dos formas que lo construye un
// modelo: un campo de cantidad por producto, o «Agregar» en la tarjeta y
// «− n +» en el resumen. La calibración del 2026-09-24 suspendió la segunda
// en `pedido-minimo` (3 de 3) aunque la página estaba bien: la vara sólo
// sabía escribir en campos.
const pedidoSuelto = (ui: "campos" | "botones") => {
  const seccion =
    ui === "campos"
      ? `<section id="pedido"><form>
  <label>Bowls de temporada · $8<input type="number" name="bowls" min="0" value="0"></label>
  <label>Smoothies · $4<input type="number" name="smoothies" min="0" value="0"></label>
  <label>Nombre<input type="text" name="nombre"></label>
  <p>Total <span id="total">$0</span></p><p id="falta"></p>
  <button type="submit" id="pedir" disabled>Pedir</button></form></section>`
      : `<section id="pedido">
  <div class="tarjeta"><h3>Bowl de temporada</h3><p>$8</p><button type="button" data-add="bowl">Agregar</button></div>
  <div class="tarjeta"><h3>Smoothie</h3><p>$4</p><button type="button" data-add="smoothie">Agregar</button></div>
  <div id="resumen"></div><p>Total <span id="total">$0</span></p><p id="falta"></p>
  <form action="${nextUrl}/api/f/demo" method="post"><label>Nombre<input type="text" name="nombre"></label><button type="submit" id="pedir" disabled>Pedir</button></form></section>`;
  const script =
    ui === "campos"
      ? `<script>
var P = { bowls: 8, smoothies: 4 }; var f = document.querySelector("#pedido form");
function pinta() { var t = 0; Object.keys(P).forEach(function (k) { t += (parseInt(f.elements[k].value, 10) || 0) * P[k]; });
  document.getElementById("total").textContent = "$" + t; document.getElementById("falta").textContent = t < 20 ? "Te faltan $" + (20 - t) : "";
  document.getElementById("pedir").disabled = t < 20; }
f.addEventListener("input", pinta); f.addEventListener("change", pinta); pinta();
</script></body>`
      : `<script>
var P = { bowl: ["Bowl de temporada", 8], smoothie: ["Smoothie", 4] }; var q = {};
function pinta() { var t = 0, h = "";
  Object.keys(q).forEach(function (k) { if (!q[k]) return; t += q[k] * P[k][1];
    h += '<div class="fila"><span>' + P[k][0] + '</span><button type="button" data-menos="' + k + '">−</button><span>' + q[k] + '</span><button type="button" data-mas="' + k + '">+</button></div>'; });
  document.getElementById("resumen").innerHTML = h; document.getElementById("total").textContent = "$" + t;
  document.getElementById("falta").textContent = t < 20 ? "Te faltan $" + (20 - t) : ""; document.getElementById("pedir").disabled = t < 20;
  document.querySelectorAll("[data-add]").forEach(function (b) { b.textContent = q[b.getAttribute("data-add")] ? "Agregado ✓" : "Agregar"; }); }
document.addEventListener("click", function (e) { var a = e.target.closest("[data-add],[data-mas],[data-menos]"); if (!a) return;
  var k = a.getAttribute("data-add") || a.getAttribute("data-mas") || a.getAttribute("data-menos");
  q[k] = a.hasAttribute("data-add") ? Math.max(q[k] || 0, 1) : (q[k] || 0) + (a.hasAttribute("data-menos") ? -1 : 1); pinta(); });
pinta();
</script></body>`;
  return { html: SOLUCION_TAQUERIA.replace("<footer>", `${seccion}\n<footer>`).replace("</body>", script) };
};

describe("flujo — pedir un producto, lo haya construido el modelo como lo haya construido", () => {
  for (const ui of ["campos", "botones"] as const) {
    it(`pide 1 y ve cuánto falta; pide 3 y ve el total (${ui})`, async () => {
      const uno = await calificarCon(flujo("x", "/", [{ pide: 1, de: /bowls? de temporada/i }, { ve: /faltan \$12\b/i }]), pedidoSuelto(ui), { navegador });
      expect(uno.paso, uno.explicacion).toBe(true);
      const tres = await calificarCon(flujo("x", "/", [{ pide: 3, de: /bowls? de temporada/i }, { ve: /total \$24\b/i }]), pedidoSuelto(ui), { navegador });
      expect(tres.paso, tres.explicacion).toBe(true);
    }, 90_000);
  }
  it("rojo si no hay manera de pedir ese producto, y lo dice", async () => {
    const r = await calificarCon(flujo("x", "/", [{ pide: 1, de: /tarta/i }]), pedidoSuelto("botones"), { navegador });
    expect(r.paso).toBe(false);
    expect(r.explicacion).toMatch(/paso 1 .*no hay manera/);
  }, 60_000);
});

describe("sigue-ahi — lo que no se pidió tocar sigue a la vista", () => {
  // La tienda la PINTA el JS, como la de `encargo-grande`: quitar una pieza del
  // arreglo no deja rastro en el HTML servido, sólo en lo que se pinta.
  const tienda = (piezas: readonly string[]) => ({
    html: SOLUCION_TAQUERIA.replace(
      "<footer>",
      `<section id="tienda"></section><script>
  var PIEZAS = ${JSON.stringify(piezas)};
  document.getElementById("tienda").innerHTML = PIEZAS.map(function (p) { return "<h3>" + p + "</h3>"; }).join("");
  var nota = "Gorra Oreja Larga";
</script>
<footer>`,
    ),
  });
  const sigue = sigueAhi("sigue-la-tienda", "/", [/Hoodie Madriguera/, /Zapatillas Brinco/]);

  it("verde si todo lo declarado se ve, también lo que pinta el JS", async () => {
    const r = await calificarCon(sigue, tienda(["Hoodie Madriguera", "Zapatillas Brinco"]), { navegador });
    expect(r.paso).toBe(true);
  }, 60_000);
  it("rojo si se quitó algo que nadie pidió, y dice qué", async () => {
    const r = await calificarCon(sigue, tienda(["Hoodie Madriguera"]), { navegador });
    expect(r.paso).toBe(false);
    expect(r.explicacion).toMatch(/Zapatillas Brinco/);
    expect(r.explicacion).not.toMatch(/Hoodie/);
  }, 60_000);
  it("lo que sólo queda en el código no cuenta como que sigue", async () => {
    const r = await calificarCon(sigueAhi("x", "/", [/Gorra Oreja Larga/]), tienda(["Hoodie Madriguera"]), { navegador });
    expect(r.paso).toBe(false);
  }, 60_000);
});

describe("formulario-llega con la compra hecha antes de enviar", () => {
  it("con un pedido mínimo bien hecho la caja vacía no llega; con 3 bowls pedidos, sí", async () => {
    recibidos.length = 0;
    const leer = { navegador, next: nextUrl, leerEnvios: async () => recibidos };
    const vacia = await calificarCon(formularioLlega(), pedidoSuelto("botones"), leer);
    expect(vacia.paso).toBe(false);
    const llena = await calificarCon(formularioLlega("/", 3, { antes: [{ pide: 3, de: /bowls? de temporada/i }] }), pedidoSuelto("botones"), leer);
    expect(llena.paso, llena.explicacion).toBe(true);
  }, 120_000);
});

// Revisión de la rama de E (2026-09-26, `plans/len-2/revision-e-rama/`): tres
// graders de casos suspendían lo que Len hizo BIEN, escrito de otra forma. Cada
// 🔴 es la SOLUCIÓN del propio caso con sólo eso cambiado, como lo escribió Len;
// el control de que siguen suspendiendo lo mal hecho son las rotas de cada caso
// (`bench:len:validar`).
describe("los graders de los casos aprueban lo bien hecho escrito de otra forma", () => {
  const caso = async (id: string): Promise<Encargo> => {
    const e = (await cargarEncargos("dev")).find((x) => x.id === id);
    if (!e) throw new Error(`no está el caso ${id}`);
    return e;
  };
  const grader = (e: Encargo, nombre: string): Grader => {
    const g = e.graders.find((x) => x.nombre === nombre);
    if (!g) throw new Error(`${e.id} no tiene el grader ${nombre}`);
    return g;
  };
  /** Cambia `de` por `a` donde salga, en la portada y en cada página; LANZA si no sale. */
  const cambiado = (d: ProjectData, de: string, a: string): ProjectData => {
    let visto = false;
    const en = (html: string) => {
      if (html.includes(de)) visto = true;
      return html.split(de).join(a);
    };
    const pages = d.pages
      ? Object.fromEntries(Object.entries(d.pages).map(([k, p]) => [k, { ...p, html: en(p.html) }]))
      : undefined;
    const out = { ...d, html: en(d.html ?? ""), ...(pages ? { pages } : {}) };
    if (!visto) throw new Error(`«${de}» no sale en la solución`);
    return out;
  };

  // Las reseñas que el dueño dio, guardadas en un almacén y pintadas por el JS
  // al cargar: el visitante las ve, y `datos-de-la-ficha` leía sólo el HTML
  // servido (resenas-que-no-dio: rama #1 y control #2).
  it("🔴 datos-de-la-ficha: lo que pinta el JS de la página también está en la página", async () => {
    const campos = ["plato_1", "precio_1", "plato_3", "precio_3"];
    const conJs = INICIO_TAQUERIA.replace(
      "</body>",
      '<section id="menu"></section><script>document.getElementById("menu").innerHTML = "<p>Taco al pastor · $25</p><p>Gringa · $70</p>";</script>\n</body>',
    );
    const r = await calificarCon(datosDeLaFicha(campos), { html: conJs }, { navegador });
    expect(r.paso, r.explicacion).toBe(true);
    // CONTROL: sin nada que lo pinte, sigue faltando (y lo que sólo vive en el
    // código, sin pintarse, tampoco cuenta).
    const soloCodigo = INICIO_TAQUERIA.replace("</body>", '<script>var menu = "Taco al pastor $25 Gringa $70";</script>\n</body>');
    expect((await calificarCon(datosDeLaFicha(campos), { html: soloCodigo }, { navegador })).paso).toBe(false);
  }, 120_000);

  // El dueño pidió «un boton de cobrar que apunte la venta»; el de Len decía
  // «Cobrar y apuntar» y `/^cobrar$/i` no lo encontraba (rama #1 y #3, control #1 y #2).
  it("🔴 punto-de-venta: «Cobrar y apuntar» es el botón de cobrar", async () => {
    const e = await caso("punto-de-venta");
    const datos = cambiado(e.solucion, ">Cobrar</button>", ">Cobrar y apuntar</button>");
    const r = await calificarCon(grader(e, "la-caja-suma-cobra-y-recuerda"), datos, { navegador });
    expect(r.paso, r.explicacion).toBe(true);
  }, 120_000);

  // «Subtotal $24» enseña la suma del pedido; `\btotal` no veía «total» dentro
  // de «Subtotal» (rama #3, 1.5-B #2).
  it("🔴 pedido-minimo: «Subtotal $24» enseña el total del pedido", async () => {
    const e = await caso("pedido-minimo");
    const datos = cambiado(e.solucion, 'Total <span id="pedido-total">', 'Subtotal <span id="pedido-total">');
    const r = await calificarCon(grader(e, "suma-el-pedido"), datos, { navegador });
    expect(r.paso, r.explicacion).toBe(true);
  }, 120_000);

  // «Talla» y «única» en dos etiquetas se pintan separadas, pero el texto que
  // lee el grader las pega («TallaÚnica»): rama #2 y 4 de las 6 de 1.5.
  it("🔴 encargo-grande: «Talla» y «única» en dos etiquetas son talla única", async () => {
    const e = await caso("encargo-grande");
    const datos = cambiado(e.solucion, "Talla única</span>", "Talla</span><span>única</span>");
    const r = await calificarCon(grader(e, "calcetas-talla-unica"), datos, { navegador });
    expect(r.paso, r.explicacion).toBe(true);
  }, 120_000);
});
