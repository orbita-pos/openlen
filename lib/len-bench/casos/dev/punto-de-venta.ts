// lib/len-bench/casos/dev/punto-de-venta.ts — N3, F03/F01, sobre una página REAL
// de OpenLen (plantilla `miga`, panadería de barrio en España).
//
// La semilla de C5: «teclado que suma y botón Cobrar que registra». La caja
// va en una página aparte (/caja/) —el dueño lo pide así: no es para los
// clientes—, con un botón por producto de la vitrina, un «Cobrar» que apunta
// la venta y lo vendido en el día, que sobrevive a cerrar la página. La
// vitrina tiene OCHO productos (tres tarjetas y una lista de cinco). Lo mide
// `flujo` de punta a punta: dos ventas seguidas y una recarga (12,60 € sólo
// sale si las ventas se ACUMULAN; un ticket que no se vacía no llega ahí).
// Al volver, sube un precio que vive en DOS sitios: el texto de la vitrina y
// el precio con el que suma la caja, que no se ve.
import fs from "node:fs";
import path from "node:path";
import type { Encargo } from "@/lib/len-bench/tipos";
import { cambiar } from "@/lib/len-bench/casos/cambiar";
import {
  datosDeLaFicha,
  enlacesInternosVan,
  flujo,
  nadaInventado,
  paginasQueExisten,
  sigueAhi,
  sinCifrasInventadas,
  sinDesbordeMovil,
  yaNoAparece,
} from "@/lib/len-bench/graders";
import { enPagina, partirEnPaginas } from "@/lib/len-bench/casos/partir";

interface Caja {
  /** Con qué suma el croissant, y qué dice su botón. */
  readonly croissant?: { readonly suma: string; readonly dice: string };
  readonly extra?: string;
  readonly script?: boolean;
  readonly cobrarApunta?: boolean;
  readonly recuerda?: boolean;
}

const producto = (nombre: string, suma: string, dice: string) =>
  `    <button type="button" class="btn btn-ghost justify-between" style="height:auto;min-height:64px;padding:12px 22px" data-precio="${suma}">${nombre} <span class="price">${dice}&nbsp;€</span></button>\n`;

const caja = (o: Caja = {}) => `<!-- CAJA -->
<section id="caja" class="wrap" style="padding:48px 24px 72px">
  <span class="eyebrow">Mostrador</span>
  <h1 style="font-size:clamp(34px,6vw,54px);margin-top:10px">Caja</h1>
  <div class="grid gap-3 mt-8 sm:grid-cols-3">
${producto("Croissant de mantequilla", o.croissant?.suma ?? "2.50", o.croissant?.dice ?? "2,50")}${producto("Tarta de la casa", "3.80", "3,80")}${producto("Tortitas de brunch", "6.50", "6,50")}${producto("Pan de masa madre", "4.20", "4,20")}${producto("Baguette de campo", "1.80", "1,80")}${producto("Pain au chocolat", "2.40", "2,40")}${producto("Brioche trenzado", "5.90", "5,90")}${producto("Galletas de avena", "1.20", "1,20")}${o.extra ?? ""}  </div>
  <div class="flex flex-wrap items-center gap-4 mt-8">
    <p style="font-size:22px">Ticket: <strong id="ticket">0,00&nbsp;€</strong></p>
    <button type="button" id="cobrar" class="btn btn-primary">Cobrar</button>
    <button type="button" id="borrar" class="btn btn-ghost">Borrar ticket</button>
  </div>
  <p class="mt-6" style="color:var(--muted)">Vendido hoy: <strong id="hoy">0,00&nbsp;€</strong> en <span id="ventas">0</span> ventas</p>
</section>
${
  o.script === false
    ? ""
    : `<script>
(function () {
  var clave = "miga-caja-" + new Date().toISOString().slice(0, 10);
  var dia = ${o.recuerda === false ? "null" : 'JSON.parse(localStorage.getItem(clave) || "null")'} || { total: 0, ventas: 0 };
  var ticket = 0;
  function euros(n) { return n.toFixed(2).replace(".", ",") + " €"; }
  function pinta() {
    document.getElementById("ticket").textContent = euros(ticket);
    document.getElementById("hoy").textContent = euros(dia.total);
    document.getElementById("ventas").textContent = dia.ventas;
  }
  document.querySelectorAll("#caja [data-precio]").forEach(function (b) {
    b.addEventListener("click", function () { ticket = Math.round((ticket + Number(b.dataset.precio)) * 100) / 100; pinta(); });
  });
  document.getElementById("cobrar").addEventListener("click", function () {
    if (!ticket) return;
    ${o.cobrarApunta === false ? "" : "dia.total = Math.round((dia.total + ticket) * 100) / 100; dia.ventas++;"}
    ticket = 0;
    ${o.recuerda === false ? "" : "localStorage.setItem(clave, JSON.stringify(dia));"}
    pinta();
  });
  document.getElementById("borrar").addEventListener("click", function () { ticket = 0; pinta(); });
  pinta();
})();
</script>
`
}
`;

const VITRINA = (p: string) => `<h3 style="font-size:21px">Croissant de mantequilla</h3><span class="price" style="font-size:19px">${p}&nbsp;€</span>`;

