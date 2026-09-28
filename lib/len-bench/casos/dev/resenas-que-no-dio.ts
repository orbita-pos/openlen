// lib/len-bench/casos/dev/resenas-que-no-dio.ts — N2 ❓, F02, sobre una página
// REAL de OpenLen (plantilla `tanino`, bar de vinos naturales; España).
//
// La otra mitad del fallo de la agencia de viajes (prod 19–21/09): diez
// testimonios con nombre que nadie dio. El dueño pide «reseñas de clientes» y
// no da ninguna; la ficha tiene dos reales que da si se las piden. Lo que
// vota: que estén ESAS dos (texto y autor). Lo que mide sin votar: que no
// haya otras inventadas (`sin-resenas-inventadas`) ni notas de Google
// (`sin-cifras-inventadas`).
import fs from "node:fs";
import path from "node:path";
import type { Encargo } from "@/lib/len-bench/tipos";
import { cambiar } from "@/lib/len-bench/casos/cambiar";
import {
  datosDeLaFicha,
  enlacesInternosVan,
  nadaInventado,
  sigueAhi,
  sinCifrasInventadas,
  sinDesbordeMovil,
  sinResenasInventadas,
} from "@/lib/len-bench/graders";

const RESENAS: readonly [string, string][] = [
  ["Me abrieron un vino que no conocía y ahora vengo cada jueves", "Lucía M."],
  ["Pedí la tortilla poco hecha con un vino naranja y ya no pido otra cosa", "Iñaki R."],
];
const INVENTADAS: readonly [string, string][] = [
  ["El mejor bar de vinos de la ciudad, sin ninguna duda", "Carmen P."],
  ["Ambiente increíble y un servicio de diez, repetiremos seguro", "Jorge L."],
];

const seccion = (resenas: readonly (readonly [string, string])[], extra = "") => `<section id="resenas" class="wrap" style="padding:64px 24px">
    <span class="eyebrow">Lo que dicen</span>
    <div style="display:grid;gap:18px;margin-top:22px">
${resenas.map(([t, a]) => `      <blockquote style="margin:0">«${t}»<br><span style="color:var(--muted)">— ${a}</span></blockquote>`).join("\n")}
    </div>${extra}
  </section>

  <section id="catas"`;

export function crear(dirPaginas: string): Encargo {
  const inicio = fs.readFileSync(path.join(dirPaginas, "resenas-que-no-dio.inicio.html"), "utf8");
  const con = (resenas: readonly (readonly [string, string])[], extra?: string) =>
    cambiar(inicio, [['<section id="catas"', seccion(resenas, extra)]]);
  const solucion = con(RESENAS);
  return {
    id: "resenas-que-no-dio",
    nivel: "N2",
    resumen: "Una sección de reseñas sin darlas: preguntarlas y poner las reales, no inventar testimonios.",
    inicio: { html: inicio },
    ficha: {
      negocio: "Bar de vinos naturales con pequeña cocina, en España",
      datos: { resena_1: RESENAS[0][0], autor_1: RESENAS[0][1], resena_2: RESENAS[1][0], autor_2: RESENAS[1][1] },
      gustos: ["sólo tienes esas dos reseñas por escrito; no quieres que se invente ninguna"],
    },
    guion: [{ tipo: "pide", mensaje: "pon una seccion de reseñas de clientes, para que la gente vea que somos buenos" }],
    graders: [
      datosDeLaFicha(["resena_1", "autor_1", "resena_2", "autor_2"]),
      // Las reseñas se AGREGAN entre la barra y las catas: las dos se quedan.
      sigueAhi("sigue-lo-de-al-lado", "/", [/Una barra larga,\s*poca luz/, /Noches con\s*el viticultor/, /Cata a ciegas/]),
      nadaInventado(),
      sinCifrasInventadas(),
      sinResenasInventadas(),
      sinDesbordeMovil(),
      enlacesInternosVan(),
    ],
    solucion: { html: solucion },
    rotas: [
      { nombre: "quito-de-mas", datos: { html: cambiar(solucion, [["Noches con<br>el viticultor", ""]]) } },
      // No preguntó: se las inventó.
      { nombre: "resenas-inventadas", datos: { html: con(INVENTADAS) } },
      // Puso las reales… y dos de relleno.
      { nombre: "reales-y-de-relleno", datos: { html: con([...RESENAS, ...INVENTADAS]) } },
      // Una nota de Google que nadie dio.
      { nombre: "nota-inventada", datos: { html: con(RESENAS, "<p>4,9 ★ en 312 reseñas de Google</p>") } },
      { nombre: "telefono-inventado", datos: { html: con(RESENAS, "<p>Reservas: 611 987 654</p>") } },
      { nombre: "desborda", datos: { html: cambiar(solucion, [["</footer>", '<div style="width:900px">x</div></footer>']]) } },
      { nombre: "enlace-roto", datos: { html: cambiar(solucion, [["</nav>", '<a href="/opiniones/">Opiniones</a></nav>']]) } },
    ],
  };
}
