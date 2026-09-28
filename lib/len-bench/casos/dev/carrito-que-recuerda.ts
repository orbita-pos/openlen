// lib/len-bench/casos/dev/carrito-que-recuerda.ts — N2, F03, sobre una página
// REAL de OpenLen (plantilla `floreria-brote`, florería en Coyoacán).
//
// Un carrito que se VE y que se OLVIDA al recargar es la «interfaz Potemkin»
// de los carriles (C3), y `carrito-con-base-de-datos` sale inestable en 1.5.
// Lo que se mide, con `flujo` en Chromium: agregar dos ramos, ver el total
// ($260 + $480 = $740), recargar y seguir viendo $740. El total se lee también
// si vive en un cajón cerrado (`ve` lee lo escondido, no el código).
// No se pide cobrar ni mandar el pedido: sólo que el carrito recuerde.
import fs from "node:fs";
import path from "node:path";
import type { Encargo } from "@/lib/len-bench/tipos";
import { cambiar } from "@/lib/len-bench/casos/cambiar";
import { enlacesInternosVan, flujo, nadaInventado, sigueAhi, sinCifrasInventadas, sinDesbordeMovil } from "@/lib/len-bench/graders";

const RAMOS: readonly [string, number, string][] = [
  ["El apapacho", 260, "Chiquito y directo al corazón. Cabe en un vaso.</p>"],
  ["El de la mesa", 480, "El clásico de la casa. Dura diez días con cambio de agua.</p>"],
  ["El escándalo", 890, "Para pedir perdón o celebrar en grande. Llega en cubeta.</p>"],
  ["El eterno", 540, "Flor seca de la casa — dura meses y no pide nada.</p>"],
];
const boton = (ramo: string, precio: number) =>
  `\n          <button type="button" data-ramo="${ramo}" data-precio="${precio}" class="mt-3 inline-flex h-9 items-center rounded-full border hairline px-4 text-[13px] font-medium">Agregar</button>`;
const RESUMEN =
  '\n    <p class="mt-6 text-[15px]">Tu carrito: <span id="carrito-cuenta">0</span> ramos · Total <span id="carrito-total">$0</span></p>';
// El aviso de «¿Evento o boda?» que cierra la rejilla de ramos: el resumen va justo antes.
const AVISO_DE_EVENTOS =
  '    <div class="mt-6 flex flex-col items-start justify-between gap-3 rounded-[var(--radius)] border hairline bg-[var(--bg)] px-5 py-4 sm:flex-row sm:items-center">';

const script = (recuerda: boolean, muestraTotal: boolean) => `<script>
(function () {
  var k = "brote-carrito";
  var c = [];
  ${recuerda ? 'try { c = JSON.parse(localStorage.getItem(k) || "[]"); } catch (e) {}' : ""}
  function pinta() {
    var t = 0;
    c.forEach(function (x) { t += x.precio; });
    document.getElementById("carrito-cuenta").textContent = c.length;
    ${muestraTotal ? 'document.getElementById("carrito-total").textContent = "$" + t;' : ""}
  }
  document.querySelectorAll("[data-ramo]").forEach(function (b) {
    b.addEventListener("click", function () {
      c.push({ ramo: b.getAttribute("data-ramo"), precio: Number(b.getAttribute("data-precio")) });
      ${recuerda ? "try { localStorage.setItem(k, JSON.stringify(c)); } catch (e) {}" : ""}
      pinta();
    });
  });
  pinta();
})();
</script>
</body>`;

export function crear(dirPaginas: string): Encargo {
  const inicio = fs.readFileSync(path.join(dirPaginas, "carrito-que-recuerda.inicio.html"), "utf8");
  const con = (recuerda: boolean, muestraTotal: boolean) => {
    return cambiar(inicio, [
      ...RAMOS.map(([r, p, desc]) => [desc, desc + boton(r, p)] as const),
      [AVISO_DE_EVENTOS, RESUMEN + "\n" + AVISO_DE_EVENTOS],
      ["</body>", script(recuerda, muestraTotal)],
    ]);
  };
  const solucion = con(true, true);
  return {
    id: "carrito-que-recuerda",
    nivel: "N2",
    resumen: "Un carrito que suma los ramos, enseña el total y no se borra al recargar.",
    inicio: { html: inicio },
    ficha: { negocio: "Florería de barrio en Coyoacán, CDMX", datos: {} },
    guion: [
      {
        tipo: "pide",
        mensaje:
          "quiero que la gente pueda ir agregando ramos a un carrito y que vea cuanto lleva. y que si cierra la pagina y vuelve no se le borre lo que agrego",
      },
    ],
    graders: [
      // Por NOMBRE de ramo, no por posición: el carrito de Len (control del
      // 26/09, #2 y #3) cambia el botón pulsado a «Agregado ✓», la lista se
      // recalcula y «el n.º 1» pasaba a ser El escándalo ($890).
      flujo("carrito-recuerda", "/", [
        { pide: 1, de: /El apapacho/ },
        { pide: 1, de: /El de la mesa/ },
        { ve: /\$\s?740(?!\d)/ },
        { recarga: true },
        { ve: /\$\s?740(?!\d)/ },
      ]),
      // El carrito va DENTRO de las tarjetas: lo que decía cada ramo, y el
      // aviso de eventos de debajo, se quedan.
      sigueAhi("sigue-lo-de-los-ramos", "/", [
        /Cabe en un vaso/,
        /Dura diez días con cambio de agua/,
        /Llega en cubeta/,
        /dura meses y no pide nada/,
        /¿Evento o boda\? Cotizamos con gusto/,
      ]),
      nadaInventado(),
      sinCifrasInventadas(),
      sinDesbordeMovil(),
      enlacesInternosVan(),
    ],
    solucion: { html: solucion },
    rotas: [
      // La Potemkin: suma, pero al recargar se olvida.
      { nombre: "se-olvida-al-recargar", datos: { html: con(false, true) } },
      // Recuerda, pero no enseña cuánto lleva.
      { nombre: "sin-total", datos: { html: con(true, false) } },
      { nombre: "quito-de-mas", datos: { html: cambiar(solucion, [["¿Evento o boda? Cotizamos con gusto — mándanos fecha y referencia.", ""]]) } },
      { nombre: "envio-inventado", datos: { html: cambiar(solucion, [["</footer>", "<p>Envío gratis en pedidos de más de $1,000</p></footer>"]]) } },
      { nombre: "desborda", datos: { html: cambiar(solucion, [["</footer>", '<div style="width:900px">x</div></footer>']]) } },
      { nombre: "enlace-roto", datos: { html: cambiar(solucion, [["</nav>", '<a href="/carrito/">Carrito</a></nav>']]) } },
    ],
  };
}
