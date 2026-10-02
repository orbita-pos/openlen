// lib/len-bench/casos/agente/tabla-a-datos.ts — N2, sobre una página REAL de
// OpenLen (plantilla `rena-luna`, link-in-bio de una ilustradora) con la lista
// de precios que le dejó un encargo anterior: una tabla de 8 productos escrita
// a mano en el HTML.
//
// «Pasa los productos de la tabla a un almacén y que la tabla se pinte desde
// ahí» (INFORME.md P8): es `jq` contra Edit a mano. Hecho bien son tres cosas —
// declarar el almacén en la página, llenar `/datos/<almacén>.json` con las 8
// filas, y que la tabla salga de él—. Dos graders lo comprueban sin mirar CÓMO:
//   · `productos-en-la-tabla`: la tabla ya pintada tiene los 8, cada uno con su
//     precio. Ojo con el atajo: un almacén de lectura se hornea como `<div>`, y
//     un `<div>` dentro de un `<tbody>` el navegador lo saca fuera de la tabla;
//   · `sin-productos-escritos`: ninguno sigue escrito en el HTML del proyecto,
//     ni en un arreglo de JavaScript. Si no están en el fichero y se ven,
//     vienen del almacén (horneados al publicar o leídos por `/api/d`).
// «Peluche Vol. 2» no entra en el segundo: el primer enlace de la página ya lo
// anunciaba antes de la tabla, y tiene que seguir haciéndolo.
//
// La solución hornea: el almacén es de `lectura`, sus filas van en un
// contenedor escondido y un script pinta las filas de la tabla con ellas.
import fs from "node:fs";
import path from "node:path";
import type { Encargo, Siembra } from "@/lib/len-bench/tipos";
import { cambiar } from "@/lib/len-bench/casos/cambiar";
import {
  enlacesInternosVan,
  enLaTabla,
  nadaInventado,
  noEscritoEnElProyecto,
  sigueAhi,
  sinCifrasInventadas,
  sinDesbordeMovil,
} from "@/lib/len-bench/graders";

const PRODUCTOS: readonly (readonly [producto: string, formato: string, precio: number])[] = [
  ["Brushes Peluche Vol. 2", "Procreate", 120],
  ["Brushes Peluche Vol. 1", "Procreate", 100],
  ["Stickers Criaturas", "Hoja de vinil mate", 65],
  ["Stickers Hongos", "Hoja holográfica", 80],
  ["Print Ajolote dormido", "A5", 150],
  ["Print Gato nube", "A4", 220],
  ["Pin Blandito", "Esmalte, 3 cm", 140],
  ["Libreta Cuaderno de criaturas", "A6", 95],
];
const FILA = ([producto, formato, precio]: (typeof PRODUCTOS)[number]) =>
  `\n          <tr class="border-t hairline"><td class="px-4 py-3">${producto}</td><td class="px-4 py-3 text-[color:var(--fg-muted)]">${formato}</td><td class="px-4 py-3 text-right tabular">$${precio}</td></tr>`;
const TABLA = (filas: string, despues = "") => `<!-- PRECIOS -->
<section class="mt-11">
  <h2 class="eyebrow text-center">Lista de precios</h2>
  <div class="mt-5 overflow-hidden rounded-[var(--radius-lg)] border hairline bg-[var(--surface)]">
    <table class="w-full text-left text-[13px]">
      <thead>
        <tr class="mono text-[10.5px] uppercase tracking-[0.12em] text-[color:var(--fg-faint)]"><th class="px-4 py-3 font-medium">Producto</th><th class="px-4 py-3 font-medium">Formato</th><th class="px-4 py-3 text-right font-medium">Precio</th></tr>
      </thead>
      <tbody id="precios-cuerpo">${filas}
      </tbody>
    </table>${despues}
  </div>
  <p class="mono mt-3 text-center text-[10.5px] uppercase tracking-[0.12em] text-[color:var(--fg-faint)]">precios en MXN · envío aparte</p>
</section>

<!-- LO ÚLTIMO -->`;

