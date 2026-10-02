// lib/len-bench/casos/dev/tienda-que-crece.ts — N3, F04/F08, sobre una página REAL
// de OpenLen (plantilla `taller-ambar`, cerámica en Tlaquepaque).
//
// Una tienda pequeña que cambia por vueltas, como cambia de verdad: piezas
// nuevas con precio y existencias, una que se agota, otra que sube. El precio
// del set mezcalero sale DOS veces (la ficha del héroe y la tabla): cambiarlo
// en una es el fallo de siempre. Medida y esmalte de las piezas nuevas no
// vienen en el mensaje: preguntarlos vale, dejarlos vacíos también; inventarlos
// lo ve `sin-cifras-inventadas` (sin votar).
import fs from "node:fs";
import path from "node:path";
import type { Encargo } from "@/lib/len-bench/tipos";
import { cambiar } from "@/lib/len-bench/casos/cambiar";
import {
  contieneTexto,
  datosDeLaFicha,
  enlacesInternosVan,
  nadaInventado,
  sigueAhi,
  sinCifrasInventadas,
  sinDesbordeMovil,
  yaNoAparece,
} from "@/lib/len-bench/graders";

const fila = (pieza: string, medida: string, esmalte: string, precio: string, quedan: string) => `          <tr class="transition-colors hover:bg-[var(--surface)]">
            <td class="px-6 py-4 font-semibold">${pieza}</td>
            <td class="px-6 py-4 text-[color:var(--fg-muted)]">${medida}</td>
            <td class="px-6 py-4 text-[color:var(--fg-muted)]">${esmalte}</td>
            <td class="mono px-6 py-4 text-right font-medium tabular">${precio}</td>
            <td class="mono px-6 py-4 text-right text-[color:var(--accent)] tabular">${quedan}</td>
          </tr>
`;
const JARRA = (quedan: string) => `<td class="mono px-6 py-4 text-right font-medium tabular">$580</td>
            <td class="mono px-6 py-4 text-right text-[color:var(--accent)] tabular">${quedan}</td>`;
const CHIP_SET = (p: string) => `<span class="text-[12px] font-semibold">Set mezcalero</span><span class="mono text-[12px] text-[color:var(--accent)] tabular">${p}</span>`;
const FILA_SET = (p: string) => `bruñido interior</td>
            <td class="mono px-6 py-4 text-right font-medium tabular">${p}</td>`;
const FIN = "        </tbody>";

/** Las dos piezas nuevas, cada una con su precio y lo que queda, EN CUALQUIER
 *  ORDEN. Exigía el plato antes que la taza (`[\s\S]*`), y el dueño no pidió
 *  orden: el 2026-10-02 (H15, brazo F2) Len puso cada pieza junto a las de su
 *  tipo —la taza tras la de diario, el plato tras el taquero—, con los datos
 *  bien (comprobado en la captura), y suspendió. El texto visible llega en una
 *  línea (`contieneTexto`), así que `.` alcanza toda la página. */
export const EXISTENCIAS_NUEVAS =
  /^(?=.*Plato extendido.{0,80}\$\s?360.{0,10}\b6\b)(?=.*Taza espresso.{0,80}\$\s?190.{0,10}\b10\b)/i;

export function crear(dirPaginas: string): Encargo {
  const inicio = fs.readFileSync(path.join(dirPaginas, "tienda-que-crece.inicio.html"), "utf8");
  const PLATO = fila("Plato extendido", "Ø 28 cm", "humo", "$360", "6");
  const TAZA = fila("Taza espresso", "90 ml", "avena moteado", "$190", "10");
  const hacer = (o: { nuevas?: string; jarra?: string; chip?: string; tabla?: string } = {}) =>
    cambiar(inicio, [
      [FIN, (o.nuevas ?? PLATO + TAZA) + FIN],
      [JARRA("4"), JARRA(o.jarra ?? "Agotada")],
      [CHIP_SET("$380"), CHIP_SET(o.chip ?? "$420")],
      [FILA_SET("$380"), FILA_SET(o.tabla ?? "$420")],
    ]);
  const solucion = hacer();
  return {
    id: "tienda-que-crece",
    nivel: "N3",
    resumen: "Una tienda que cambia por vueltas: dos piezas nuevas, una agotada y un precio que sale en dos sitios.",
    inicio: { html: inicio },
    ficha: {
      negocio: "Taller de cerámica en Tlaquepaque con tirajes cortos",
      datos: {
        pieza_1: "Plato extendido",
        precio_1: "$360",
        medida_1: "Ø 28 cm",
        esmalte_1: "humo",
        pieza_2: "Taza espresso",
        precio_2: "$190",
        medida_2: "90 ml",
        esmalte_2: "avena moteado",
        // Con el nombre del set y dicho como precio NUEVO, como en sube-todo-diez:
        // con `precio_set` a secas el cliente se inventó un «set plato + espresso a
        // $420» y negó su propio guion (revisión de E, 26/09, rama #3).
        set_mezcalero_ya_con_la_subida: "$420",
      },
    },
    guion: [
      {
        tipo: "pide",
        mensaje: "agrega dos piezas nuevas a la hornada: el plato extendido a $360 (me quedan 6) y la taza espresso a $190 (me quedan 10)",
      },
      { tipo: "vuelve", mensaje: "se acabaron las jarras, ponle que estan agotadas" },
      { tipo: "vuelve", mensaje: "y sube el set mezcalero a $420" },
    ],
    graders: [
      datosDeLaFicha(["pieza_1", "precio_1", "pieza_2", "precio_2", "set_mezcalero_ya_con_la_subida"]),
      contieneTexto("existencias-nuevas", "/", EXISTENCIAS_NUEVAS),
      contieneTexto("jarra-agotada", "/", /Jarra de mesa.{0,120}agotad/i),
      yaNoAparece("sin-precio-viejo", "$380"),
      // Tres vueltas sobre la jarra, el set y dos nuevas: las demás piezas,
      // con su precio, se quedan.
      sigueAhi("siguen-las-demas-piezas", "/", [
        /Taza de diario[^$]{0,120}\$240/,
        /Plato hondo[^$]{0,120}\$320/,
        /Florero bajo[^$]{0,120}\$460/,
        /Plato taquero[^$]{0,120}\$180/,
      ]),
      nadaInventado(),
      sinCifrasInventadas(),
      sinDesbordeMovil(),
      enlacesInternosVan(),
    ],
    solucion: { html: solucion },
    rotas: [
      { nombre: "falta-una-pieza", datos: { html: hacer({ nuevas: PLATO }) } },
      { nombre: "quito-de-mas", datos: { html: cambiar(solucion, [["$320", "", 2]]) } },
      { nombre: "existencias-cambiadas", datos: { html: hacer({ nuevas: fila("Plato extendido", "Ø 28 cm", "humo", "$360", "10") + TAZA }) } },
      { nombre: "jarra-sin-agotar", datos: { html: hacer({ jarra: "4" }) } },
      // El precio nuevo en la tabla y el viejo en la ficha del héroe.
      { nombre: "precio-viejo-en-el-heroe", datos: { html: hacer({ chip: "$380" }) } },
      { nombre: "precio-inventado", datos: { html: hacer({ nuevas: PLATO + fila("Taza espresso", "90 ml", "avena moteado", "$185", "10") }) } },
      { nombre: "desborda", datos: { html: cambiar(solucion, [["</footer>", '<div style="width:900px">x</div></footer>']]) } },
      { nombre: "enlace-roto", datos: { html: cambiar(solucion, [["</nav>", '<a href="/tienda/">Tienda</a></nav>']]) } },
    ],
  };
}
