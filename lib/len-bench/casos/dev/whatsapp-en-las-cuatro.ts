// lib/len-bench/casos/dev/whatsapp-en-las-cuatro.ts — N3, sobre un sitio de CUATRO
// páginas partido de una plantilla REAL de OpenLen (`riva-dental`): inicio
// (héroe y cómo trabajo), /tratamientos/, /sobre-mi/ y /ubicacion/, con el
// mismo menú y el mismo pie en todas.
//
// El testigo de 1.5 es `telefono-en-las-cuatro`: 3 de 4 páginas, tope
// agotado, sin proponer objetivo. Aquí, además, el encargo vuelve dos veces:
// el horario del sábado (una página) y el precio de la valoración, que sale
// en DOS páginas (la home y la llamada final de /ubicacion/). Lo que se mide:
// que TODO botón de WhatsApp de las 4 páginas vaya, y que lo viejo no quede
// en ninguna.
import fs from "node:fs";
import path from "node:path";
import type { Encargo } from "@/lib/len-bench/tipos";
import { cambiar } from "@/lib/len-bench/casos/cambiar";
import {
  botonesDeWhatsAppVan,
  contieneTexto,
  datosDeLaFicha,
  enlacesInternosVan,
  nadaInventado,
  paginasQueExisten,
  sigueAhi,
  sinCifrasInventadas,
  sinDesbordeMovil,
  yaNoAparece,
} from "@/lib/len-bench/graders";
import { enPagina, enTodas, partirEnPaginas } from "@/lib/len-bench/casos/partir";

const WA = "https://wa.me/522223456789";
const PIE = (href: string) => `<a href="${href}" class="hover:text-[color:var(--fg)]">WhatsApp</a>`;
const SABADO = (h: string) => `<span class="text-[color:var(--fg-muted)]">Sábado</span><span>9:00 am – ${h}</span>`;

/** La etiqueta de apertura del último `<a href="#">` antes de `texto`. */
function abridorAntesDe(html: string, texto: string): string {
  const fin = html.indexOf(texto);
  const ini = html.lastIndexOf('<a href="#"', fin);
  if (fin < 0 || ini < 0) throw new Error(`no encontré «${texto}» dentro de un <a href="#">`);
  return html.slice(ini, html.indexOf(">", ini) + 1);
}

