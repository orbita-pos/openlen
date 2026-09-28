// lib/len-bench/casos/dev/precios-y-whatsapp-de-la-ficha.ts — N2, sobre una página
// REAL de OpenLen (plantilla `norte-barberia`).
//
// Los datos NO vienen en el mensaje: los precios nuevos y el número de WhatsApp
// están en la ficha, y Len tiene que PREGUNTARLOS. La plantilla trae tres
// botones de «Agenda por WhatsApp» que no llevan a ningún sitio (`#visitanos`,
// `#`, `#`) y el precio de «Corte + barba» DOS veces (héroe y lista). Lo que se
// mide: los precios nuevos, ninguno viejo, y TODOS los botones de WhatsApp
// funcionando. Los precios nuevos se eligieron para que ninguno coincida con
// uno viejo: si no, `sin-precios-viejos` no podría distinguirlos.
import fs from "node:fs";
import path from "node:path";
import type { Encargo } from "@/lib/len-bench/tipos";
import { cambiar } from "@/lib/len-bench/casos/cambiar";
import {
  botonesDeWhatsAppVan,
  datosDeLaFicha,
  enlacesInternosVan,
  nadaInventado,
  sigueAhi,
  sinCifrasInventadas,
  sinDesbordeMovil,
  yaNoAparece,
} from "@/lib/len-bench/graders";

const WA = "https://wa.me/525543218765";

export function crear(dirPaginas: string): Encargo {
  const inicio = fs.readFileSync(path.join(dirPaginas, "precios-y-whatsapp-de-la-ficha.inicio.html"), "utf8");
  const solucion = cambiar(inicio, [
    // El de 390 sale dos veces: en el héroe y en la lista.
    ["$390", "$430", 2],
    ["$220", "$250"],
    ["$260", "$290"],
    ["$180", "$200"],
    ["$90", "$100"],
    ["$160.", "$170."],
    ['<a href="#visitanos" class="text-[13.5px] font-medium', `<a href="${WA}" class="text-[13.5px] font-medium`],
    [
      '<a href="#" class="btn-primary lift inline-flex h-11 items-center gap-2 rounded-[var(--radius-sm)] px-5 text-[14px] font-semibold">',
      `<a href="${WA}" class="btn-primary lift inline-flex h-11 items-center gap-2 rounded-[var(--radius-sm)] px-5 text-[14px] font-semibold">`,
    ],
    ['<a href="#" class="hover:text-[color:var(--fg)]">WhatsApp</a>', `<a href="${WA}" class="hover:text-[color:var(--fg)]">WhatsApp</a>`],
  ]);
  return {
    id: "precios-y-whatsapp-de-la-ficha",
    nivel: "N2",
    resumen: "Precios nuevos y agendar por WhatsApp, sin datos en el mensaje: hay que preguntarlos; tres botones muertos.",
    inicio: { html: inicio },
    ficha: {
      negocio: "Barbería de barrio en la Roma Norte, Ciudad de México",
      datos: {
        whatsapp: "+52 55 4321 8765",
        corte_clasico: "$250",
        fade: "$290",
        barba_completa: "$200",
        corte_y_barba: "$430",
        cejas_y_detalle: "$100",
        ninos: "$170",
      },
    },
    guion: [
      {
        tipo: "pide",
        mensaje: "subi mis precios y quiero que me agenden por whatsapp, pero el boton no hace nada. arreglame eso",
      },
    ],
    graders: [
      datosDeLaFicha(["corte_clasico", "fade", "barba_completa", "corte_y_barba", "cejas_y_detalle", "ninos"]),
      yaNoAparece("sin-precios-viejos", ["$390", "$220", "$260", "$180", "$90", "$160"]),
      botonesDeWhatsAppVan("whatsapp"),
      // Cambian los precios y los botones; el equipo, las fotos y el horario se quedan.
      sigueAhi("sigue-lo-demas", "/", [/Seis manos, un estándar/, /Las pruebas/, /Martes a domingo/]),
      nadaInventado(),
      sinCifrasInventadas(),
      sinDesbordeMovil(),
      enlacesInternosVan(),
    ],
    solucion: { html: solucion },
    rotas: [
      { nombre: "quito-de-mas", datos: { html: cambiar(solucion, [["Seis manos, un estándar.", ""]]) } },
      // El precio del héroe se quedó viejo: sólo cambió el de la lista.
      { nombre: "heroe-con-precio-viejo", datos: { html: cambiar(solucion, [["navaja y toalla · $430", "navaja y toalla · $390"]]) } },
      // Arregló dos botones y dejó el del pie.
      {
        nombre: "un-boton-muerto",
        datos: {
          html: cambiar(solucion, [[`<a href="${WA}" class="hover:text-[color:var(--fg)]">WhatsApp</a>`, '<a href="#" class="hover:text-[color:var(--fg)]">WhatsApp</a>']]),
        },
      },
      // Un precio que el dueño no dio.
      { nombre: "precio-inventado", datos: { html: cambiar(solucion, [["$100", "$120"]]) } },
      { nombre: "desborda", datos: { html: cambiar(solucion, [["</footer>", '<div style="width:900px">x</div></footer>']]) } },
      { nombre: "enlace-roto", datos: { html: cambiar(solucion, [["</footer>", '<a href="/reservar/">Reservar</a></footer>']]) } },
    ],
  };
}
