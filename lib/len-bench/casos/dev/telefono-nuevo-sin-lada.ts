// lib/len-bench/casos/dev/telefono-nuevo-sin-lada.ts — N1, sobre una página REAL
// de OpenLen (plantilla `voltio`, electricista 24/7).
//
// Cambio suelto con el dato EN el mensaje: el número nuevo, dicho como lo dice
// un dueño en Guadalajara, SIN lada de país. Lo que se mide: que el nuevo esté,
// que el viejo desaparezca de las TRES veces que sale (cabecera, héroe y
// llamada final), y que no se invente una lada (`lada-que-nadie-dio`, rojo en
// 1.5). No se pide arreglar los botones `href="#"` de la plantilla: eso sería
// otro encargo, y la partida ya los traía.
import fs from "node:fs";
import path from "node:path";
import type { Encargo } from "@/lib/len-bench/tipos";
import { cambiar } from "@/lib/len-bench/casos/cambiar";
import { datosDeLaFicha, enlacesInternosVan, nadaInventado, sigueAhi, sinCifrasInventadas, sinDesbordeMovil, yaNoAparece } from "@/lib/len-bench/graders";

const VIEJO = "33 1907 4482";
const NUEVO = "33 2468 1357";

export function crear(dirPaginas: string): Encargo {
  const inicio = fs.readFileSync(path.join(dirPaginas, "telefono-nuevo-sin-lada.inicio.html"), "utf8");
  const solucion = cambiar(inicio, [[VIEJO, NUEVO, 3]]);
  return {
    id: "telefono-nuevo-sin-lada",
    nivel: "N1",
    resumen: "Cambiar el teléfono en las tres partes donde sale, sin inventarle una lada de país.",
    inicio: { html: inicio },
    ficha: {
      negocio: "Electricista y plomero de urgencias en Guadalajara",
      datos: { telefono: NUEVO },
    },
    guion: [{ tipo: "pide", mensaje: `cambié de número, ahora es el ${NUEVO}. cámbialo en toda la página porfa` }],
    graders: [
      datosDeLaFicha(["telefono"]),
      yaNoAparece("sin-telefono-viejo", VIEJO),
      // Lo que va junto a cada número: se cambia el número, no lo de al lado.
      sigueAhi("sigue-lo-de-al-lado", "/", [/electricidad · plomería · boilers/, /WhatsApp con foto de tu falla/, /urgencia nocturna \+\$300/]),
      nadaInventado(),
      sinCifrasInventadas(),
      sinDesbordeMovil(),
      enlacesInternosVan(),
    ],
    solucion: { html: solucion },
    rotas: [
      // Se le olvidó uno de los tres: el del héroe («Marca: …»).
      { nombre: "uno-sin-cambiar", datos: { html: cambiar(inicio, [[VIEJO, NUEVO, 3], [`Marca: ${NUEVO}`, `Marca: ${VIEJO}`]]) } },
      { nombre: "quito-de-mas", datos: { html: cambiar(solucion, [["24/7 · urgencia nocturna +$300, avisado desde antes", ""]]) } },
      // El botón llama, pero con una lada que nadie dio.
      { nombre: "lada-inventada", datos: { html: cambiar(solucion, [["</nav>", '<a href="tel:+523324681357">Llamar</a></nav>']]) } },
      { nombre: "desborda", datos: { html: cambiar(solucion, [["</footer>", '<div style="width:900px">x</div></footer>']]) } },
      { nombre: "enlace-roto", datos: { html: cambiar(solucion, [["</nav>", '<a href="/servicios/">Servicios</a></nav>']]) } },
    ],
  };
}
