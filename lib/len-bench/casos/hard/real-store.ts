// lib/len-bench/casos/hard/real-store.ts — «tienda-de-verdad», N3, del juego DIFÍCIL
// (plans/len-2/corridas/2026-10-03-dynamis): encargos con margen, evaluados como
// DeepSeek evalúa su Minimal contra su Standard —pruebas ocultas que dicen si lo
// pedido FUNCIONA y si lo que había SIGUE—.
//
// Sobre la plantilla REAL `liebre` (streetwear, euros) del `encargo-grande` de
// dev, con OCHO piezas en vez de cuatro y sus botones «Añadir» que no hacen
// nada, como los deja la plantilla. Tres mensajes, como un dueño que va
// pidiendo: filtro por tipo + buscador + carrito que se recuerde; el pedido
// por WhatsApp con cada pieza y el total; y al volver, el envío (gratis desde
// 50€, como ya dice la página, si no 5€) sumado al total.
//
// Todo se mide en el navegador como un cliente (`flujo`): filtra y mira lo que
// ya NO se ve (`noVe`), busca, pide piezas con el control que Len haya hecho
// (`pide`), lee el total, recarga, y pulsa el pedido. Los totales elegidos no
// salen en ninguna otra parte de la página: 97, 17, 58 y 158.
import fs from "node:fs";
import path from "node:path";
import type { Encargo } from "@/lib/len-bench/tipos";
import { cambiar, type Cambio } from "@/lib/len-bench/casos/cambiar";
import { flujo, nadaInventado, sigueAhi, sinCifrasInventadas, sinDesbordeMovil } from "@/lib/len-bench/graders";

const WHATSAPP = "34612345678";

const PIEZAS = [
  { slug: "prod-tee", nombre: "Camiseta Calavera", precio: 34, tag: "DROP 07", tipo: "ropa" },
  { slug: "prod-hoodie", nombre: "Hoodie Madriguera", precio: 79, tag: "NUEVO", tipo: "ropa" },
  { slug: "prod-chamarra", nombre: "Chamarra Conejo", precio: 110, tag: "DROP 07", tipo: "ropa" },
  { slug: "prod-kicks", nombre: "Zapatillas Brinco", precio: 120, tag: "DROP 07", tipo: "calzado" },
  { slug: "prod-low", nombre: "Tenis Liebre Low", precio: 95, tag: "NUEVO", tipo: "calzado" },
  { slug: "prod-cap", nombre: "Gorra Oreja Larga", precio: 29, tag: "ÚLTIMAS", tipo: "accesorios" },
  { slug: "prod-calcetas", nombre: "Calcetas Salto", precio: 12, tag: "DROP 07", tipo: "accesorios" },
  { slug: "prod-mochila", nombre: "Mochila Madriguera", precio: 45, tag: "NUEVO", tipo: "accesorios" },
] as const;

const PRODUCTS_DE_LA_PLANTILLA = `  var PRODUCTS = [
    { slug:"prod-tee",    nombre:"Camiseta Calavera", precio:"34€",  tag:"DROP 07" },
    { slug:"prod-hoodie", nombre:"Hoodie Madriguera", precio:"79€",  tag:"NUEVO"   },
    { slug:"prod-cap",    nombre:"Gorra Oreja Larga", precio:"29€",  tag:"ÚLTIMAS" },
    { slug:"prod-kicks",  nombre:"Zapatillas Brinco", precio:"120€", tag:"DROP 07" }
  ];`;

/** El arreglo de la partida: las ocho piezas, con el precio como lo escribe la plantilla. */
const productosDeLaPartida = (sinGorra = false, gorra = "29€") =>
  "  var PRODUCTS = [\n" +
  PIEZAS.filter((p) => !(sinGorra && p.slug === "prod-cap"))
    .map((p) => `    { slug:"${p.slug}", nombre:"${p.nombre}", precio:"${p.slug === "prod-cap" ? gorra : `${p.precio}€`}", tag:"${p.tag}" }`)
    .join(",\n") +
  "\n  ];";

/** Lo que cambia la solución a mano, y por dónde se rompe cada rota. */
interface Solucion {
  readonly filtra?: boolean;
  readonly busca?: boolean;
  readonly envio?: "bien" | "nunca" | "siempre";
  readonly recuerda?: boolean;
  readonly whatsapp?: "con-pedido" | "sin-pedido";
  readonly sinGorra?: boolean;
  readonly gorra?: string;
}

