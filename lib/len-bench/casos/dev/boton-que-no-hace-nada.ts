// lib/len-bench/casos/dev/boton-que-no-hace-nada.ts — N2, sobre una página REAL
// de OpenLen (plantilla `nitida`, fotografía de producto).
//
// El dueño se queja de un botón que «no hace nada» (el «Cotiza por WhatsApp»
// es un `href="#"`) y, en el mismo mensaje, pide quitar otro. Dos cosas en un
// mensaje: el F01 de decir «listo» con una sola hecha. El número va CON lada:
// aquí no se mide la lada (eso lo mide otro caso), sino terminar.
import fs from "node:fs";
import path from "node:path";
import type { Encargo } from "@/lib/len-bench/tipos";
import { cambiar } from "@/lib/len-bench/casos/cambiar";
import {
  botonesDeWhatsAppVan,
  enlacesInternosVan,
  nadaInventado,
  sigueAhi,
  sinCifrasInventadas,
  sinDesbordeMovil,
  yaNoAparece,
} from "@/lib/len-bench/graders";

const BOTON = (href: string) =>
  `<a href="${href}" class="btn-primary lift inline-flex h-12 items-center gap-2 rounded-[var(--radius-sm)] px-7 text-[14px] font-semibold">`;
const BEHANCE = '      <a href="#" class="hover:text-[color:var(--fg)]">Behance</a>\n';

export function crear(dirPaginas: string): Encargo {
  const inicio = fs.readFileSync(path.join(dirPaginas, "boton-que-no-hace-nada.inicio.html"), "utf8");
  const con = (href: string, behance: boolean) => cambiar(inicio, [[BOTON("#"), BOTON(href)], ...(behance ? [] : [[BEHANCE, ""] as const])]);
  const solucion = con("https://wa.me/525543218765", false);
  return {
    id: "boton-que-no-hace-nada",
    nivel: "N2",
    resumen: "Dos cosas en un mensaje: el botón de WhatsApp que no hace nada, y quitar el de Behance.",
    inicio: { html: inicio },
    ficha: { negocio: "Estudio de fotografía de producto en la CDMX", datos: { whatsapp: "+52 55 4321 8765" } },
    guion: [
      {
        tipo: "pide",
        mensaje:
          "el boton de cotiza por whatsapp no hace nada, le pican y no pasa nada. mi whatsapp es +52 55 4321 8765. y quita el de behance que ya no lo uso",
      },
    ],
    graders: [
      botonesDeWhatsAppVan("whatsapp"),
      yaNoAparece("sin-behance", "Behance", 2),
      // Se quita Behance; Instagram, que va al lado, se queda.
      sigueAhi("sigue-lo-de-al-lado", "/", [/Instagram/, /estudio en Portales, CDMX/]),
      nadaInventado(),
      sinCifrasInventadas(),
      sinDesbordeMovil(),
      enlacesInternosVan(),
    ],
    solucion: { html: solucion },
    rotas: [
      { nombre: "quito-de-mas", datos: { html: cambiar(solucion, [[BEHANCE.replace("Behance", "Instagram"), ""]]) } },
      // Quitó Behance y se olvidó del botón.
      { nombre: "sigue-muerto", datos: { html: cambiar(inicio, [[BEHANCE, ""]]) } },
      // Arregló el botón y se olvidó de Behance.
      { nombre: "behance-sigue", datos: { html: con("https://wa.me/525543218765", true) } },
      // El 1 de móvil viejo de México (hallazgo E del humo).
      { nombre: "whatsapp-con-521", datos: { html: con("https://wa.me/5215543218765", false) } },
      { nombre: "desborda", datos: { html: cambiar(solucion, [["</footer>", '<div style="width:900px">x</div></footer>']]) } },
      { nombre: "enlace-roto", datos: { html: cambiar(solucion, [["</nav>", '<a href="/portafolio/">Portafolio</a></nav>']]) } },
    ],
  };
}