export function crear(dirPaginas: string): Encargo {
  const inicio = fs.readFileSync(path.join(dirPaginas, "punto-de-venta.inicio.html"), "utf8");
  const sitio = (o: Caja & { vitrina?: string } = {}) =>
    partirEnPaginas(cambiar(inicio, [[VITRINA("2,20"), VITRINA(o.vitrina ?? "2,50")], ["<!-- FOOTER -->", `${caja(o)}<!-- FOOTER -->`]]), {
      cabeceraHasta: "<!-- HERO -->",
      pieDesde: "<!-- FOOTER -->",
      paginas: [
        { slug: "", title: "Inicio", trozos: [["<!-- HERO -->", "<!-- CAJA -->"]] },
        { slug: "caja", title: "Caja", trozos: [["<!-- CAJA -->", "<!-- FOOTER -->"]] },
      ],
    });
  const solucion = sitio();
  return {
    id: "punto-de-venta",
    nivel: "N3",
    resumen: "Una caja en una página aparte: botones que suman, «Cobrar» que apunta la venta y lo vendido en el día, que no se pierde; al volver, un precio que vive en la vitrina y en la caja.",
    inicio: { html: inicio },
    ficha: {
      negocio: "Panadería artesanal de barrio en España, con mostrador",
      datos: { precio_croissant: "2,50 €" },
      gustos: ["la caja es para el mostrador, no para los clientes"],
    },
    guion: [
      {
        tipo: "pide",
        mensaje:
          "hola! quiero usar la web como caja en el mostrador. hazme una pagina aparte, /caja, con un boton por cada cosa de la vitrina que vaya sumando, y un boton de cobrar que apunte la venta. y que se vea lo que llevo vendido en el dia aunque cierre la pagina",
      },
      { tipo: "vuelve", mensaje: "hemos subido el croissant a 2,50 €, cambialo porfa" },
    ],
    graders: [
      paginasQueExisten(["caja"]),
      // Por el nombre de la vitrina: la home trae un «Encargar una tarta» y el pie un «Tartas de boda».
      flujo("la-caja-suma-cobra-y-recuerda", "/caja/", [
        { pulsa: /croissant/i },
        { pulsa: /croissant/i },
        { pulsa: /tarta de la casa/i },
        { ve: /8[.,]80/ },
        // El botón que se pidió: «Cobrar», «Cobrar y apuntar», «Cobrar 8,80 €»
        // (revisión de E, 26/09: `^cobrar$` suspendía 2 de la rama y 2 del control).
        { pulsa: /^cobrar\b/i },
        { pulsa: /tarta de la casa/i },
        { pulsa: /^cobrar\b/i },
        { ve: /12[.,]60/ },
        { recarga: true },
        { ve: /12[.,]60/ },
      ]),
      datosDeLaFicha(["precio_croissant"]),
      yaNoAparece("sin-precio-viejo", "2,20 €"),
      // La caja es una página APARTE y sube un precio: la vitrina de la home,
      // con los demás precios, se queda.
      sigueAhi("sigue-la-vitrina", "/", [
        /Tarta de la casa\s*3,80\s*€/,
        /Tortitas de brunch\s*6,50\s*€/,
        /Pan de masa madre · 4,20\s*€/,
        /Galletas de avena · 1,20\s*€/,
      ]),
      nadaInventado(),
      sinCifrasInventadas(),
      sinDesbordeMovil(),
      enlacesInternosVan(),
    ],
    solucion,
    rotas: [
      // Una caja Potemkin: los botones están y no suman.
      { nombre: "caja-sin-codigo", datos: sitio({ script: false }) },
      { nombre: "quito-de-mas", datos: enPagina(solucion, "", [["Pan de masa madre · 4,20 €", ""]]) },
      { nombre: "cobrar-no-apunta", datos: sitio({ cobrarApunta: false }) },
      { nombre: "se-olvida-al-recargar", datos: sitio({ recuerda: false }) },
      // El botón dice 2,50 € y la caja suma con el precio de antes.
      { nombre: "precio-viejo-en-la-caja", datos: sitio({ croissant: { suma: "2.20", dice: "2,50" } }) },
      { nombre: "precio-viejo-en-la-vitrina", datos: sitio({ vitrina: "2,20" }) },
      // La caja en la página de todos, no aparte.
      {
        nombre: "caja-en-la-home",
        datos: { html: cambiar(inicio, [[VITRINA("2,20"), VITRINA("2,50")], ["<!-- FOOTER -->", `${caja()}<!-- FOOTER -->`]]) },
      },
      { nombre: "producto-inventado", datos: sitio({ extra: producto("Café con leche", "1.60", "1,60") }) },
      { nombre: "desborda", datos: enPagina(solucion, "caja", [["<!-- FOOTER -->", '<div style="width:900px">x</div><!-- FOOTER -->']]) },
      { nombre: "enlace-roto", datos: enPagina(solucion, "", [["<!-- FOOTER -->", '<a href="/pedidos/">Pedidos</a><!-- FOOTER -->']]) },
    ],
  };
}