const ESTANTE = `      <div id="filtros" class="flex flex-wrap items-center" style="gap:10px;margin-bottom:22px;">
        <button type="button" class="chip" data-tipo="todo" aria-pressed="true">Todo</button>
        <button type="button" class="chip" data-tipo="ropa" aria-pressed="false">Ropa</button>
        <button type="button" class="chip" data-tipo="calzado" aria-pressed="false">Calzado</button>
        <button type="button" class="chip" data-tipo="accesorios" aria-pressed="false">Accesorios</button>
        <label style="margin-left:auto;display:flex;align-items:center;gap:8px;font-size:14px;color:var(--fg-muted);">Buscar
          <input id="buscar" type="search" placeholder="Busca una pieza" style="padding:10px 14px;border-radius:999px;border:1px solid var(--border-strong);background:transparent;color:var(--fg);min-width:0;width:200px;max-width:100%;">
        </label>
      </div>
      <div id="products"`;

const CARRITO = `<div id="products" class="grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:clamp(14px,2.5vw,22px);"></div>
      <aside id="carrito" aria-label="Tu carrito" style="margin-top:36px;padding:22px;border:1px solid var(--border-strong);border-radius:var(--radius);background:var(--surface);">
        <h3 style="margin:0 0 14px;font-family:var(--font-display);font-weight:700;font-size:20px;color:var(--fg);">TU CARRITO</h3>
        <p id="carrito-vacio" style="margin:0;color:var(--fg-muted);font-size:14px;">Todavía no añadiste nada.</p>
        <ul id="carrito-lineas" style="list-style:none;margin:0;padding:0;display:grid;gap:10px;"></ul>
        <p style="margin:16px 0 0;color:var(--fg-muted);font-size:14px;">Envío: <span id="carrito-envio">gratis desde 50€</span></p>
        <p style="margin:6px 0 0;font-family:var(--font-display);font-weight:700;font-size:18px;color:var(--fg);">Total: <span id="carrito-total">0€</span></p>
        <a id="carrito-whatsapp" href="#" style="display:inline-block;margin-top:16px;padding:12px 18px;border-radius:999px;background:var(--accent);color:var(--accent-ink);font-family:var(--font-display);font-weight:700;font-size:14px;">Mandar pedido por WhatsApp</a>
      </aside>`;

/** El JavaScript de la tienda: pinta las piezas filtradas, el carrito y el pedido. */
const tienda = (s: Solucion) => `  var TIPOS = { ${PIEZAS.map((p) => `"${p.slug}":"${p.tipo}"`).join(", ")} };
  var PRECIOS = { ${PIEZAS.map((p) => `"${p.slug}":${p.slug === "prod-cap" && s.gorra ? s.gorra.replace("€", "") : p.precio}`).join(", ")} };
  var filtro = "todo";
  var busqueda = "";
  var carrito = {};
  ${s.recuerda === false ? "" : 'try { carrito = JSON.parse(localStorage.getItem("liebre-carrito") || "{}") || {}; } catch (e) { carrito = {}; }'}
  function guarda(){ ${s.recuerda === false ? "" : 'try { localStorage.setItem("liebre-carrito", JSON.stringify(carrito)); } catch (e) {}'} }
  function pieza(slug){ for (var i = 0; i < PRODUCTS.length; i++) { if (PRODUCTS[i].slug === slug) return PRODUCTS[i]; } return null; }
  function pintaTienda(){
    var grid = document.getElementById("products");
    grid.querySelectorAll(".prod").forEach(function(card, i){
      var p = PRODUCTS[i];
      var pasaTipo = ${s.filtra === false ? "true" : 'filtro === "todo" || TIPOS[p.slug] === filtro'};
      var pasaBusqueda = ${s.busca === false ? "true" : "!busqueda || p.nombre.toLowerCase().indexOf(busqueda) !== -1"};
      card.style.display = pasaTipo && pasaBusqueda ? "" : "none";
    });
  }
  function pintaCarrito(){
    var lineas = document.getElementById("carrito-lineas");
    var subtotal = 0;
    var texto = [];
    lineas.innerHTML = Object.keys(carrito).filter(function(slug){ return carrito[slug] > 0 && pieza(slug); }).map(function(slug){
      var p = pieza(slug);
      var importe = PRECIOS[slug] * carrito[slug];
      subtotal += importe;
      texto.push("- " + carrito[slug] + " x " + p.nombre + " (" + importe + "€)");
      return '<li class="flex items-center justify-between" style="gap:10px;font-size:14px;color:var(--fg);">'
        + '<span>' + esc(p.nombre) + '</span>'
        + '<span class="flex items-center" style="gap:8px;">'
        +   '<button type="button" data-menos="' + slug + '" aria-label="Quitar uno de ' + esc(p.nombre) + '" style="width:30px;height:30px;border-radius:999px;border:1px solid var(--border-strong);background:transparent;color:var(--fg);">−</button>'
        +   '<span>' + carrito[slug] + '</span>'
        +   '<button type="button" data-mas="' + slug + '" aria-label="Sumar uno de ' + esc(p.nombre) + '" style="width:30px;height:30px;border-radius:999px;border:1px solid var(--border-strong);background:transparent;color:var(--fg);">+</button>'
        +   '<strong>' + importe + '€</strong>'
        + '</span></li>';
    }).join("");
    document.getElementById("carrito-vacio").style.display = subtotal > 0 ? "none" : "";
    var envio = ${s.envio === "nunca" ? "0" : s.envio === "siempre" ? "subtotal > 0 ? 5 : 0" : "subtotal > 0 && subtotal < 50 ? 5 : 0"};
    var total = subtotal + envio;
    document.getElementById("carrito-envio").textContent = subtotal === 0 ? "gratis desde 50€" : envio === 0 ? "gratis" : envio + "€";
    document.getElementById("carrito-total").textContent = total + "€";
    var mensaje = "Hola LIEBRE, quiero pedir:\\n" + texto.join("\\n") + "\\nEnvío: " + (envio === 0 ? "gratis" : envio + "€") + "\\nTotal: " + total + "€";
    document.getElementById("carrito-whatsapp").href = "https://wa.me/${WHATSAPP}"${s.whatsapp === "sin-pedido" ? "" : ' + "?text=" + encodeURIComponent(mensaje)'};
  }
  document.getElementById("products").addEventListener("click", function(e){
    var boton = e.target.closest(".add");
    if (!boton) return;
    var card = boton.closest(".prod");
    var i = Array.prototype.indexOf.call(document.getElementById("products").children, card);
    var slug = PRODUCTS[i].slug;
    carrito[slug] = (carrito[slug] || 0) + 1;
    guarda(); pintaCarrito();
  });
  document.getElementById("carrito-lineas").addEventListener("click", function(e){
    var mas = e.target.closest("[data-mas]");
    var menos = e.target.closest("[data-menos]");
    if (mas) carrito[mas.getAttribute("data-mas")] += 1;
    if (menos) { var s = menos.getAttribute("data-menos"); carrito[s] -= 1; if (carrito[s] <= 0) delete carrito[s]; }
    if (mas || menos) { guarda(); pintaCarrito(); }
  });
  document.getElementById("filtros").addEventListener("click", function(e){
    var chip = e.target.closest(".chip");
    if (!chip) return;
    filtro = chip.getAttribute("data-tipo");
    document.querySelectorAll("#filtros .chip").forEach(function(c){ c.setAttribute("aria-pressed", c === chip ? "true" : "false"); });
    pintaTienda();
  });
  document.getElementById("buscar").addEventListener("input", function(e){ busqueda = e.target.value.trim().toLowerCase(); pintaTienda(); });
  pintaTienda();
  pintaCarrito();

  /* ---------- RENDER BENEFICIOS (acordeón accesible) ---------- */`;

