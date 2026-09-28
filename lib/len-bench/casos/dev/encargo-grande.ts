// lib/len-bench/casos/dev/encargo-grande.ts — N3, F04, sobre una página REAL de
// OpenLen (plantilla `liebre`, streetwear, precios en euros).
//
// Un solo mensaje con cinco cosas, como escribe un dueño con prisa: quitar la
// gorra, agregar dos piezas con precio, talla S–XL en la ropa y «talla única»
// en las calcetas, tres preguntas frecuentes con sus datos y una franja arriba.
// La vuelta baja las zapatillas a 110€. Mide F04: ¿lo termina todo, o hace dos
// cosas y lo da por hecho? La tienda la PINTA el JS de la plantilla (un arreglo
// `PRODUCTS` sobre un `#products` vacío): lo que se vende se mira en el
// navegador (`flujo`), y lo que se quita, en el fichero (script incluido).
// El acordeón de beneficios ya dice «30 días para cambios»: esa pregunta no
// discrimina y no se mide.
import fs from "node:fs";
import path from "node:path";
import type { Encargo } from "@/lib/len-bench/tipos";
import { cambiar } from "@/lib/len-bench/casos/cambiar";
import {
  enlacesInternosVan,
  flujo,
  nadaInventado,
  sigueAhi,
  sinCifrasInventadas,
  sinDesbordeMovil,
  yaNoAparece,
} from "@/lib/len-bench/graders";

const BOTON_ANADIR = "    +     '<button class=\"add\" aria-label=";
const SELECTOR =
  "    +     (p.tallas ? '<label style=\"display:flex;align-items:center;gap:8px;font-size:13px;color:var(--fg-muted);\">Talla <select aria-label=\"Talla de '+esc(p.nombre)+'\" style=\"flex:1;padding:8px 10px;border-radius:999px;border:1px solid var(--border-strong);background:transparent;color:var(--fg);\">' + p.tallas.map(function(t){ return '<option>'+t+'</option>'; }).join('') + '</select></label>' : '')\n" +
  "    +     (p.unica ? '<span style=\"font-size:13px;color:var(--fg-muted);\">Talla única</span>' : '')\n";

interface Tienda {
  readonly gorra: boolean;
  readonly chamarra: string;
  readonly zapatillas: string;
  readonly tallas: boolean;
  readonly faq: string | null;
  readonly franja: boolean;
}
const productos = (t: Tienda) => {
  const talla = t.tallas ? ', tallas:["S","M","L","XL"]' : "";
  return [
    "var PRODUCTS = [",
    `    { slug:"prod-tee",      nombre:"Camiseta Calavera", precio:"34€",  tag:"DROP 07"${talla} },`,
    `    { slug:"prod-hoodie",   nombre:"Hoodie Madriguera", precio:"79€",  tag:"NUEVO"${talla} },`,
    ...(t.gorra ? ['    { slug:"prod-cap",      nombre:"Gorra Oreja Larga", precio:"29€",  tag:"ÚLTIMAS" },'] : []),
    `    { slug:"prod-kicks",    nombre:"Zapatillas Brinco", precio:"${t.zapatillas}", tag:"DROP 07" },`,
    `    { slug:"prod-chamarra", nombre:"Chamarra Conejo",   precio:"${t.chamarra}", tag:"DROP 08"${talla} },`,
    `    { slug:"prod-calcetas", nombre:"Calcetas Salto",    precio:"12€",  tag:"DROP 08"${t.tallas ? ", unica:true" : ""} }`,
    "  ];",
  ].join("\n");
};
const FRANJA =
  '<div style="background:var(--accent);color:var(--accent-ink);text-align:center;padding:10px 16px;font-family:var(--font-display);font-weight:700;letter-spacing:.14em;font-size:12.5px;">DROP 08 · SALE EL VIERNES</div>\n  ';
const faq = (envio: string) => `<!-- PREGUNTAS FRECUENTES -->
  <section id="preguntas" style="background:var(--bg);padding:clamp(48px,8vw,90px) clamp(16px,5vw,64px);">
    <div style="max-width:760px;margin:0 auto;display:grid;gap:14px;">
      <h2 style="margin:0 0 8px;font-family:var(--font-display);font-weight:700;font-size:clamp(28px,5vw,44px);color:var(--fg);">PREGUNTAS FRECUENTES</h2>
      <details><summary>¿Cuánto tarda el envío?</summary><p>Envío gratis desde 50€. ${envio}</p></details>
      <details><summary>¿Puedo cambiar una pieza?</summary><p>Tienes 30 días para cambios.</p></details>
      <details><summary>¿Qué talla pido?</summary><p>Las piezas vienen oversize: pide una talla menos de la que usas.</p></details>
    </div>
  </section>

  <!-- FOOTER -->`;

