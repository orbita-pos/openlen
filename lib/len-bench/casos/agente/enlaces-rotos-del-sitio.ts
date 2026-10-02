// lib/len-bench/casos/agente/enlaces-rotos-del-sitio.ts — N2, sobre un sitio de
// CUATRO páginas partido de una plantilla REAL de OpenLen (`vuelta`, club de
// corredores en la Condesa): inicio (héroe, testimonio y «únete»), /entrenos/,
// /carreras/ y /la-manada/, con una fila de menú encima del pie en todas.
//
// «Revisa que ningún enlace del sitio lleve a una página que no existe y
// arréglalos.» Es la tarea típica de desarrollador que se hace con `grep`
// (INFORME.md P8): la partida trae CINCO enlaces rotos, como los dejarían
// encargos anteriores, y cada uno tiene un destino claro —
//   · el menú del pie (en las 4 páginas): «Carreras» a /carrera/ (errata) y
//     «La manada» a /manada/ (el nombre viejo de la página);
//   · el héroe: «Ver entrenos» a /entrenamientos/ (nombre viejo);
//   · /carreras/: «Cómo entrenamos la larga» a /entrenos/#la-larga, un ancla
//     que esa página no tiene (la página existe: un enlace roto «a medias»);
//   · /la-manada/: «Ven a correr con nosotros» a /unete.html, que no existe:
//     «únete» es una sección de la portada.
// Los cuatro primeros llevan a la PORTADA sin avisar (memoria
// `caddy-broken-links-serve-home`): por eso «me dijeron que algunos botones
// mandan a la portada».
//
// Borrar los enlaces rotos no es arreglarlos: lo ve `enlaces-van-a-su-pagina`.
// Los `href="#"` de la plantilla (Instagram, Strava, el grupo de WhatsApp) no
// llevan a ninguna PÁGINA: no son de este encargo y no se califican aquí.
import fs from "node:fs";
import path from "node:path";
import type { Encargo } from "@/lib/len-bench/tipos";
import { cambiar } from "@/lib/len-bench/casos/cambiar";
import { enPagina, enTodas, partirEnPaginas } from "@/lib/len-bench/casos/partir";
import {
  enlacesInternosVan,
  enlacesVanASuPagina,
  nadaInventado,
  ningunEnlaceRoto,
  paginasQueExisten,
  sigueAhi,
  sinCifrasInventadas,
  sinDesbordeMovil,
} from "@/lib/len-bench/graders";

const MENU = (carreras: string, manada: string) =>
  '<nav class="mx-auto flex max-w-6xl flex-wrap gap-x-6 gap-y-2 border-t hairline px-5 pt-8 text-[13px] font-medium">' +
  `<a href="/">Inicio</a><a href="/entrenos/">Entrenos</a><a href="${carreras}">Carreras</a><a href="${manada}">La manada</a></nav>`;
const LA_LARGA = (href: string) =>
  `\n    <a href="${href}" class="mt-6 inline-flex text-[14px] font-medium underline underline-offset-4">Cómo entrenamos la larga →</a>`;
const VEN = (href: string) =>
  `\n        <a href="${href}" class="btn-primary lift mt-8 inline-flex h-11 items-center rounded-[var(--radius-sm)] px-6 text-[13.5px] font-semibold uppercase tracking-wide">Ven a correr con nosotros</a>`;
const NOTA_DEL_MARATON = "*los del maratón entrenan la larga extendida desde julio · porras garantizadas para todos</div>";
const FIN_DE_LAS_REGLAS = "Domingo sin sobremesa no cuenta como larga.</p>\n          </li>\n        </ul>";

