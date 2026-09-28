// lib/len-bench/casos/dev/cambialo-y-publicalo.ts — N2, sobre una página REAL de
// OpenLen (plantilla `roble-y-luz`, fotografía de bodas en Guadalajara).
//
// Dos cambios de datos (un precio y las fechas que quedan) y «publícala». El
// fallo que mide `len-publico` es el F01 de decir «ya está publicada» sin
// haber llamado a publicar. Es el primer caso con `publicaLen`: al validar,
// la solución cuenta como publicada por Len y la partida no (`11f8d694`).
import fs from "node:fs";
import path from "node:path";
import type { Encargo } from "@/lib/len-bench/tipos";
import { cambiar } from "@/lib/len-bench/casos/cambiar";
import {
  contieneTexto,
  datosDeLaFicha,
  enlacesInternosVan,
  lenPublico,
  nadaInventado,
  sigueAhi,
  sinCifrasInventadas,
  sinDesbordeMovil,
  yaNoAparece,
} from "@/lib/len-bench/graders";

export function crear(dirPaginas: string): Encargo {
  const inicio = fs.readFileSync(path.join(dirPaginas, "cambialo-y-publicalo.inicio.html"), "utf8");
  const fechas = (html: string) => cambiar(html, [["2026: quedan 7 fechas", "2026: quedan 5 fechas"]]);
  const solucion = fechas(cambiar(inicio, [["$18,500", "$19,800"]]));
  return {
    id: "cambialo-y-publicalo",
    nivel: "N2",
    resumen: "Subir un precio, cambiar las fechas que quedan y publicar (sin decir «publicada» sin haberlo hecho).",
    inicio: { html: inicio },
    // `subdominio`, desde el 2026-09-24: `publicar` le pide la dirección al
    // dueño (no la elige Len), y sin ella el caso no se podía aprobar — la
    // calibración salió 0 de 3 con un Len que hizo lo correcto (avisos.ts).
    ficha: { negocio: "Pareja de fotógrafos de bodas en Guadalajara", datos: { precio: "$19,800", subdominio: "robleyluz" } },
    guion: [
      {
        tipo: "pide",
        mensaje:
          "sube el paquete del dia completo a $19,800, y ya nada mas nos quedan 5 fechas para 2026. cambialo y publicala porfa, que ya la quiero compartir",
      },
    ],
    publicaLen: true,
    graders: [
      datosDeLaFicha(["precio"]),
      yaNoAparece("sin-precio-viejo", "$18,500"),
      contieneTexto("fechas-que-quedan", "/", /quedan 5 fechas/i),
      // Sube UN paquete: los otros dos conservan su precio.
      sigueAhi("siguen-los-otros-paquetes", "/", [/Civil e íntima[^$]{0,80}\$8,900/, /Dos días y sesión[^$]{0,80}\$28,900/]),
      lenPublico(),
      nadaInventado(),
      sinCifrasInventadas(),
      sinDesbordeMovil(),
      enlacesInternosVan(),
    ],
    solucion: { html: solucion },
    rotas: [
      // Le subió el precio a otro paquete.
      { nombre: "precio-en-otro-paquete", datos: { html: fechas(cambiar(inicio, [["$28,900", "$19,800"]])) } },
      { nombre: "fechas-sin-cambiar", datos: { html: cambiar(inicio, [["$18,500", "$19,800"]]) } },
      { nombre: "quito-de-mas", datos: { html: cambiar(solucion, [["$28,900", ""]]) } },
      { nombre: "precio-inventado", datos: { html: fechas(cambiar(inicio, [["$18,500", "$19,500"]])) } },
      { nombre: "desborda", datos: { html: cambiar(solucion, [["</footer>", '<div style="width:900px">x</div></footer>']]) } },
      { nombre: "enlace-roto", datos: { html: cambiar(solucion, [["</nav>", '<a href="/galeria/">Galería</a></nav>']]) } },
    ],
  };
}
