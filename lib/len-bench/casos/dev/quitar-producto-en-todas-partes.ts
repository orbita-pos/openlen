// lib/len-bench/casos/dev/quitar-producto-en-todas-partes.ts — N3, F01/F02/F03,
// sobre una página REAL de OpenLen (plantilla `ambar`, fragancias para el
// hogar) con la bolsa de compra que le dejó un encargo anterior.
//
// La partida es `ambar` + una bolsa con el catálogo en JS, indexado por
// posición (`data-i`), como la dejaría un encargo anterior: es el
// `scaffold_script` del corredor de Claude Code, el estado que el caso prepara
// antes de la corrida.
//
// «Ya no vendemos la bruma de hogar: quítala de toda la página». La bruma no
// está sólo en su tarjeta: sale en el párrafo del héroe, en la intro y en un
// paso del ritual, en una reseña, en la meta y el og:description y en el
// catálogo de la bolsa; y la CUENTAN el encabezado («Cuatro piezas») y el set
// de inicio («los cuatro favoritos · $52»). El precio del set sin la bruma no
// viene en el mensaje: está en la ficha, hay que preguntarlo. Al quitarla del
// catálogo, la crema pasa de la posición 3 a la 2: un botón sin renumerar
// suma lo que no es. Y la vuelta sube la crema a $15, que vive también en el
// catálogo: `flujo` suma jabón + crema y espera $24.
import fs from "node:fs";
import path from "node:path";
import type { Encargo } from "@/lib/len-bench/tipos";
import { cambiar, type Cambio } from "@/lib/len-bench/casos/cambiar";
import {
  contieneTexto,
  datosDeLaFicha,
  enlacesInternosVan,
  flujo,
  nadaInventado,
  noContieneTexto,
  sinCifrasInventadas,
  sinDesbordeMovil,
  yaNoAparece,
} from "@/lib/len-bench/graders";

const DESCRIPCIONES = [
  "Espuma cremosa, aroma cálido que dura.</p>",
  "Miel, cera de abeja y un toque de ámbar.</p>",
  "Un toque y la casa cambia.</p>",
  "Karité, glicerina vegetal y nuestro ámbar de siempre.</p>",
];
const boton = (i: number) =>
  `\n        <button type="button" data-i="${i}" class="btn btn-ghost mt-4" style="height:40px;padding:0 18px;font-size:13px">Agregar a la bolsa</button>`;
const VER_TIENDA = '<div class="text-center mt-14 reveal"><a href="#comprar" class="btn btn-ghost">Ver la tienda completa</a></div>';
const RESUMEN =
  '<p class="text-center mt-10 text-[15px]">Tu bolsa: <span id="bolsa-cuenta">0</span> piezas · Total <span id="bolsa-total">$0</span></p>\n    ';

const CATALOGO_BRUMA = '    { nombre: "Bruma de hogar", precio: 22 },\n';
const CATALOGO_CREMA = '    { nombre: "Crema de manos", precio: 14 }\n';
const SCRIPT = `<script>
(function () {
  var CATALOGO = [
    { nombre: "Jabón de ámbar", precio: 9 },
    { nombre: "Bálsamo de miel", precio: 16 },
${CATALOGO_BRUMA}${CATALOGO_CREMA}  ];
  var k = "ambar-bolsa";
  var bolsa = [];
  try { bolsa = JSON.parse(localStorage.getItem(k) || "[]"); } catch (e) {}
  function pinta() {
    var t = 0;
    bolsa.forEach(function (i) { t += CATALOGO[i].precio; });
    document.getElementById("bolsa-cuenta").textContent = bolsa.length;
    document.getElementById("bolsa-total").textContent = "$" + t;
  }
  document.querySelectorAll("[data-i]").forEach(function (b) {
    b.addEventListener("click", function () {
      bolsa.push(Number(b.getAttribute("data-i")));
      try { localStorage.setItem(k, JSON.stringify(bolsa)); } catch (e) {}
      pinta();
    });
  });
  pinta();
})();
</script>
</body>`;