export function crear(dirPaginas: string): Encargo {
  const plantilla = fs.readFileSync(path.join(dirPaginas, "enlaces-rotos-del-sitio.plantilla.html"), "utf8");
  const conLoRoto = cambiar(plantilla, [
    ["<!-- FOOTER -->", `<!-- FOOTER -->\n${MENU("/carrera/", "/manada/")}`],
    ['<a href="#entrenos" class="lift inline-flex h-11', '<a href="/entrenamientos/" class="lift inline-flex h-11'],
    [NOTA_DEL_MARATON, NOTA_DEL_MARATON + LA_LARGA("/entrenos/#la-larga")],
    [FIN_DE_LAS_REGLAS, FIN_DE_LAS_REGLAS + VEN("/unete.html")],
  ]);
  const inicio = partirEnPaginas(conLoRoto, {
    cabeceraHasta: "<!-- HERO FULL-BLEED ACCIÓN -->",
    pieDesde: "<!-- FOOTER -->",
    paginas: [
      { slug: "", title: "Inicio", trozos: [["<!-- HERO FULL-BLEED ACCIÓN -->", "<!-- ENTRENOS -->"], ["<!-- CITA -->", "<!-- FOOTER -->"]] },
      { slug: "entrenos", title: "Entrenos", trozos: [["<!-- ENTRENOS -->", "<!-- CARRERAS -->"]] },
      { slug: "carreras", title: "Carreras", trozos: [["<!-- CARRERAS -->", "<!-- LA MANADA -->"]] },
      { slug: "la-manada", title: "La manada", trozos: [["<!-- LA MANADA -->", "<!-- CITA -->"]] },
    ],
  });

  const conMenu = (carreras: string, manada: string) => enTodas(inicio, [[MENU("/carrera/", "/manada/"), MENU(carreras, manada)]]);
  const arreglado = (o: { menu?: boolean; heroe?: boolean; larga?: string; ven?: string } = {}) => {
    let d = o.menu === false ? inicio : conMenu("/carreras/", "/la-manada/");
    if (o.heroe !== false) d = enPagina(d, "", [['<a href="/entrenamientos/" class="lift', '<a href="/entrenos/" class="lift']]);
    d = enPagina(d, "carreras", [[LA_LARGA("/entrenos/#la-larga"), LA_LARGA(o.larga ?? "/entrenos/")]]);
    return enPagina(d, "la-manada", [[VEN("/unete.html"), VEN(o.ven ?? "/#unete")]]);
  };
  const solucion = arreglado();
  const sinCarreras = { ...solucion, pages: { ...solucion.pages } };
  delete sinCarreras.pages?.carreras;

  return {
    id: "enlaces-rotos-del-sitio",
    nivel: "N2",
    resumen: "Sitio de 4 páginas con 5 enlaces rotos (menú del pie, héroe, un ancla de otra página, un .html): llevarlos a su página, no borrarlos.",
    inicio,
    ficha: {
      negocio: "Club de corredores en la Condesa, Ciudad de México",
      datos: {},
      gustos: ["prefiere que cada enlace lleve a la página que toca antes que quitarlo", "no quiere páginas nuevas"],
    },
    guion: [
      {
        tipo: "pide",
        mensaje: "oye, revisa que ningun enlace del sitio lleve a una pagina que no existe y arreglalos porfa. me dijeron que algunos botones te mandan a la portada",
      },
    ],
    graders: [
      ningunEnlaceRoto(),
      enlacesVanASuPagina([
        { texto: /^Carreras$/, ruta: "/carreras/" },
        { texto: /^La manada$/, ruta: "/la-manada/" },
        { texto: /^Ver entrenos$/, ruta: "/entrenos/" },
        { texto: /Cómo entrenamos la larga/, ruta: "/entrenos/" },
        { texto: /Ven a correr con nosotros/, ruta: "/" },
      ]),
      paginasQueExisten(["entrenos", "carreras", "la-manada"]),
      // Arreglar enlaces no toca lo que hay al lado.
      sigueAhi("sigue-el-calendario", "/carreras/", [/21K Bosque de Tlalpan/, /Carrera del Grito/, /Maratón de la CDMX/]),
      sigueAhi("siguen-los-entrenos", "/entrenos/", [/Intervalos/, /Rodada nocturna/, /La larga/, /Plan con coach · \$890\/mes/]),
      nadaInventado(),
      sinCifrasInventadas(),
      sinDesbordeMovil(),
      enlacesInternosVan(),
    ],
    solucion,
    rotas: [
      // Arregló la página del enlace y no el ancla: sigue sin llevar a la larga.
      { nombre: "sigue-el-ancla-rota", datos: arreglado({ larga: "/entrenos/#la-larga" }) },
      // El menú del pie, arreglado sólo en la portada: las otras 3 páginas siguen rotas.
      { nombre: "menu-arreglado-en-una-sola", datos: enPagina(arreglado({ menu: false }), "", [[MENU("/carrera/", "/manada/"), MENU("/carreras/", "/la-manada/")]]) },
      { nombre: "heroe-sin-arreglar", datos: arreglado({ heroe: false }) },
      // Los borró en vez de arreglarlos: ya no hay rotos, ni camino.
      {
        nombre: "quito-los-rotos",
        datos: enPagina(
          enPagina(enPagina(enTodas(inicio, [['<a href="/carrera/">Carreras</a><a href="/manada/">La manada</a>', ""]]), "", [['<a href="/entrenamientos/" class="lift inline-flex h-11 items-center rounded-[var(--radius-sm)] border border-white/35 px-6 text-[13.5px] font-medium text-white hover:bg-white/10">Ver entrenos</a>', ""]]), "carreras", [
            [LA_LARGA("/entrenos/#la-larga"), ""],
          ]),
          "la-manada",
          [[VEN("/unete.html"), ""]],
        ),
      },
      // Lo llevó a una página que existe, pero no a la suya.
      { nombre: "a-otra-pagina", datos: arreglado({ ven: "/carreras/" }) },
      { nombre: "sin-la-pagina-de-carreras", datos: sinCarreras },
      { nombre: "quito-de-mas", datos: enPagina(solucion, "carreras", [[filaDe(solucion.pages?.carreras?.html ?? "", "Carrera del Grito"), ""]]) },
      { nombre: "entrenos-tocados", datos: enPagina(solucion, "entrenos", [["Rodada nocturna", "Rodada"]]) },
      { nombre: "precio-inventado", datos: enPagina(solucion, "entrenos", [["$890/mes", "$950/mes"]]) },
      { nombre: "desborda", datos: enPagina(solucion, "la-manada", [["<!-- FOOTER -->", '<div style="width:900px">x</div><!-- FOOTER -->']]) },
      { nombre: "enlace-roto", datos: enTodas(solucion, [["<a href=\"/la-manada/\">La manada</a></nav>", '<a href="/la-manada/">La manada</a><a href="/tienda/">Tienda</a></nav>']]) },
    ],
  };
}

/** La fila entera de la tabla de carreras que nombra `carrera`. */
function filaDe(html: string, carrera: string): string {
  const m = html.indexOf(`>${carrera}</td>`);
  if (m < 0) throw new Error(`no encontré la carrera «${carrera}»`);
  return html.slice(html.lastIndexOf("<tr>", m), html.indexOf("</tr>", m) + "</tr>".length);
}