export function crear(dirPaginas: string): Encargo {
  // La sección de la doctora no traía id ni enlace en el menú: sin ellos, su
  // página sería inalcanzable ya en la partida.
  const plantilla = cambiar(fs.readFileSync(path.join(dirPaginas, "whatsapp-en-las-cuatro.inicio.html"), "utf8"), [
    ['<!-- LA DRA + CONSULTORIO -->\n<section class="border-t hairline', '<!-- LA DRA + CONSULTORIO -->\n<section id="dra" class="border-t hairline'],
    [
      '<a href="#ubicacion" class="hover:text-[color:var(--fg)]">Ubicación</a>',
      '<a href="#dra" class="hover:text-[color:var(--fg)]">Sobre mí</a>\n      <a href="#ubicacion" class="hover:text-[color:var(--fg)]">Ubicación</a>',
    ],
  ]);
  const inicio = partirEnPaginas(plantilla, {
    cabeceraHasta: "<!-- HERO CENTRADO",
    pieDesde: "<!-- FOOTER LOCAL -->",
    paginas: [
      { slug: "", title: "Inicio", trozos: [["<!-- HERO CENTRADO", "<!-- TRATAMIENTOS -->"]] },
      { slug: "tratamientos", title: "Tratamientos", trozos: [["<!-- TRATAMIENTOS -->", "<!-- LA DRA + CONSULTORIO -->"]] },
      { slug: "sobre-mi", title: "Sobre mí", trozos: [["<!-- LA DRA + CONSULTORIO -->", "<!-- UBICACIÓN -->"]] },
      { slug: "ubicacion", title: "Ubicación", trozos: [["<!-- UBICACIÓN -->", "<!-- FOOTER LOCAL -->"]] },
    ],
  });
  const agenda = abridorAntesDe(inicio.pages?.ubicacion?.html ?? "", "Agenda por WhatsApp");
  const conWhatsApp = (pie: string, agendaHref: string) =>
    enPagina(enTodas(inicio, [[PIE("#"), PIE(pie)]]), "ubicacion", [[agenda, agenda.replace('href="#"', `href="${agendaHref}"`)]]);
  const conSabado = (d: typeof inicio, h: string) => enPagina(d, "ubicacion", [[SABADO("2:00 pm"), SABADO(h)]]);
  // Por el texto visible: el <meta description> de la cabecera (en las 4) también dice «por $350».
  // La solución lo cambia también («donde salga» incluye lo que enseña Google),
  // aunque ningún grader lee el `content` de un <meta>.
  const conPrecio = (d: typeof inicio, en: "todas" | "solo-home") => {
    const home = enPagina(d, "", [
      ["Agenda tu valoración · $350", "Agenda tu valoración · $400"],
      ["Valoración completa · $350", "Valoración completa · $400"],
    ]);
    return en === "todas"
      ? enTodas(enPagina(home, "ubicacion", [["por $350 — y sales", "por $400 — y sales"]]), [["radiografía por $350,", "radiografía por $400,"]])
      : home;
  };
  const solucion = conPrecio(conSabado(conWhatsApp(WA, WA), "1:00 pm"), "todas");
  return {
    id: "whatsapp-en-las-cuatro",
    nivel: "N3",
    resumen: "Sitio de 4 páginas: todos los WhatsApp, y dos vueltas (horario en una página, precio en dos) sin dejar nada viejo.",
    inicio,
    ficha: {
      negocio: "Consultorio dental de una doctora en Puebla",
      datos: { whatsapp: "+52 222 345 6789", precio: "$400" },
    },
    guion: [
      {
        tipo: "pide",
        mensaje: "mi whatsapp es +52 222 345 6789. haz que todos los botones de whatsapp funcionen, en todas las paginas del sitio",
      },
      { tipo: "vuelve", mensaje: "los sabados ahora cerramos a la 1, ya no a las 2. cambialo porfa" },
      { tipo: "vuelve", mensaje: "y la valoracion ya cuesta $400, cambialo donde salga" },
    ],
    graders: [
      botonesDeWhatsAppVan("whatsapp"),
      contieneTexto("sabado-nuevo", "/ubicacion/", /S[aá]bado\W+9(?::00)?\s*(?:am|a\.\s?m\.)?\s*[–-]+\s*(?:1(?::00)?\s*(?:pm|p\.\s?m\.)|13:00)/i),
      yaNoAparece("sin-horario-viejo", "2:00 pm"),
      // Cambia el sábado, no la semana; y el precio de la valoración, no los
      // de los tratamientos.
      sigueAhi("sigue-el-resto-del-horario", "/ubicacion/", [/Lunes\s*[—–-]+\s*Viernes\s*10:00 am\s*[–-]\s*7:00 pm/, /Av\. Teziutlán Sur 47/]),
      sigueAhi("siguen-los-otros-precios", "/tratamientos/", [
        /Limpieza profunda con ultrasonido\s*\$650/,
        /Resina estética · por pieza\s*\$890/,
        /Corona de zirconia\s*\$4,850/,
        /Blanqueamiento en consultorio\s*\$2,900/,
        /Guarda oclusal \(bruxismo\)\s*\$1,650/,
        /Extracción simple\s*\$1,100/,
      ]),
      datosDeLaFicha(["precio"]),
      yaNoAparece("sin-precio-viejo", "$350"),
      paginasQueExisten(["tratamientos", "sobre-mi", "ubicacion"]),
      nadaInventado(),
      sinCifrasInventadas(),
      sinDesbordeMovil(),
      enlacesInternosVan(),
    ],
    solucion,
    rotas: [
      // El WhatsApp en la página de ubicación y en el pie de 3 páginas de 4.
      { nombre: "whatsapp-en-tres-de-cuatro", datos: enPagina(solucion, "sobre-mi", [[PIE(WA), PIE("#")]]) },
      { nombre: "sabado-sin-cambiar", datos: conPrecio(conWhatsApp(WA, WA), "todas") },
      { nombre: "quito-de-mas", datos: enPagina(solucion, "ubicacion", [["10:00 am – 7:00 pm", "10:00 am – 1:00 pm"]]) },
      { nombre: "otro-precio-tocado", datos: enPagina(solucion, "tratamientos", [["$650", "$400"]]) },
      // El precio sólo en la home: la llamada final de /ubicacion/ sigue en $350.
      { nombre: "precio-solo-en-la-home", datos: conPrecio(conSabado(conWhatsApp(WA, WA), "1:00 pm"), "solo-home") },
      // Todo cambiado menos la descripción para Google, en las 4 páginas.
      { nombre: "precio-viejo-en-la-descripcion", datos: enTodas(solucion, [["radiografía por $400,", "radiografía por $350,"]]) },
      { nombre: "sin-la-pagina-sobre-mi", datos: { ...solucion, pages: Object.fromEntries(Object.entries(solucion.pages ?? {}).filter(([s]) => s !== "sobre-mi")) } },
      { nombre: "precio-inventado", datos: enPagina(solucion, "", [["Agenda tu valoración · $400", "Agenda tu valoración · $450"]]) },
      { nombre: "desborda", datos: enPagina(solucion, "tratamientos", [["<!-- FOOTER LOCAL -->", '<div style="width:900px">x</div><!-- FOOTER LOCAL -->']]) },
    ],
  };
}