/** El trozo entre la última `abre` antes de `marca` y el final de `cierra`
 *  (o el comienzo del siguiente `abre`, si `cierra` es null). */
function trozo(html: string, marca: string, abre: string, cierra: string | null): string {
  const m = html.indexOf(marca);
  if (m === -1) throw new Error(`no encontré «${marca}»`);
  const a = html.lastIndexOf(abre, m);
  const b = cierra === null ? html.indexOf(abre, m) : html.indexOf(cierra, m) + cierra.length;
  return html.slice(a, b);
}

export function crear(dirPaginas: string): Encargo {
  const plantilla = fs.readFileSync(path.join(dirPaginas, "quitar-producto-en-todas-partes.inicio.html"), "utf8");
  const inicio = cambiar(plantilla, [
    // La plantilla desborda de fábrica a 390 px (este brillo de 420 px llega a
    // 405): se corrige en la partida para no suspender a Len por lo que nadie
    // le pidió.
    ['<div class="glow" style="width:420px;', '<div class="glow" style="max-width:100%;width:420px;'],
    ...DESCRIPCIONES.map((d, i): Cambio => [d, d + boton(i)]),
    [VER_TIENDA, RESUMEN + VER_TIENDA],
    ["</body>", SCRIPT],
  ]);
  const tarjetaBruma = trozo(inicio, "Bruma de hogar</h3>", "<article", "</article>");
  const pasoBruma = trozo(inicio, "Refrescá los espacios", '<div class="flex gap-4">', null);
  const resenaBruma = trozo(inicio, "«La bruma de hogar", "<figure", "</figure>");

  const QUITA_TARJETA: Cambio[] = [
    [tarjetaBruma, ""],
    [CATALOGO_BRUMA, ""],
    [boton(3), boton(2)],
  ];
  const QUITA_RESTO: Cambio[] = [
    [
      "Una bruma sobre las sábanas antes de dormir, el bálsamo al cerrar el día, el jabón en la mañana.",
      "El jabón en la mañana y el bálsamo al cerrar el día.",
    ],
    [pasoBruma, ""],
    ['font-size:18px">3</span>', 'font-size:18px">2</span>'],
    [resenaBruma, ""],
    ["jabones y brumas de formulación lenta. Ámbar", "jabones y bálsamos de formulación lenta. Ámbar"],
  ];
  const QUITA_META: Cambio[] = [["jabones y brumas", "jabones y bálsamos", 2]];
  const CUENTAS: Cambio[] = [
    ["Cuatro piezas<br>para empezar", "Tres piezas<br>para empezar"],
    ["los cuatro favoritos", "los tres favoritos"],
  ];
  const set = (precio: string): Cambio[] => [["Comprar el set · $52", `Comprar el set · ${precio}`]];
  const CREMA_EN_TARJETA: Cambio[] = [['Crema de manos</h3><span class="price">$14</span>', 'Crema de manos</h3><span class="price">$15</span>']];
  const CREMA_EN_CATALOGO: Cambio[] = [[CATALOGO_CREMA, '    { nombre: "Crema de manos", precio: 15 }\n']];

  const hecho = (...grupos: Cambio[][]) => cambiar(inicio, grupos.flat());
  const solucion = hecho(QUITA_TARJETA, QUITA_RESTO, QUITA_META, CUENTAS, set("$42"), CREMA_EN_TARJETA, CREMA_EN_CATALOGO);
  const tarjetaCrema = trozo(solucion, "Crema de manos</h3>", "<article", "</article>");

  return {
    id: "quitar-producto-en-todas-partes",
    nivel: "N3",
    resumen: "Quitar un producto de TODA la página (catálogo JS, meta, reseña, ritual y lo que lo cuenta) sin romper la bolsa, y subir otro precio.",
    inicio: { html: inicio },
    ficha: { negocio: "Casa de fragancias y cuidado del hogar", datos: { precio_del_set_sin_la_bruma: "$42" } },
    guion: [
      {
        tipo: "pide",
        mensaje: "ya no vamos a vender la bruma de hogar, se descontinuo. quitala de toda la pagina porfa, que no quede nada que la mencione",
      },
      { tipo: "vuelve", mensaje: "y sube la crema de manos a $15 porfa" },
    ],
    graders: [
      yaNoAparece("sin-la-bruma", ["Bruma de hogar", "bruma"]),
      noContieneTexto("las-cuentas-cuadran", "/", /cuatro (piezas|favoritos)/i),
      datosDeLaFicha(["precio_del_set_sin_la_bruma"]),
      yaNoAparece("sin-precios-viejos", ["$52", "$14"]),
      contieneTexto("siguen-los-demas", "/", /Jabón de ámbar[\s\S]*Bálsamo de miel[\s\S]*Crema de manos/),
      // Por NOMBRE (`pide`, V4-a), no «el 3º Agregar»: un botón que cambia de
      // texto al pulsarlo movía la posición (27/09). Sigue cazando lo que el
      // caso busca: si el «Agregar» de la crema no se renumeró, suma otra cosa.
      flujo("la-bolsa-sigue", "/", [
        { pide: 1, de: /Jabón de ámbar/ },
        { pide: 1, de: /Crema de manos/ },
        { ve: /\$\s?24(?!\d)/ },
        { recarga: true },
        { ve: /\$\s?24(?!\d)/ },
      ]),
      nadaInventado(),
      sinCifrasInventadas(),
      sinDesbordeMovil(),
      enlacesInternosVan(),
    ],
    solucion: { html: solucion },
    rotas: [
      { nombre: "solo-la-tarjeta", datos: { html: hecho(QUITA_TARJETA, CUENTAS, set("$42"), CREMA_EN_TARJETA, CREMA_EN_CATALOGO) } },
      { nombre: "bruma-en-la-meta", datos: { html: hecho(QUITA_TARJETA, QUITA_RESTO, CUENTAS, set("$42"), CREMA_EN_TARJETA, CREMA_EN_CATALOGO) } },
      { nombre: "cuentas-viejas", datos: { html: hecho(QUITA_TARJETA, QUITA_RESTO, QUITA_META, set("$42"), CREMA_EN_TARJETA, CREMA_EN_CATALOGO) } },
      { nombre: "set-sin-preguntar", datos: { html: hecho(QUITA_TARJETA, QUITA_RESTO, QUITA_META, CUENTAS, CREMA_EN_TARJETA, CREMA_EN_CATALOGO) } },
      { nombre: "crema-solo-en-la-tarjeta", datos: { html: hecho(QUITA_TARJETA, QUITA_RESTO, QUITA_META, CUENTAS, set("$42"), CREMA_EN_TARJETA) } },
      {
        nombre: "bolsa-descuadrada",
        datos: { html: hecho([[tarjetaBruma, ""], [CATALOGO_BRUMA, ""]], QUITA_RESTO, QUITA_META, CUENTAS, set("$42"), CREMA_EN_TARJETA, CREMA_EN_CATALOGO) },
      },
      { nombre: "quito-de-mas", datos: { html: cambiar(solucion, [[tarjetaCrema, ""]]) } },
      { nombre: "precio-inventado", datos: { html: cambiar(solucion, [["Comprar el set · $42", "Comprar el set · $45"]]) } },
      { nombre: "desborda", datos: { html: cambiar(solucion, [["</footer>", '<div style="width:900px">x</div></footer>']]) } },
      { nombre: "enlace-roto", datos: { html: cambiar(solucion, [["</nav>", '<a href="/recargas/">Recargas</a></nav>']]) } },
    ],
  };
}
