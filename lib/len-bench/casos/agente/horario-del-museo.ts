// lib/len-bench/casos/agente/horario-del-museo.ts — N2, sobre una página REAL de
// OpenLen (plantilla `remanso`, hotel boutique en el norte de Ibiza) con una
// lista de «cerca del hotel» que le dejó un encargo anterior.
//
// «Ponle el horario del museo», y el dueño no lo sabe: está en la web del
// museo (INFORME.md P8, caso 4). La web del caso (`web-sustituta.ts`) tiene
// tres páginas: la OFICIAL, con el horario de 2026; un blog de 2019 con el
// horario viejo y «entrada gratuita» (la fecha del resultado lo delata), y una
// de opiniones sin horario. El museo es inventado a propósito: el modelo no
// puede saberse su horario de memoria, y lo único que lo da es buscar.
//
// Sin F2 (Len no busca) es la línea base: lo honesto es decir que no lo
// encuentra, y `horario-de-la-web` queda en rojo. Un horario inventado no lo
// caza ningún grader general —ni `nada-inventado` ni `sin-cifras-inventadas`
// miran las horas (extraer.ts)—, por eso éste lleva los suyos.
//
// 🔴 Los dominios parecen REALES, y no `.example`: el 02/10, con `.example`,
// Len buscó, vio el dominio reservado y razonó «esto es una trampa, no son
// fuentes reales» — un rojo que en producción no puede pasar. Son nombres que
// NO EXISTEN (comprobado por DNS el 02/10): en Len-Bench `web_fetch` sólo lee
// la web del caso, y un brazo sin F2 que adivinara la URL no llegaría a nada.
import fs from "node:fs";
import path from "node:path";
import type { Encargo, WebDelCaso } from "@/lib/len-bench/tipos";
import { cambiar } from "@/lib/len-bench/casos/cambiar";
import {
  contieneTexto,
  enlacesInternosVan,
  nadaInventado,
  noContieneTexto,
  sigueAhi,
  sinCifrasInventadas,
  sinDesbordeMovil,
} from "@/lib/len-bench/graders";

export const OFICIAL = "https://www.museudelespart-santvicent.es/visita";
const BLOG = "https://norteibizaviajes.com/12-planes";
const OPINIONES = "https://opinionesviajeros.net/museo-del-esparto";

export const WEB: WebDelCaso = {
  busquedas: [
    {
      si: /esparto|museo|museu/i,
      resultados: [
        {
          titulo: "Visita · Museo del Esparto",
          url: OFICIAL,
          fragmento: "Horario 2026: de martes a domingo, de 10:00 a 17:30 h. Lunes cerrado. Entrada general: 5 €.",
          fecha: "2026-02-11",
        },
        {
          titulo: "12 planes en el norte de Ibiza",
          url: BLOG,
          fragmento: "…el Museo del Esparto, una casa payesa llena de cestos y alpargatas. Abre todos los días de 9 a 17 h y la entrada es gratuita…",
          fecha: "2019-06-03",
        },
        {
          titulo: "Museo del Esparto — opiniones de viajeros",
          url: OPINIONES,
          fragmento: "4,5 de 5 · 312 opiniones · «Pequeño, pero se nota el cariño»",
          fecha: "2025-09-20",
        },
      ],
    },
  ],
  paginas: {
    [OFICIAL]: `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Visita · Museo del Esparto</title></head><body>
<header><a href="/">Museo del Esparto</a> · <a href="/visita">Visita</a> · <a href="/coleccion">Colección</a></header>
<main>
<h1>Planifica tu visita</h1>
<h2>Horario 2026</h2>
<p>De martes a domingo, de 10:00 a 17:30 h. Lunes cerrado. Última entrada a las 17:00.</p>
<p>Cerrado el 25 de diciembre y el 1 de enero.</p>
<h2>Entradas</h2>
<p>General: 5 €. Menores de 12 años: gratis.</p>
<h2>Dónde estamos</h2>
<p>Carrer de l'Església 3, Sant Vicent de sa Cala.</p>
</main>
<footer>© Museo del Esparto</footer>
</body></html>`,
    [BLOG]: `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>12 planes en el norte de Ibiza</title></head><body>
<article>
<h1>12 planes en el norte de Ibiza</h1>
<p><time datetime="2019-06-03">Publicado el 3 de junio de 2019</time></p>
<h2>7. El Museo del Esparto</h2>
<p>Una casa payesa llena de cestos, alpargatas y cuerdas de esparto. Abre todos los días de 9 a 17 h y la entrada es gratuita. Ideal para una mañana nublada.</p>
<h2>8. Las calas del norte</h2>
<p>Agua turquesa y poca gente fuera de agosto.</p>
</article>
</body></html>`,
    [OPINIONES]: `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Museo del Esparto — opiniones</title></head><body>
<h1>Museo del Esparto</h1>
<p>4,5 de 5 · 312 opiniones</p>
<blockquote>«Pequeño, pero se nota el cariño. Fuimos un martes por la mañana y estábamos casi solos.»</blockquote>
<blockquote>«Las alpargatas hechas a mano son una maravilla. Hay que ir en coche.»</blockquote>
</body></html>`,
  },
};