export function crear(dirPaginas: string): Encargo {
  const inicio = fs.readFileSync(path.join(dirPaginas, "encargo-grande.inicio.html"), "utf8");
  const original = /var PRODUCTS = \[[\s\S]*?\];/.exec(inicio)?.[0];
  if (!original) throw new Error("la plantilla ya no trae el arreglo PRODUCTS");
  const con = (t: Tienda) =>
    cambiar(inicio, [
      [original, productos(t)],
      // Mirar la solución lo cazó: con la gorra fuera y dos nuevas son cinco.
      ...(t.gorra ? [] : ([["Cuatro piezas numeradas", "Cinco piezas numeradas"]] as const)),
      ...(t.tallas ? ([[BOTON_ANADIR, SELECTOR + BOTON_ANADIR]] as const) : []),
      ...(t.faq ? ([["<!-- FOOTER -->", faq(t.faq)]] as const) : []),
      ...(t.franja ? ([["<!-- NAV -->", FRANJA + "<!-- NAV -->"]] as const) : []),
    ]);
  const bien: Tienda = { gorra: false, chamarra: "110€", zapatillas: "110€", tallas: true, faq: "Llega en 3 a 5 días.", franja: true };
  const solucion = con(bien);

  return {
    id: "encargo-grande",
    nivel: "N3",
    resumen: "Un mensaje con cinco cosas (quitar, agregar con precio, tallas, preguntas frecuentes y franja) sobre una tienda que pinta el JS, y un precio más en la vuelta.",
    inicio: { html: inicio },
    ficha: { negocio: "Marca de streetwear en ediciones limitadas", datos: {} },
    guion: [
      {
        tipo: "pide",
        mensaje:
          "para el drop 08 cambia la tienda: quita la gorra, y agrega la Chamarra Conejo a 110€ y las Calcetas Salto a 12€. que la ropa (camiseta, hoodie y chamarra) tenga para elegir talla S, M, L o XL, y las calcetas que digan talla unica. abajo pon 3 preguntas frecuentes: envios (gratis desde 50€, llega en 3 a 5 dias), cambios (30 dias) y tallas (vienen oversize, pide una menos). y hasta arriba una franja que diga DROP 08 · SALE EL VIERNES",
      },
      { tipo: "vuelve", mensaje: "y las zapatillas bajalas a 110€, que cuesten igual que la chamarra" },
    ],
    graders: [
      // `[^€]`: el precio de la MISMA pieza, no el de la que va detrás (la
      // prevalidación cazó «Zapatillas Brinco 120€ … Chamarra Conejo 110€»).
      flujo("piezas-nuevas", "/", [{ ve: /Chamarra Conejo[^€]{0,40}110\s?€/ }, { ve: /Calcetas Salto[^€]{0,40}12\s?€/ }]),
      yaNoAparece("sin-la-gorra", "Gorra Oreja Larga"),
      // Sólo se pidió quitar la gorra. En la recalibración del 2026-09-24,
      // Len quitó también las zapatillas las 3 veces.
      sigueAhi("siguen-las-demas-piezas", "/", [/Camiseta Calavera/, /Hoodie Madriguera/, /Zapatillas Brinco/]),
      flujo("zapatillas-a-110", "/", [{ ve: /Zapatillas Brinco[^€]{0,40}110\s?€/ }]),
      yaNoAparece("sin-el-precio-viejo", "120€"),
      flujo("talla-en-la-ropa", "/", [{ elige: /\bXL\b/ }]),
      // `\s*`: «Talla» y «única» en dos etiquetas se pintan separadas, pero el texto
      // que lee el grader las pega (revisión de E, 26/09: 1 de la rama y 4 de 1.5).
      flujo("calcetas-talla-unica", "/", [{ ve: /Calcetas Salto[\s\S]{0,160}talla\s*[uú]nica/i }]),
      flujo("preguntas-frecuentes", "/", [
        { ve: /\b3\s?(a|-|–)\s?5\s?d[ií]as/i },
        { ve: /oversize[\s\S]{0,80}\b(una|1)\b( talla)? menos/i },
      ]),
      flujo("franja-del-drop", "/", [{ ve: /DROP 08\s*[·•|\-–]?\s*SALE EL VIERNES/i }]),
      nadaInventado(),
      sinCifrasInventadas(),
      sinDesbordeMovil(),
      enlacesInternosVan(),
    ],
    solucion: { html: solucion },
    rotas: [
      // Lo típico de F04: hizo lo de la tienda y dio el resto por hecho.
      { nombre: "a-medias", datos: { html: con({ ...bien, tallas: false, faq: null, franja: false }) } },
      { nombre: "gorra-sigue", datos: { html: con({ ...bien, gorra: true }) } },
      {
        nombre: "quito-de-mas",
        datos: { html: cambiar(solucion, [['    { slug:"prod-kicks",    nombre:"Zapatillas Brinco", precio:"110€", tag:"DROP 07" },\n', ""]]) },
      },
      { nombre: "zapatillas-a-120", datos: { html: con({ ...bien, zapatillas: "120€" }) } },
      { nombre: "sin-tallas", datos: { html: cambiar(solucion, [[', tallas:["S","M","L","XL"]', "", 3]]) } },
      { nombre: "envio-inventado", datos: { html: con({ ...bien, faq: "Llega en 24 horas." }) } },
      // Los precios de la tienda viven en el JS; éste se ve en el HTML.
      { nombre: "umbral-inventado", datos: { html: cambiar(solucion, [["Envío gratis desde 50€. Llega", "Envío gratis desde 40€. Llega"]]) } },
      { nombre: "precio-mal", datos: { html: con({ ...bien, chamarra: "100€" }) } },
      { nombre: "sin-franja", datos: { html: con({ ...bien, franja: false }) } },
      { nombre: "desborda", datos: { html: cambiar(solucion, [["</footer>", '<div style="width:900px">x</div></footer>']]) } },
      { nombre: "enlace-roto", datos: { html: cambiar(solucion, [["</nav>", '<a href="/archivo/">Archivo</a></nav>']]) } },
    ],
  };
}
