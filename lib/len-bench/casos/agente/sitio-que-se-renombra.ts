// lib/len-bench/casos/agente/sitio-que-se-renombra.ts — N3, sobre un sitio de
// CUATRO páginas partido de una plantilla REAL de OpenLen (`marejada`, hostal
// de surf en Sayulita): inicio (héroe y reseñas), /cuartos/, /la-casa/ y
// /surf/, con la misma cabecera, la misma llamada final y el mismo pie.
//
// El hostal cambia de nombre y de calle. El nombre vive en cada página en el
// <title>, el logo del menú, el pie (dos veces) y los datos estructurados del
// <head>, y además en el script de reservas, que arma el mensaje de WhatsApp
// con él: ~28 sitios en 4 ficheros. Es el encargo de «cámbialo en todo el
// sitio» de las grabaciones (`b9ff5b4a`, fase 1 §2 de plans/len-agente-2026):
// Grep → muchos Edit → los de ficheros no leídos, rechazados. Lo que este caso
// añade a `nombre-nuevo` y `sitio-que-se-muda` es para qué está: el README de
// la corrida saca de él los PASOS, los segundos y los `Edit` fallidos, que es
// donde se espera la ganancia de la terminal (F1).
//
// La partida trae lo que dejaría un encargo anterior (el `scaffold_script` del
// corredor de Claude Code): el script de reservas, el enlace de WhatsApp del
// pie y los datos estructurados. Lo que NO se califica: «a 90 pasos del break»
// puede dejar de ser verdad con la mudanza; nadie lo pidió.
import fs from "node:fs";
import path from "node:path";
import type { Encargo } from "@/lib/len-bench/tipos";
import { cambiar, type Cambio } from "@/lib/len-bench/casos/cambiar";
import { enPagina, enTodas, partirEnPaginas } from "@/lib/len-bench/casos/partir";
import {
  datosDeLaFicha,
  enCadaPagina,
  enlacesInternosVan,
  flujo,
  nadaInventado,
  paginasQueExisten,
  sigueAhi,
  sinCifrasInventadas,
  sinDesbordeMovil,
  yaNoAparece,
} from "@/lib/len-bench/graders";

const WHATSAPP = "523221234567";
const DATOS_ESTRUCTURADOS = (nombre: string, calle: string) =>
  `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Hostel","name":"${nombre}","telephone":"+52 322 123 4567",` +
  `"address":{"@type":"PostalAddress","streetAddress":"${calle}","addressLocality":"Sayulita","addressRegion":"Nayarit","addressCountry":"MX"}}</script>`;
const RESERVAS = (negocio: string) => `<script>
// Reservas por WhatsApp: el mensaje ya lleva el nombre del hostal.
(function () {
  var NEGOCIO = "${negocio}";
  var WHATSAPP = "${WHATSAPP}";
  var texto = "Hola, " + NEGOCIO + ": quiero reservar una cama.";
  document.querySelectorAll("[data-reserva]").forEach(function (a) {
    a.href = "https://wa.me/" + WHATSAPP + "?text=" + encodeURIComponent(texto);
  });
})();
</script>
</body>`;

