// lib/len-bench/casos/dev/nombre-nuevo.ts — N3, F01, sobre una página REAL de
// OpenLen (plantilla `sastre`) partida en un sitio de 3 páginas (home,
// /coleccion/, /taller/) con la misma cabecera y el mismo pie.
//
// «Ya no somos SASTRE, ahora somos IRIARTE: cámbialo en todo el sitio», y la
// vuelta trae el correo nuevo. La marca vive en cada página en el <title>, la
// meta, el og:title, el logo del menú, el del pie y el ©. Lo difícil es que
// «sastre» también es una palabra de la página («maestro sastre», «Sastrería
// de autor», el dominio del correo): un reemplazo a ciegas, sin distinguir
// mayúsculas, deja «Iriartería de autor». Por eso la marca se busca en el
// FICHERO de cada página con un regex que distingue mayúsculas (SASTRE), y la
// sastrería tiene que seguir. El correo nuevo lo dice el dueño en la vuelta;
// uno que Len se invente antes lo ve `nada-inventado`.
import fs from "node:fs";
import path from "node:path";
import type { Encargo } from "@/lib/len-bench/tipos";
import type { ProjectData } from "@/lib/projects/types";
import { enPagina, partirEnPaginas } from "@/lib/len-bench/casos/partir";
import {
  contieneTexto,
  enElFichero,
  enlacesInternosVan,
  nadaInventado,
  sinCifrasInventadas,
  sinDesbordeMovil,
  yaNoAparece,
} from "@/lib/len-bench/graders";

const SIN_SASTRE = /^(?![\s\S]*SASTRE)/;
const CORREO_VIEJO = "taller@sastre.example";

/** Cambia `de` por `a` en TODAS sus apariciones de las páginas elegidas (o
 *  de todas). Con `cabeza: false`, sólo del <body>: el <head> queda viejo. */
function renombrar(d: ProjectData, de: string, a: string, o: { slugs?: readonly string[]; cabeza?: boolean } = {}): ProjectData {
  const toca = (slug: string) => !o.slugs || o.slugs.includes(slug);
  const en = (html: string) => {
    if (o.cabeza !== false) return html.split(de).join(a);
    const i = html.indexOf("<body");
    return html.slice(0, i) + html.slice(i).split(de).join(a);
  };
  const pages = Object.fromEntries(
    Object.entries(d.pages ?? {}).map(([slug, p]) => [slug, toca(slug) ? { ...p, html: en(p.html) } : p]),
  );
  return { ...d, html: toca("") ? en(d.html) : d.html, pages } as ProjectData;
}

export function crear(dirPaginas: string): Encargo {
  const plantilla = fs.readFileSync(path.join(dirPaginas, "nombre-nuevo.inicio.html"), "utf8");
  const inicio = partirEnPaginas(plantilla, {
    cabeceraHasta: "<!-- HERO -->",
    pieDesde: "<!-- FOOTER -->",
    paginas: [
      { slug: "", title: "Inicio", trozos: [["<!-- HERO -->", "<!-- LA COLECCIÓN / galería -->"]] },
      { slug: "coleccion", title: "Colección", trozos: [["<!-- LA COLECCIÓN / galería -->", "<!-- EL TALLER / dónde encontrarnos -->"]] },
      { slug: "taller", title: "El taller", trozos: [["<!-- EL TALLER / dónde encontrarnos -->", "<!-- FOOTER -->"]] },
    ],
  });
  const correo = (d: ProjectData, nuevo: string) => enPagina(d, "taller", [[CORREO_VIEJO, nuevo]]);
  const renombrado = renombrar(inicio, "SASTRE", "IRIARTE");
  const solucion = correo(renombrado, "hola@iriarte.mx");

  return {
    id: "nombre-nuevo",
    nivel: "N3",
    resumen: "Cambiar el nombre del negocio en todo un sitio de 3 páginas (títulos, meta, logos, ©) sin romper la palabra común, y el correo nuevo en la vuelta.",
    inicio,
    ficha: { negocio: "Sastrería de trajes a medida", datos: {} },
    guion: [
      {
        tipo: "pide",
        mensaje: "cambiamos el nombre del negocio. ya no somos SASTRE, ahora somos IRIARTE, por el apellido de Marco. cambialo en todo el sitio porfa",
      },
      { tipo: "vuelve", mensaje: "y el correo nuevo es hola@iriarte.mx, cambialo tambien" },
    ],
    graders: [
      enElFichero("sin-sastre-en-la-home", "/", SIN_SASTRE),
      enElFichero("sin-sastre-en-coleccion", "/coleccion/", SIN_SASTRE),
      enElFichero("sin-sastre-en-el-taller", "/taller/", SIN_SASTRE),
      contieneTexto("iriarte-en-coleccion", "/coleccion/", /IRIARTE|Iriarte/),
      contieneTexto("iriarte-en-el-taller", "/taller/", /IRIARTE|Iriarte/),
      contieneTexto("la-sastreria-sigue", "/", /Sastrería de autor/),
      yaNoAparece("sin-el-correo-viejo", CORREO_VIEJO),
      contieneTexto("correo-nuevo", "/taller/", /hola@iriarte\.mx/),
      nadaInventado(),
      sinCifrasInventadas(),
      sinDesbordeMovil(),
      enlacesInternosVan(),
    ],
    solucion,
    rotas: [
      { nombre: "solo-la-home", datos: correo(renombrar(inicio, "SASTRE", "IRIARTE", { slugs: [""] }), "hola@iriarte.mx") },
      { nombre: "titulo-y-meta-viejos", datos: correo(renombrar(inicio, "SASTRE", "IRIARTE", { cabeza: false }), "hola@iriarte.mx") },
      // Buscar y reemplazar a ciegas: «Sastrería» → «Iriartería».
      { nombre: "reemplazo-a-ciegas", datos: correo(renombrar(renombrado, "Sastrería", "Iriartería"), "hola@iriarte.mx") },
      { nombre: "correo-viejo", datos: renombrado },
      { nombre: "correo-inventado", datos: correo(renombrado, "taller@iriarte.mx") },
      { nombre: "desborda", datos: enPagina(solucion, "", [["<!-- FOOTER -->", '<div style="width:900px">x</div><!-- FOOTER -->']]) },
      { nombre: "enlace-roto", datos: enPagina(solucion, "", [["</nav>", '<a href="/prensa/">Prensa</a></nav>']]) },
    ],
  };
}
