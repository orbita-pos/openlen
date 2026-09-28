// lib/len-bench/casos/dev/sitio-que-se-muda.ts — N3, sobre un sitio de CUATRO
// páginas armado con una plantilla REAL de OpenLen (`el-paradero`, taquería de
// guisados): inicio con el pizarrón, /cocina/, /resenas/ y /visitanos/, con la
// misma cabecera y el mismo pie en todas.
//
// Encargo largo con vueltas: el dueño se muda de local (la dirección sale en
// el pie de las 4 páginas y en «visítanos»: 5 sitios), y después vuelve dos
// veces con el guisado del día, que la segunda vez CAMBIA. Es el pilar
// «terminar el encargo» de `len-aspira-a-una-condicion-verificable`, y el
// testigo de `telefono-en-las-cuatro` (3 de 4 páginas en 1.5).
//
// Lo que NO se califica, a propósito: «a dos cuadras del metro Niños Héroes»
// deja de ser verdad con la mudanza. Un buen desarrollador lo preguntaría;
// la solución lo quita, pero el dueño no lo pidió y no se le exige a Len.
import fs from "node:fs";
import path from "node:path";
import type { ProjectData } from "@/lib/projects/types";
import type { Encargo } from "@/lib/len-bench/tipos";
import { cambiar } from "@/lib/len-bench/casos/cambiar";
import {
  datosDeLaFicha,
  enlacesInternosVan,
  nadaInventado,
  sinCifrasInventadas,
  paginasQueExisten,
  sigueAhi,
  sinDesbordeMovil,
  yaNoAparece,
} from "@/lib/len-bench/graders";

const PIE_VIEJO = "Dr. Vértiz 214, Doctores · L-S 8-4";
const PIE_NUEVO = "Av. Coyoacán 1435, Del Valle · L-S 8-4";
const BARRA_VIEJA = "8:00 am – 4:00 pm · Doctores";
const BARRA_NUEVA = "8:00 am – 4:00 pm · Del Valle";

/** La plantilla de una página, partida en cuatro. */
function sitioDeCuatro(plantilla: string): ProjectData {
  const en = (marca: string) => {
    const i = plantilla.indexOf(marca);
    if (i < 0) throw new Error(`la plantilla ya no trae «${marca}»`);
    return i;
  };
  const [hero, cocina, resenas, visitanos, pie] = [
    en("<!-- HERO"),
    en("<!-- LA COCINA -->"),
    en("<!-- RESEÑAS -->"),
    en("<!-- VISÍTANOS"),
    en("<!-- FOOTER LOCAL -->"),
  ];
  const enlaces = '<a href="/">Inicio</a><a href="/cocina/">Cocina</a><a href="/resenas/">Reseñas</a><a href="/visitanos/">Visítanos</a>';
  // En la cabecera sólo desde tablet: a 390 px la fila desbordaba (428 px, visto
  // en la prevalidación) y la partida ya habría suspendido `sin-desborde-movil`.
  // En el móvil, la misma fila va antes del pie, donde puede partirse en dos.
  const cabeza = cambiar(plantilla.slice(0, hero), [
    ["</nav>", `<span class="hidden gap-3 text-[13px] sm:flex">${enlaces}</span></nav>`],
  ]);
  const cola = `<nav class="flex flex-wrap gap-x-4 gap-y-2 px-6 py-6 text-[14px]">${enlaces}</nav>\n${plantilla.slice(pie)}`;
  // «Ordena» (cabecera y héroe) salta a `#visitanos`, que al partir el sitio
  // sólo existe en /visitanos/: en las otras 3 páginas el botón no iba a ningún
  // sitio, un defecto de la partida y no del encargo.
  const pagina = (cuerpo: string) =>
    (cabeza + cuerpo + cola).replaceAll('href="#visitanos"', 'href="/visitanos/#visitanos"');
  return {
    html: pagina(plantilla.slice(hero, cocina)),
    pages: {
      cocina: { title: "La cocina", html: pagina(plantilla.slice(cocina, resenas)) },
      resenas: { title: "Reseñas", html: pagina(plantilla.slice(resenas, visitanos)) },
      visitanos: { title: "Visítanos", html: pagina(plantilla.slice(visitanos, pie)) },
    },
  };
}

/** El mismo cambio en todas las páginas del sitio. */
function enTodas(d: ProjectData, cambios: Parameters<typeof cambiar>[1]): ProjectData {
  return {
    html: cambiar(d.html, cambios),
    pages: Object.fromEntries(Object.entries(d.pages ?? {}).map(([s, p]) => [s, { ...p, html: cambiar(p.html, cambios) }])),
  };
}

function conPagina(d: ProjectData, slug: string, cambios: Parameters<typeof cambiar>[1]): ProjectData {
  const p = d.pages?.[slug];
  if (!p) throw new Error(`no hay página «${slug}»`);
  return { ...d, pages: { ...d.pages, [slug]: { ...p, html: cambiar(p.html, cambios) } } };
}

