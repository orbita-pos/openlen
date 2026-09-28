// lib/len-bench/casos/dev/texto-sobre-la-foto.ts — N1, F06, sobre una página REAL
// de OpenLen (plantilla `casa-almar`, hotel en Puerto Escondido).
//
// La semilla de C5 («texto ilegible sobre la foto de portada»; en producción,
// el 03/09, necesitó dos turnos y una captura del dueño). La plantilla trae el
// héroe a sangre con su velo (`.scrim`); aquí el dueño ya puso SU foto —la
// costa bajo un cielo nublado y claro— y en una edición anterior pidió «que se vea
// más la foto»: el velo quedó casi transparente y el título blanco se pierde.
// Lo pide arreglar sin quitar la foto. Lo mide `texto-se-lee` a 390 px sobre
// el píxel, con la foto de verdad cargada.
//
// ⚠️ La lista del 23/09 decía `marejada`: sus fotos son huecos `data-ol-photo`
// (degradados; rellenarlos se retiró el 04/09), así que no había foto sobre la
// que leer. Y se aplazó porque el Chromium de Len-Bench no cargaba
// `images.openlen.com`: desde 391ec13a sí (lo que ve el visitante).
import fs from "node:fs";
import path from "node:path";
import type { Encargo } from "@/lib/len-bench/tipos";
import { cambiar } from "@/lib/len-bench/casos/cambiar";
import { enElFichero, enlacesInternosVan, nadaInventado, sinDesbordeMovil, textoSeLee } from "@/lib/len-bench/graders";

const HUECO = '<div class="ph-sea absolute inset-0" data-ol-photo="infinity pool at sunset ocean"></div>';
const ALT = "Acantilados y mar abierto de la costa frente a Casa Almar";
const FOTO = `<img class="absolute inset-0 h-full w-full object-cover" src="https://images.openlen.com/209-coastal-cliffs-1920.webp" alt="${ALT}">`;
const VELO = (css: string) => `.scrim { background: ${css}; }`;
const VELO_DE_LA_PLANTILLA = "linear-gradient(to top, rgba(9,13,18,0.66) 0%, rgba(9,13,18,0.22) 46%, rgba(9,13,18,0.34) 100%)";
const VELO_ACLARADO = "linear-gradient(to top, rgba(9,13,18,0.10) 0%, rgba(9,13,18,0.04) 46%, rgba(9,13,18,0.08) 100%)";
const VELO_ARREGLADO = "linear-gradient(to top, rgba(9,13,18,0.78) 0%, rgba(9,13,18,0.55) 55%, rgba(9,13,18,0.40) 100%)";
const TITULO = /El mar entra\s*por las celos[ií]as/i;

export function crear(dirPaginas: string): Encargo {
  const plantilla = fs.readFileSync(path.join(dirPaginas, "texto-sobre-la-foto.inicio.html"), "utf8");
  const con = (velo: string, foto = FOTO) => cambiar(plantilla, [[HUECO, foto], [VELO(VELO_DE_LA_PLANTILLA), VELO(velo)]]);
  const inicio = con(VELO_ACLARADO);
  const solucion = con(VELO_ARREGLADO);
  return {
    id: "texto-sobre-la-foto",
    nivel: "N1",
    resumen: "El título blanco se pierde sobre la foto de portada en el móvil: arreglarlo sin quitar la foto.",
    inicio: { html: inicio },
    ficha: {
      negocio: "Hotel boutique de 9 habitaciones frente al mar en Puerto Escondido",
      datos: {},
      gustos: ["quiere que se siga viendo su foto de la costa"],
    },
    guion: [{ tipo: "pide", mensaje: "en el celular no se lee el titulo de la portada, se pierde con la foto. arreglalo pero que se siga viendo la foto" }],
    graders: [
      textoSeLee("el-titulo-se-lee", "/", TITULO),
      // La foto sigue: su `alt` viaja en el fichero aunque la publicación
      // hornee el `src` a /assets/.
      enElFichero("sigue-la-foto", "/", new RegExp(ALT)),
      nadaInventado(),
      sinDesbordeMovil(),
      enlacesInternosVan(),
    ],
    solucion: { html: solucion },
    rotas: [
      { nombre: "velo-que-no-alcanza", datos: { html: con("rgba(9,13,18,0.15)") } },
      // Arreglado quitando la foto: se lee, pero no es lo que pidió.
      { nombre: "sin-la-foto", datos: { html: con(VELO_ACLARADO, '<div class="absolute inset-0" style="background:#0f1a22"></div>') } },
      // Quitar el título tampoco es arreglarlo.
      { nombre: "sin-el-titulo", datos: { html: cambiar(solucion, [["El mar entra<br>por las celosías.", "&nbsp;"]]) } },
      // Un teléfono que nadie dio, colado en el héroe.
      { nombre: "telefono-inventado", datos: { html: cambiar(solucion, [["</h1>", "</h1><p class=\"relative mt-3 text-white\">Reserva al 954 582 1100</p>"]]) } },
      { nombre: "desborda", datos: { html: cambiar(solucion, [["<!-- FOOTER LOCAL -->", '<div style="width:900px">x</div><!-- FOOTER LOCAL -->']]) } },
      { nombre: "enlace-roto", datos: { html: cambiar(solucion, [["<!-- FOOTER LOCAL -->", '<a href="/galeria/">Galería</a><!-- FOOTER LOCAL -->']]) } },
    ],
  };
}
