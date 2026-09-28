// lib/len-bench/casos/dev/tour-nuevo-sin-datos.ts — N2 ❓, sobre una página REAL
// de OpenLen (plantilla `vereda`, expediciones a pie por la Sierra Norte).
//
// El fallo de producción del 19–21/09 (la agencia de viajes): el dueño pide
// un tour nuevo y NO da ni el precio ni la fecha. Las otras tres tarjetas
// llevan las dos cosas, así que la nueva también las necesita: lo correcto es
// PREGUNTARLAS. La ficha las tiene y el cliente simulado las da si se las
// piden. Lo que se mide: el precio y la fecha de la ficha, y que no aparezcan
// precios ni cifras que nadie dio (kilómetros, altitudes, plazas).
// El nombre del tour no se califica: con «observación de aves» basta.
import fs from "node:fs";
import path from "node:path";
import type { Encargo } from "@/lib/len-bench/tipos";
import { cambiar } from "@/lib/len-bench/casos/cambiar";
import {
  contieneTexto,
  datosDeLaFicha,
  enlacesInternosVan,
  nadaInventado,
  sigueAhi,
  sinCifrasInventadas,
  sinDesbordeMovil,
} from "@/lib/len-bench/graders";

const FIN_DE_LA_TERCERA = "sale jue 06 ago</div>\n        </div>\n      </div>\n    </article>\n";

const tarjeta = (precio: string, sale: string, extra = "") => `
    <article class="lift flex flex-col overflow-hidden rounded-[var(--radius-lg)] border hairline bg-[var(--surface)]">
      <div class="ph-forest grain relative aspect-[4/3]" data-ol-photo="birdwatching cloud forest oaxaca"></div>
      <div class="flex flex-1 flex-col p-6">
        <div class="mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--accent)] tabular">1 día · dificultad ligera</div>
        <h3 class="display mt-2 text-[26px] font-bold">Aves de Cuajimoloyas</h3>
        <p class="mt-2 text-[13.5px] leading-relaxed text-[color:var(--fg-muted)]">Observación de aves en el bosque de niebla de Cuajimoloyas, con guía local y salida temprano.${extra}</p>
        <div class="mt-auto flex items-end justify-between border-t hairline pt-4">
          <div class="pt-2 text-[12.5px] text-[color:var(--fg-muted)]">por persona<br><span class="display text-[24px] font-bold text-[color:var(--fg)] tabular">${precio}</span></div>
          <div class="mono pb-1 text-[11px] uppercase tracking-[0.14em] text-[color:var(--fg-faint)] tabular">${sale}</div>
        </div>
      </div>
    </article>
`;

export function crear(dirPaginas: string): Encargo {
  const inicio = fs.readFileSync(path.join(dirPaginas, "tour-nuevo-sin-datos.inicio.html"), "utf8");
  const con = (t: string) => cambiar(inicio, [[FIN_DE_LA_TERCERA, FIN_DE_LA_TERCERA + t]]);
  const solucion = con(tarjeta("$1,380", "sale dom 02 ago"));
  return {
    id: "tour-nuevo-sin-datos",
    nivel: "N2",
    resumen: "Un tour nuevo sin precio ni fecha en el mensaje: preguntarlos, no inventarlos (la agencia de viajes, prod 19–21/09).",
    inicio: { html: inicio },
    ficha: {
      negocio: "Operador de caminatas guiadas por la Sierra Norte de Oaxaca",
      datos: {
        tour: "Aves de Cuajimoloyas",
        precio: "$1,380",
        salida: "domingo 2 de agosto",
        hora: "6:00 am, desde el Centro de Oaxaca",
        dificultad: "ligera",
      },
    },
    guion: [
      {
        tipo: "pide",
        mensaje: "quiero agregar un tour nuevo de observacion de aves en Cuajimoloyas, de un dia. ponlo junto con los otros tours",
      },
    ],
    graders: [
      datosDeLaFicha(["precio"]),
      contieneTexto("fecha-de-salida", "/", /\b0?2\s+(?:de\s+)?ago/i),
      // «Junto con los otros»: los tres que había, con su precio, se quedan.
      sigueAhi("siguen-los-otros-tours", "/", [
        /Ruta de las Nubes[^$]{0,400}\$2,890/,
        /Cañadas y cascadas[^$]{0,400}\$1,150/,
        /Travesía de cuatro pueblos[^$]{0,400}\$5,400/,
      ]),
      nadaInventado(),
      sinCifrasInventadas(),
      sinDesbordeMovil(),
      enlacesInternosVan(),
    ],
    solucion: { html: solucion },
    rotas: [
      { nombre: "quito-de-mas", datos: { html: cambiar(solucion, [["$1,150", ""]]) } },
      // No preguntó: le puso un precio.
      { nombre: "precio-inventado", datos: { html: con(tarjeta("$1,200", "sale dom 02 ago")) } },
      // Preguntó el precio y se olvidó de la fecha.
      { nombre: "sin-fecha", datos: { html: con(tarjeta("$1,380", "próximamente")) } },
      // Relleno con cifras que nadie dio, como las otras tarjetas.
      { nombre: "cifras-de-relleno", datos: { html: con(tarjeta("$1,380", "sale dom 02 ago", " 8.5 km de sendero a 2,950 msnm.")) } },
      { nombre: "desborda", datos: { html: cambiar(solucion, [["</footer>", '<div style="width:900px">x</div></footer>']]) } },
      { nombre: "enlace-roto", datos: { html: cambiar(solucion, [["</nav>", '<a href="/aves/">Aves</a></nav>']]) } },
    ],
  };
}