const DECLARACION = '<script type="application/json" data-ol-stores>{"productos":{"visitante":"lectura","campos":{"producto":"texto","formato":"texto","precio":"numero"}}}</script>';
const PINTA = `<script>
// La lista de precios sale del almacén «productos», que publicar hornea en [data-ol-datos].
(function () {
  var cuerpo = document.getElementById("precios-cuerpo");
  function celda(texto, clase) { var td = document.createElement("td"); td.className = clase; td.textContent = texto; return td; }
  document.querySelectorAll('[data-ol-datos="productos"] [data-ol-fila]').forEach(function (fila) {
    function campo(n) { var s = fila.querySelector('[data-ol-campo="' + n + '"]'); return s ? s.textContent : ""; }
    var tr = document.createElement("tr");
    tr.className = "border-t hairline";
    tr.appendChild(celda(campo("producto"), "px-4 py-3"));
    tr.appendChild(celda(campo("formato"), "px-4 py-3 text-[color:var(--fg-muted)]"));
    tr.appendChild(celda("$" + campo("precio"), "px-4 py-3 text-right tabular"));
    cuerpo.appendChild(tr);
  });
})();
</script>`;

/** Las filas del almacén, como las escribiría Len en `/datos/productos.json`. */
async function llenarElAlmacen(s: Siembra, productos = PRODUCTOS): Promise<void> {
  // Import dinámico: cargar el juego (y sus pruebas) no arrastra la base.
  const { agregarDato } = await import("@/lib/page-data/agente");
  for (const [producto, formato, precio] of productos) {
    const r = await agregarDato({ projectId: s.projectId, userId: s.ownerId, almacen: "productos", doc: { producto, formato, precio } });
    if (!r.ok) throw new Error(`no se pudo llenar el almacén con «${producto}»: ${r.error}`);
  }
}