export function crear(dirPaginas: string): Encargo {
  const inicio = sitioDeCuatro(fs.readFileSync(path.join(dirPaginas, "sitio-que-se-muda.plantilla.html"), "utf8"));
  const mudado = conPagina(
    enTodas(inicio, [
      [PIE_VIEJO, PIE_NUEVO],
      [BARRA_VIEJA, BARRA_NUEVA],
      ["desde 1987 · Doctores, CDMX", "desde 1987 · Del Valle, CDMX"],
      ["de 8 a 4, Col. Doctores.", "de 8 a 4, Col. Del Valle."],
    ]),
    "visitanos",
    [
      ["Dr. Vértiz 214, Col. Doctores", "Av. Coyoacán 1435, Col. Del Valle"],
      ["CDMX · a dos cuadras del metro Niños Héroes", "CDMX"],
    ],
  );
  const delDia = (plato: string, precio: string) =>
    `<div class="mono mb-4 text-[13px] uppercase tracking-[0.12em]">Guisado del día · ${plato} · ${precio}</div>\n  <!-- El pizarrón -->`;
  const solucion: ProjectData = { ...mudado, html: cambiar(mudado.html, [["<!-- El pizarrón -->", delDia("Costilla en salsa morita", "$38")]]) };
  const sinResenas: ProjectData = { ...solucion, pages: { ...solucion.pages } };
  delete sinResenas.pages?.resenas;
  return {
    id: "sitio-que-se-muda",
    nivel: "N3",
    resumen: "Sitio de 4 páginas: mudanza (5 sitios) y el guisado del día, que vuelve y cambia; sin perder páginas.",
    inicio,
    ficha: {
      negocio: "Taquería de guisados en la Ciudad de México",
      datos: {
        direccion: "Coyoacán 1435",
        colonia: "Del Valle",
        guisado_1: "Huitlacoche con queso",
        precio_1: "$36",
        guisado_2: "Costilla en salsa morita",
        precio_2: "$38",
      },
    },
    guion: [
      { tipo: "pide", mensaje: "nos cambiamos de local: ahora estamos en Av. Coyoacán 1435, Col. Del Valle. cambialo en todo el sitio porfa" },
      { tipo: "vuelve", mensaje: "oye, quiero poner el guisado del dia hasta arriba del menu. hoy es huitlacoche con queso, a $36 el taco" },
      { tipo: "vuelve", mensaje: "ya se acabo el huitlacoche, ahora el del dia es costilla en salsa morita a $38. quita el de huitlacoche" },
    ],
    graders: [
      datosDeLaFicha(["direccion", "colonia", "guisado_2", "precio_2"]),
      // La colonia también: sale en la barra de arriba y en el <title> de las
      // 4 páginas. Con sólo «Vértiz 214», una solución que la dejaba pasaba.
      yaNoAparece("sin-direccion-vieja", ["Vértiz 214", "Doctores"]),
      yaNoAparece("sin-guisado-viejo", ["Huitlacoche con queso", "$36"]),
      paginasQueExisten(["cocina", "resenas", "visitanos"]),
      // Cambia la dirección y el guisado del día; el resto del pizarrón y el
      // horario, que están al lado, se quedan.
      sigueAhi("sigue-el-pizarron", "/", [/Chicharrón prensado\s*\$26/, /Tinga de pollo\s*\$24/, /Paquete oficina: 5 tacos \+ agua\s*\$135/]),
      sigueAhi("sigue-el-horario", "/visitanos/", [/Lunes\s*[—–-]+\s*Sábado\s*8:00 am\s*[–-]\s*4:00 pm/]),
      nadaInventado(),
      sinCifrasInventadas(),
      sinDesbordeMovil(),
      enlacesInternosVan(),
    ],
    solucion,
    rotas: [
      // Se mudó en 3 páginas de 4: el pie de /resenas/ sigue en la vieja.
      { nombre: "direccion-vieja-en-resenas", datos: conPagina(solucion, "resenas", [[PIE_NUEVO, PIE_VIEJO]]) },
      // Cambió la dirección y se olvidó la colonia de la barra de arriba de /cocina/.
      { nombre: "colonia-vieja-en-la-cabecera", datos: conPagina(solucion, "cocina", [[BARRA_NUEVA, BARRA_VIEJA]]) },
      // Se quedó en la vuelta anterior: sigue el huitlacoche, no llegó la costilla.
      {
        nombre: "guisado-viejo-sigue",
        datos: { ...solucion, html: cambiar(solucion.html, [["Costilla en salsa morita · $38", "Huitlacoche con queso · $36"]]) },
      },
      // Por el camino se perdió una página.
      { nombre: "sin-la-pagina-de-resenas", datos: sinResenas },
      // El guisado nuevo ocupó el sitio de otro.
      { nombre: "quito-de-mas", datos: { ...solucion, html: cambiar(solucion.html, [["Tinga de pollo", ""]]) } },
      { nombre: "horario-tocado", datos: conPagina(solucion, "visitanos", [["Lunes — Sábado", "Lunes — Viernes"]]) },
      { nombre: "precio-inventado", datos: { ...solucion, html: cambiar(solucion.html, [["· $38</div>", "· $40</div>"]]) } },
      { nombre: "desborda", datos: conPagina(solucion, "cocina", [["<!-- FOOTER LOCAL -->", '<div style="width:900px">x</div><!-- FOOTER LOCAL -->']]) },
      { nombre: "enlace-roto", datos: { ...solucion, html: cambiar(solucion.html, [["<!-- El pizarrón -->", '<a href="/menu/">Menú completo</a><!-- El pizarrón -->']]) } },
    ],
  };
}