export function crear(dirPaginas: string): Encargo {
  const plantilla = fs.readFileSync(path.join(dirPaginas, "sitio-que-se-renombra.plantilla.html"), "utf8");
  const conLoDeAntes = cambiar(plantilla, [
    ["Sayulita, Nayarit.\">", `Sayulita, Nayarit.">\n${DATOS_ESTRUCTURADOS("Marejada", "Calle Pelícanos 12")}`],
    ['<a id="reservar" href="#" class=', '<a id="reservar" href="#" data-reserva class='],
    [
      '<a href="#" class="lift inline-flex h-11 items-center rounded-full bg-[var(--bg)]',
      '<a href="#" data-reserva class="lift inline-flex h-11 items-center rounded-full bg-[var(--bg)]',
    ],
    ['<a href="#" class="hover:text-[color:var(--fg)]">WhatsApp</a>', `<a href="https://wa.me/${WHATSAPP}" class="hover:text-[color:var(--fg)]">WhatsApp</a>`],
    ["</body>", RESERVAS("Hostal Marejada")],
  ]);
  const inicio = partirEnPaginas(conLoDeAntes, {
    cabeceraHasta: "<!-- HERO EDITORIAL SPLIT -->",
    pieDesde: "<!-- FOOTER LOCAL -->",
    paginas: [
      { slug: "", title: "Inicio", trozos: [["<!-- HERO EDITORIAL SPLIT -->", "<!-- CUARTOS -->"], ["<!-- RESEÑAS -->", "<!-- FOOTER LOCAL -->"]] },
      { slug: "cuartos", title: "Cuartos", trozos: [["<!-- CUARTOS -->", "<!-- LA CASA -->"], ["<!-- CTA FULL-BLEED -->", "<!-- FOOTER LOCAL -->"]] },
      { slug: "la-casa", title: "La casa", trozos: [["<!-- LA CASA -->", "<!-- SURF -->"], ["<!-- CTA FULL-BLEED -->", "<!-- FOOTER LOCAL -->"]] },
      { slug: "surf", title: "Surf", trozos: [["<!-- SURF -->", "<!-- RESEÑAS -->"], ["<!-- CTA FULL-BLEED -->", "<!-- FOOTER LOCAL -->"]] },
    ],
  });

  // Lo que cambia en CADA una de las 4 páginas.
  const NOMBRE: Cambio[] = [
    ["<title>Marejada — ", "<title>Casa Oleaje — "],
    ['<span class="display text-[18px]">Marejada</span>', '<span class="display text-[18px]">Casa Oleaje</span>'],
    ["Marejada · hostal frente al break", "Casa Oleaje · hostal frente al break"],
    ["© 2026 Marejada", "© 2026 Casa Oleaje"],
  ];
  const CALLE: Cambio[] = [["Calle Pelícanos 12, Sayulita, Nay.", "Calle Gaviotas 7, Sayulita, Nay."]];
  const ESTRUCTURADOS: Cambio[] = [[DATOS_ESTRUCTURADOS("Marejada", "Calle Pelícanos 12"), DATOS_ESTRUCTURADOS("Casa Oleaje", "Calle Gaviotas 7")]];
  const SCRIPT: Cambio[] = [['var NEGOCIO = "Hostal Marejada";', 'var NEGOCIO = "Casa Oleaje";']];
  const hecho = (...grupos: Cambio[][]) => enTodas(inicio, grupos.flat());
  const solucion = hecho(NOMBRE, CALLE, ESTRUCTURADOS, SCRIPT);

  const sinSurf = { ...solucion, pages: { ...solucion.pages } };
  delete sinSurf.pages?.surf;

  return {
    id: "sitio-que-se-renombra",
    nivel: "N3",
    resumen: "Sitio de 4 páginas: nombre y calle nuevos en todas partes (título, menú, pie, datos estructurados y el script de reservas).",
    inicio,
    ficha: {
      negocio: "Hostal de surf en Sayulita, Nayarit",
      datos: { nombre: "Casa Oleaje", direccion: "Gaviotas 7" },
    },
    guion: [
      {
        tipo: "pide",
        mensaje:
          "le cambiamos el nombre al hostal: ya no es Marejada, ahora se llama Casa Oleaje. y nos mudamos a la calle Gaviotas 7, aqui mismo en Sayulita. cambialo en todo el sitio porfa, que no quede nada del nombre viejo",
      },
    ],
    graders: [
      datosDeLaFicha(["nombre", "direccion"]),
      // El FICHERO: también el <title>, los datos estructurados y el script.
      yaNoAparece("sin-el-nombre-viejo", ["Marejada"]),
      yaNoAparece("sin-la-calle-vieja", ["Pelícanos 12"]),
      enCadaPagina("nombre-nuevo-en-cada-pagina", /Casa Oleaje/),
      // El script de reservas, en el navegador: el mensaje lleva el nombre nuevo.
      flujo("la-reserva-lleva-el-nombre-nuevo", "/cuartos/", [
        { pulsa: /Reserva por WhatsApp/ },
        { abre: new RegExp(`wa\\.me/${WHATSAPP}\\?text=.*Casa Oleaje`) },
      ]),
      paginasQueExisten(["cuartos", "la-casa", "surf"]),
      sigueAhi("siguen-los-cuartos", "/cuartos/", [/Cama en dorm mixto[\s\S]*\$380/, /Dorm de mujeres[\s\S]*\$420/, /Privada con terraza[\s\S]*\$1,350/]),
      nadaInventado(),
      sinCifrasInventadas(),
      sinDesbordeMovil(),
      enlacesInternosVan(),
    ],
    solucion,
    rotas: [
      // Cambió lo que se ve y dejó el script: el mensaje de WhatsApp saluda al hostal viejo.
      { nombre: "nombre-viejo-en-el-script", datos: hecho(NOMBRE, CALLE, ESTRUCTURADOS) },
      // Cambió el <body> y no el <head> de una página.
      { nombre: "titulo-viejo-en-surf", datos: enPagina(solucion, "surf", [["<title>Casa Oleaje — ", "<title>Marejada — "]]) },
      // Lo que no se ve: los datos estructurados que lee Google.
      { nombre: "datos-estructurados-viejos", datos: hecho(NOMBRE, CALLE, SCRIPT) },
      { nombre: "calle-vieja-en-la-casa", datos: enPagina(solucion, "la-casa", [["Calle Gaviotas 7, Sayulita, Nay.", "Calle Pelícanos 12, Sayulita, Nay."]]) },
      // «Renombrar» borrando la marca de una página.
      {
        nombre: "surf-sin-nombre",
        datos: enPagina(solucion, "surf", [
          ["<title>Casa Oleaje — ", "<title>"],
          ['<span class="display text-[18px]">Casa Oleaje</span>', '<span class="display text-[18px]"></span>'],
          ["Casa Oleaje · hostal frente al break", "Hostal frente al break"],
          ["© 2026 Casa Oleaje", "© 2026"],
        ]),
      },
      { nombre: "sin-la-pagina-de-surf", datos: sinSurf },
      { nombre: "quito-de-mas", datos: enPagina(solucion, "cuartos", [[cuarto(solucion.pages?.cuartos?.html ?? "", "Dorm de mujeres"), ""]]) },
      { nombre: "precio-inventado", datos: enPagina(solucion, "cuartos", [["$980", "$1,050"]]) },
      { nombre: "desborda", datos: enPagina(solucion, "la-casa", [["<!-- FOOTER LOCAL -->", '<div style="width:900px">x</div><!-- FOOTER LOCAL -->']]) },
      { nombre: "enlace-roto", datos: enPagina(solucion, "", [["<!-- FOOTER LOCAL -->", '<a href="/tarifas/">Tarifas</a><!-- FOOTER LOCAL -->']]) },
    ],
  };
}

/** El <li> entero del cuarto que se llama `nombre`. */
function cuarto(html: string, nombre: string): string {
  const m = html.indexOf(`>${nombre}</div>`);
  if (m < 0) throw new Error(`no encontré el cuarto «${nombre}»`);
  const a = html.lastIndexOf("<li", m);
  return html.slice(a, html.indexOf("</li>", m) + "</li>".length);
}