export function crear(dirPaginas: string): Encargo {
  const plantilla = fs.readFileSync(path.join(dirPaginas, "tabla-a-datos.plantilla.html"), "utf8");
  const inicio = cambiar(plantilla, [["<!-- LO ÚLTIMO -->", TABLA(PRODUCTOS.map(FILA).join(""))]]);
  const TABLA_ESCRITA = TABLA(PRODUCTOS.map(FILA).join(""));
  const conAlmacen = (tabla: string, script = PINTA) => cambiar(inicio, [[TABLA_ESCRITA, tabla], ["</main>", `</main>\n${DECLARACION}\n${script}`]]);
  const CONTENEDOR = '\n    <div data-ol-datos="productos" hidden></div>';
  const solucion = conAlmacen(TABLA("", CONTENEDOR));

  // Enteros: «Criaturas» a secas ya está en la bio («Ilustro criaturas»), y «Blandito» en el boletín.
  const nombres = PRODUCTOS.slice(1).map(([p]) => p);
  return {
    id: "tabla-a-datos",
    nivel: "N2",
    resumen: "Pasar los 8 productos de una tabla escrita a mano a un almacén, y que la tabla se pinte desde él.",
    inicio: { html: inicio },
    ficha: {
      negocio: "Ilustradora que vende brushes, stickers y prints por internet, en México",
      datos: {},
      gustos: ["quiere cambiar los precios sin tocar el html"],
    },
    guion: [
      {
        tipo: "pide",
        mensaje:
          "pasa los productos de la tabla de precios a un almacen de datos, para poder cambiar precios sin tocar el html, y que la tabla se pinte desde ahi. que se vea igual que ahorita",
      },
    ],
    graders: [
      enLaTabla(
        "productos-en-la-tabla",
        "/",
        // Sin distinguir mayúsculas: la cabecera va en mayúsculas por CSS, y así la devuelve `innerText`.
        /producto[\s\S]*precio/i,
        PRODUCTOS.map(([p, , precio]) => new RegExp(`${p.replace(/[.]/g, "\\.")}[\\s\\S]{0,60}\\$\\s?${precio}(?!\\d)`)),
      ),
      noEscritoEnElProyecto("sin-productos-escritos", nombres),
      // El link-in-bio sigue como estaba alrededor de la tabla.
      sigueAhi("sigue-el-perfil", "/", [/Ilustro criaturas blanditas/, /Brushes nuevos: "Peluche Vol\. 2"/, /Stream de proceso/, /Marcas y colaboraciones/]),
      nadaInventado(),
      sinCifrasInventadas(),
      sinDesbordeMovil(),
      enlacesInternosVan(),
    ],
    solucion: { html: solucion },
    solucionDespues: (s) => llenarElAlmacen(s),
    rotas: [
      // Declaró el almacén y lo llenó, pero la tabla sigue escrita a mano.
      { nombre: "tabla-sigue-escrita", datos: { html: cambiar(inicio, [["</main>", `</main>\n${DECLARACION}`]]) }, despues: (s) => llenarElAlmacen(s) },
      // Lo mismo, con los productos en un arreglo de JavaScript en vez de en el almacén.
      {
        nombre: "productos-en-un-arreglo",
        datos: {
          html: conAlmacen(
            TABLA(""),
            `<script>\n(function () {\n  var P = ${JSON.stringify(PRODUCTOS)};\n  var c = document.getElementById("precios-cuerpo");\n  P.forEach(function (x) { var tr = document.createElement("tr"); tr.innerHTML = "<td>" + x[0] + "</td><td>" + x[1] + "</td><td>$" + x[2] + "</td>"; c.appendChild(tr); });\n})();\n</script>`,
          ),
        },
      },
      // El contenedor horneado DENTRO del <tbody>: el navegador saca las filas fuera de la tabla.
      { nombre: "horneado-en-el-tbody", datos: { html: conAlmacen(TABLA("").replace('<tbody id="precios-cuerpo">', '<tbody id="precios-cuerpo" data-ol-datos="productos">'), "") }, despues: (s) => llenarElAlmacen(s) },
      // La página bien y el almacén vacío: la tabla sale sin filas.
      { nombre: "almacen-vacio", datos: { html: solucion } },
      // Uno se perdió por el camino.
      { nombre: "falta-un-producto", datos: { html: solucion }, despues: (s) => llenarElAlmacen(s, PRODUCTOS.filter(([p]) => p !== "Print Gato nube")) },
      { nombre: "quito-de-mas", datos: { html: cambiar(solucion, [['<div class="eyebrow">Marcas y colaboraciones</div>', ""]]) }, despues: (s) => llenarElAlmacen(s) },
      // Al pasarlo al almacén, un precio cambió: la tabla ya no dice lo que decía.
      {
        nombre: "precio-cambiado-en-el-almacen",
        datos: { html: solucion },
        despues: (s) => llenarElAlmacen(s, PRODUCTOS.map(([p, f, precio]) => [p, f, p === "Pin Blandito" ? 155 : precio] as const)),
      },
      // Lo que lee `nada-inventado` es el HTML servido, y ahí el precio horneado va sin «$»: el inventado, en la página.
      {
        nombre: "precio-inventado",
        datos: { html: cambiar(solucion, [["precios en MXN · envío aparte", "precios en MXN · envío gratis desde $500"]]) },
        despues: (s) => llenarElAlmacen(s),
      },
      { nombre: "desborda", datos: { html: cambiar(solucion, [["</footer>", '<div style="width:900px">x</div></footer>']]) }, despues: (s) => llenarElAlmacen(s) },
      { nombre: "enlace-roto", datos: { html: cambiar(solucion, [["</footer>", '<a href="/tienda/">Tienda</a></footer>']]) }, despues: (s) => llenarElAlmacen(s) },
    ],
  };
}
