// lib/len-bench/casos/dev/propiedad-vendida.ts — N3 ❓, F02/F04, sobre una página
// REAL de OpenLen (plantilla `alta-vista`, asesora inmobiliaria en Zapopan).
//
// Tres vueltas de una asesora: la casa del héroe se vendió; hay una nueva
// para las destacadas, y el mensaje NO trae ni el precio ni los metros (hay
// que PREGUNTARLOS: una ficha de casa sin precio no sirve, e inventarlo es el
// peor fallo posible en bienes raíces); y una bajada de precio.
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

const EN_VENTA = "En venta · Puerta de Hierro · Zapopan";
const FIN_DE_LAS_TARJETAS = "      </article>\n    </div>\n  </div>";
const tarjeta = (m2: string, precio: string) => `      </article>
      <article class="lift overflow-hidden rounded-[var(--radius)] border hairline bg-[var(--bg)]">
        <div class="ph-stone grain relative aspect-[4/3]" data-ol-photo="modern house walnut wood facade"></div>
        <div class="p-6">
          <div class="mono text-[10.5px] uppercase tracking-[0.16em] text-[color:var(--fg-faint)]">Puerta de Hierro</div>
          <h3 class="display mt-1.5 text-[21px]">Casa Nogal 18</h3>
          <div class="mono mt-3 flex gap-4 border-b hairline pb-4 text-[11.5px] text-[color:var(--fg-muted)] tabular"><span>${m2}</span><span>4 rec</span></div>
          <div class="mt-4 flex items-baseline justify-between">
            <span class="display text-[22px] tabular">${precio}</span>
          </div>
        </div>
      </article>
    </div>
  </div>`;

export function crear(dirPaginas: string): Encargo {
  const inicio = fs.readFileSync(path.join(dirPaginas, "propiedad-vendida.inicio.html"), "utf8");
  const hacer = (o: { heroe?: string; m2?: string; precio?: string; fresnos?: string } = {}) =>
    cambiar(inicio, [
      [EN_VENTA, o.heroe ?? "Vendida · Puerta de Hierro · Zapopan"],
      [FIN_DE_LAS_TARJETAS, tarjeta(o.m2 ?? "350 m²", o.precio ?? "$8,400,000")],
      ["$6,480,000", o.fresnos ?? "$6,200,000"],
    ]);
  const solucion = hacer();
  return {
    id: "propiedad-vendida",
    nivel: "N3",
    resumen: "Tres vueltas de una asesora: una casa vendida, una nueva SIN precio ni metros en el mensaje (preguntar) y una bajada de precio.",
    inicio: { html: inicio },
    ficha: {
      negocio: "Asesora inmobiliaria independiente en Zapopan",
      datos: { precio_nogal: "$8,400,000", m2_nogal: "350 m²", banos_nogal: "4", precio_fresnos: "$6,200,000" },
    },
    guion: [
      { tipo: "pide", mensaje: "ya se vendio la Casa Roble 210!! ponle que esta vendida" },
      { tipo: "vuelve", mensaje: "agrega a las destacadas una nueva: Casa Nogal 18, en Puerta de Hierro, 4 recamaras" },
      { tipo: "vuelve", mensaje: "y bajale a la Casa Los Fresnos a $6,200,000" },
    ],
    graders: [
      contieneTexto("roble-vendida", "/", /vendid[ao].{0,120}Casa Roble 210|Casa Roble 210.{0,200}vendid[ao]/i),
      yaNoAparece("roble-ya-no-en-venta", EN_VENTA),
      contieneTexto("nogal-con-sus-metros", "/", /Casa Nogal 18.{0,120}350\s?m[²2]/i),
      datosDeLaFicha(["precio_nogal", "precio_fresnos"]),
      yaNoAparece("sin-precio-viejo", "$6,480,000"),
      // Tres vueltas sobre tres casas: las otras dos destacadas no se tocan.
      sigueAhi("siguen-las-otras-casas", "/", [/Depto Torre Vía 9[^$]{0,300}\$4,120,000/, /Casa Cantera 44[^$]{0,300}\$5,350,000/]),
      nadaInventado(),
      sinCifrasInventadas(),
      sinDesbordeMovil(),
      enlacesInternosVan(),
    ],
    solucion: { html: solucion },
    rotas: [
      { nombre: "roble-sigue-en-venta", datos: { html: hacer({ heroe: EN_VENTA }) } },
      // Hizo sitio a Casa Nogal quitando otra destacada.
      { nombre: "quito-de-mas", datos: { html: cambiar(solucion, [["Depto Torre Vía 9", "Casa Nogal 18"]]) } },
      // No preguntó: la puso sin precio.
      { nombre: "nogal-sin-precio", datos: { html: hacer({ precio: "Precio a consultar" }) } },
      // No preguntó: se inventó el precio.
      { nombre: "nogal-precio-inventado", datos: { html: hacer({ precio: "$8,000,000" }) } },
      { nombre: "nogal-metros-inventados", datos: { html: hacer({ m2: "300 m²" }) } },
      { nombre: "fresnos-sin-bajar", datos: { html: hacer({ fresnos: "$6,480,000" }) } },
      { nombre: "desborda", datos: { html: cambiar(solucion, [["</footer>", '<div style="width:900px">x</div></footer>']]) } },
      { nombre: "enlace-roto", datos: { html: cambiar(solucion, [["</nav>", '<a href="/propiedades/">Propiedades</a></nav>']]) } },
    ],
  };
}