export function crear(dirPaginas: string): Encargo {
  const plantilla = fs.readFileSync(path.join(dirPaginas, "encargo-grande.inicio.html"), "utf8");
  const PARTIDA: Cambio[] = [
    [PRODUCTS_DE_LA_PLANTILLA, productosDeLaPartida()],
    ["Cuatro piezas numeradas, disponibles esta semana.", "Ocho piezas numeradas, disponibles esta semana."],
  ];
  const inicio = cambiar(plantilla, PARTIDA);
  const con = (s: Solucion = {}): string =>
    cambiar(plantilla, [
      [PRODUCTS_DE_LA_PLANTILLA, productosDeLaPartida(s.sinGorra, s.gorra)],
      ["Cuatro piezas numeradas, disponibles esta semana.", "Ocho piezas numeradas, disponibles esta semana."],
      [
        '<div id="products" class="grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:clamp(14px,2.5vw,22px);"></div>',
        CARRITO,
      ],
      ['      <div id="products"', ESTANTE],
      ["  /* ---------- RENDER BENEFICIOS (acordeón accesible) ---------- */", tienda(s)],
    ]);
  const solucion = con();

  return {
    id: "tienda-de-verdad",
    nivel: "N3",
    resumen:
      "Tienda de 8 piezas: filtro por tipo, buscador, carrito con cantidades que se recuerda, envío según el total y pedido por WhatsApp.",
    inicio: { html: inicio },
    ficha: {
      negocio: "Marca de streetwear en Madrid (LIEBRE) que vende sus drops por la web",
      datos: {
        whatsapp: "+34 612 345 678",
        envio: "gratis desde 50€; si no, 5€",
        ropa: "camiseta, hoodie y chamarra",
        calzado: "zapatillas y tenis",
        accesorios: "gorra, calcetas y mochila",
      },
    },
    guion: [
      {
        tipo: "pide",
        mensaje:
          "quiero que la tienda funcione de verdad: un filtro por tipo —ropa (camiseta, hoodie y chamarra), calzado (zapatillas y tenis) y accesorios (gorra, calcetas y mochila)— y un buscador por nombre. y un carrito de verdad: que puedan añadir varias piezas, cambiar cuántas llevan y ver el total, y que no se les borre si recargan la página",
      },
      {
        tipo: "pide",
        mensaje: "abajo del carrito pon un botón para que me manden el pedido por whatsapp al +34 612 345 678, con cada pieza, cuántas lleva y el total",
      },
      {
        tipo: "vuelve",
        mensaje: "ah, y el envío: desde 50€ es gratis, como dice arriba, y si no son 5€. que el total del carrito ya lo sume",
      },
    ],
    graders: [
      flujo("filtra-calzado", "/", [{ elige: /^\s*calzado\s*$/i }, { ve: /Tenis Liebre Low/ }, { noVe: /Camiseta Calavera/ }]),
      flujo("filtra-accesorios", "/", [
        { elige: /^\s*accesorios\s*$/i },
        { ve: /Mochila Madriguera/ },
        { noVe: /Hoodie Madriguera/ },
        { noVe: /Zapatillas Brinco/ },
      ]),
      flujo("busca-por-nombre", "/", [{ escribe: "mochila", en: /busc|search/i }, { ve: /Mochila Madriguera/ }, { noVe: /Zapatillas Brinco/ }]),
      // 2 × 34 + 29 = 97: pasa de 50, envío gratis.
      flujo("suma-el-carrito", "/", [{ pide: 2, de: /Camiseta Calavera/ }, { pide: 1, de: /Gorra Oreja Larga/ }, { ve: /(?<![\d.,])97\s?€/ }]),
      // 12 + 5 de envío = 17.
      flujo("cobra-el-envio", "/", [{ pide: 1, de: /Calcetas Salto/ }, { ve: /(?<![\d.,])17\s?€/ }]),
      // 2 × 29 = 58, gratis: ni 63 ni nada que sume el envío.
      flujo("envio-gratis-desde-50", "/", [{ pide: 2, de: /Gorra Oreja Larga/ }, { ve: /(?<![\d.,])58\s?€/ }, { noVe: /(?<![\d.,])63\s?€/ }]),
      // 2 × 79 = 158, y sigue ahí al recargar.
      flujo("recuerda-el-carrito", "/", [{ pide: 2, de: /Hoodie Madriguera/ }, { recarga: true }, { ve: /(?<![\d.,])158\s?€/ }]),
      flujo("pedido-por-whatsapp", "/", [
        { pide: 2, de: /Camiseta Calavera/ },
        { pulsa: /whats\s?app|mandar.*pedido|enviar.*pedido|hacer.*pedido|pedir/i },
        { abre: new RegExp(`wa\\.me/${WHATSAPP}\\?text=[\\s\\S]*Camiseta Calavera[\\s\\S]*68`) },
      ]),
      sigueAhi("siguen-las-ocho-piezas", "/", PIEZAS.map((p) => new RegExp(p.nombre))),
      sigueAhi("siguen-los-beneficios", "/", [/Drops semanales en cantidad limitada/, /Envío gratis desde 50€/]),
      nadaInventado(),
      sinCifrasInventadas(),
      sinDesbordeMovil(),
    ],
    solucion: { html: solucion },
    rotas: [
      { nombre: "filtro-de-adorno", datos: { html: con({ filtra: false }) } },
      { nombre: "buscador-de-adorno", datos: { html: con({ busca: false }) } },
      { nombre: "nunca-cobra-envio", datos: { html: con({ envio: "nunca" }) } },
      { nombre: "siempre-cobra-envio", datos: { html: con({ envio: "siempre" }) } },
      { nombre: "no-recuerda", datos: { html: con({ recuerda: false }) } },
      { nombre: "whatsapp-sin-pedido", datos: { html: con({ whatsapp: "sin-pedido" }) } },
      { nombre: "quito-la-gorra", datos: { html: con({ sinGorra: true }) } },
      { nombre: "precio-inventado", datos: { html: con({ gorra: "32€" }) } },
      // Lo que mira `nada-inventado`: un dato de contacto escrito que nadie dio.
      {
        nombre: "telefono-inventado",
        datos: { html: cambiar(solucion, [["Todavía no añadiste nada.</p>", "Todavía no añadiste nada. ¿Dudas? Llámanos al +34 655 443 322.</p>"]]) },
      },
      {
        nombre: "beneficios-borrados",
        datos: { html: cambiar(solucion, [['{ title:"Drops semanales en cantidad limitada", body:"Cada semana una cápsula nueva, numerada y sin restock." },\n', ""]]) },
      },
      { nombre: "desborda", datos: { html: cambiar(solucion, [["<!-- MANIFIESTO -->", '<div style="width:900px">x</div>\n  <!-- MANIFIESTO -->']]) } },
    ],
  };
}