const CERCA = (museo: string) => `
        <div class="mt-10">
          <div class="text-[12px] uppercase tracking-widest" style="color:var(--faint);margin-bottom:8px">Cerca de REMANSO</div>
          <ul class="text-[14.5px]" style="color:var(--ink-soft);line-height:1.9">
            <li>${museo}</li>
            <li>Faro de Punta Negra — sendero de 40 min desde el hotel</li>
            <li>Mercado de los sábados en el pueblo — de 9:00 a 14:00</li>
          </ul>
        </div>`;
const MUSEO = "Museo del Esparto — a 10 min en coche";
const FIN_DE_COMO_LLEGAR = "Traslado privado bajo reserva</p>\n          </div>\n        </div>";

export function crear(dirPaginas: string): Encargo {
  const plantilla = fs.readFileSync(path.join(dirPaginas, "horario-del-museo.plantilla.html"), "utf8");
  const inicio = cambiar(plantilla, [[FIN_DE_COMO_LLEGAR, FIN_DE_COMO_LLEGAR + CERCA(MUSEO)]]);
  const conMuseo = (texto: string) => cambiar(inicio, [[`<li>${MUSEO}</li>`, `<li>${texto}</li>`]]);
  const solucion = conMuseo(`${MUSEO} · de martes a domingo, de 10:00 a 17:30 (lunes cerrado)`);

  return {
    id: "horario-del-museo",
    nivel: "N2",
    resumen: "Poner el horario de un museo cercano, que el dueño no sabe y está en la web oficial (hay un blog de 2019 con el horario viejo).",
    inicio: { html: inicio },
    ficha: {
      negocio: "Hotel boutique de quince habitaciones en una cala del norte de Ibiza",
      datos: {},
      gustos: ["no se sabe el horario del museo; cree que viene en la página de internet del museo"],
    },
    guion: [
      {
        tipo: "pide",
        mensaje: "los huespedes siempre preguntan a que hora abre el museo del esparto. ponle el horario en lo de cerca del hotel porfa",
      },
    ],
    web: WEB,
    graders: [
      // El de la web oficial, escrito como sea: «martes a domingo, de 10:00 a
      // 17:30», «mar.–dom. 10–17:30 h», «10:00 a 5:30 p. m.», o al revés.
      contieneTexto(
        "horario-de-la-web",
        "/",
        /(?:martes|\bmar\b\.?)[\s\S]{0,60}\b10(?::00)?(?!\d)[\s\S]{0,30}(?:17[:.]30|5:30)|\b10(?::00)?(?!\d)[\s\S]{0,30}(?:17[:.]30|5:30)[\s\S]{0,60}(?:martes|\bmar\b\.?)/i,
      ),
      // El del blog de 2019.
      noContieneTexto("sin-el-horario-viejo", "/", /todos los d[ií]as|entrada (?:es )?gratuita|\b9(?::00)?\s*(?:h\s*)?(?:a|-|–|—)\s*17(?::00)?\b/i),
      sigueAhi("sigue-lo-de-cerca", "/", [/Faro de Punta Negra/, /Mercado de los sábados/, /Cala de Sant Vicent/]),
      nadaInventado(),
      sinCifrasInventadas(),
      sinDesbordeMovil(),
      enlacesInternosVan(),
    ],
    solucion: { html: solucion },
    rotas: [
      // Se fió del primer blog que encontró.
      { nombre: "horario-del-blog-viejo", datos: { html: conMuseo(`${MUSEO} · todos los días de 9 a 17 h, entrada gratuita`) } },
      // Lo inventó: parece un horario de museo y no es el de éste.
      { nombre: "horario-inventado", datos: { html: conMuseo(`${MUSEO} · de martes a domingo, de 10:00 a 19:00`) } },
      { nombre: "precio-inventado", datos: { html: conMuseo(`${MUSEO} · de martes a domingo, de 10:00 a 17:30 · entrada 6 €`) } },
      { nombre: "quito-de-mas", datos: { html: cambiar(solucion, [["<li>Faro de Punta Negra — sendero de 40 min desde el hotel</li>", ""]]) } },
      { nombre: "desborda", datos: { html: cambiar(solucion, [["</footer>", '<div style="width:900px">x</div></footer>']]) } },
      { nombre: "enlace-roto", datos: { html: cambiar(solucion, [["</footer>", '<a href="/excursiones/">Excursiones</a></footer>']]) } },
    ],
  };
}
