// lib/len-bench/casos/dev/cifra-de-la-ong.ts — N3, F01/F04, sobre una página REAL
// de OpenLen (plantilla `semilla-abierta`, ONG de bibliotecas comunitarias).
//
// La cifra gigante del héroe es LA cifra de la página, y sale dos veces (el
// héroe y el bloque de impacto); las bibliotecas salen en tres sitios (el
// héroe, «23 salas activas» en programas y el bloque de impacto), y el corte
// dice «junio». Cambiar la cifra grande y dejar lo demás es el fallo de
// siempre (F01: «Listo» sobre algo a medias). Al volver, los botones de donar
// —dos se quedan en `href="#"` en la plantilla— al PayPal de la ONG.
import fs from "node:fs";
import path from "node:path";
import type { Encargo } from "@/lib/len-bench/tipos";
import { cambiar, type Cambio } from "@/lib/len-bench/casos/cambiar";
import {
  botonesQueDicenVan,
  contieneTexto,
  enlacesInternosVan,
  nadaInventado,
  noContieneTexto,
  sigueAhi,
  sinCifrasInventadas,
  sinDesbordeMovil,
  yaNoAparece,
} from "@/lib/len-bench/graders";

const PAYPAL = "https://www.paypal.com/donate/?hosted_button_id=SEMILLA26";
const CIFRA_HEROE = (n: string) => `leading-[0.9] text-[color:var(--accent)]">${n}</div>`;
const CIFRA_IMPACTO = (n: string) => `<div class="mono tabular text-[34px] font-medium leading-none sm:text-[40px]">${n}</div>`;
const DONA_TARJETA = (href: string) =>
  `<a href="${href}" class="btn-primary lift inline-flex h-10 w-full items-center justify-center rounded-full text-[13.5px] font-medium">Dona</a>`;
const DONA_FINAL = (href: string) =>
  `<a href="${href}" class="lift inline-flex h-11 items-center rounded-full bg-[var(--accent-ink)] px-7 text-[14px] font-medium text-[color:var(--accent)]">Dona</a>`;

export function crear(dirPaginas: string): Encargo {
  const inicio = fs.readFileSync(path.join(dirPaginas, "cifra-de-la-ong.inicio.html"), "utf8");
  const cifras = (o: { lectores?: [heroe: string, impacto: string]; bibliotecas?: [heroe: string, salas: string, impacto: string]; corte?: string } = {}): Cambio[] => {
    const [lh, li] = o.lectores ?? ["2,315", "2,315"];
    const [bh, bs, bi] = o.bibliotecas ?? ["26", "26", "26"];
    return [
      [CIFRA_HEROE("1,842"), CIFRA_HEROE(lh)],
      [CIFRA_IMPACTO("1,842"), CIFRA_IMPACTO(li)],
      ["Lectores activos en 23 bibliotecas", `Lectores activos en ${bh} bibliotecas`],
      ["23 salas activas", `${bs} salas activas`],
      [CIFRA_IMPACTO("23"), CIFRA_IMPACTO(bi)],
      ["Impacto · corte a junio de 2026", `Impacto · corte a ${o.corte ?? "septiembre"} de 2026`],
    ];
  };
  const donar = (tarjeta = PAYPAL, final = PAYPAL): Cambio[] => [
    [DONA_TARJETA("#"), DONA_TARJETA(tarjeta)],
    [DONA_FINAL("#"), DONA_FINAL(final)],
  ];
  const solucion = cambiar(inicio, [...cifras(), ...donar()]);
  return {
    id: "cifra-de-la-ong",
    nivel: "N3",
    resumen: "La cifra de una ONG que sale en dos sitios y las bibliotecas en tres; al volver, los botones de donar a su PayPal.",
    inicio: { html: inicio },
    ficha: {
      negocio: "ONG de bibliotecas comunitarias en Los Altos de Chiapas",
      datos: { lectores: "2,315", bibliotecas: "26", corte: "septiembre de 2026", donativos: PAYPAL },
    },
    guion: [
      {
        tipo: "pide",
        mensaje: "ya tenemos el corte de septiembre: son 2,315 niñas y niños leyendo y ya vamos en 26 bibliotecas. actualizalo en la pagina porfa",
      },
      { tipo: "vuelve", mensaje: `hola! que los botones de donar lleven a nuestro paypal: ${PAYPAL}` },
    ],
    graders: [
      yaNoAparece("sin-la-cifra-vieja", "1,842"),
      contieneTexto("cifras-nuevas", "/", /^(?=[\s\S]*2[,.\s]?315)(?=[\s\S]*\b26\s+(?:bibliotecas|salas))/i),
      noContieneTexto("sin-bibliotecas-viejas", "/", /\b23\s+(?:bibliotecas|salas)/i),
      noContieneTexto("sin-corte-viejo", "/", /junio de 2026/i),
      // Cambian lectores y bibliotecas; las OTRAS cifras de la franja y de los
      // datos duros no son del corte y se quedan.
      sigueAhi("siguen-las-otras-cifras", "/", [/\b96\s*Mediadores formados/, /\b9\s*Municipios de Los Altos/, /87¢ de cada peso/, /Las 7 personas del consejo/]),
      botonesQueDicenVan("botones-de-donar-van", /\bdona\b/i, "donativos"),
      nadaInventado(),
      sinCifrasInventadas(),
      sinDesbordeMovil(),
      enlacesInternosVan(),
    ],
    solucion: { html: solucion },
    rotas: [
      // La cifra grande del héroe, y el bloque de impacto con la vieja.
      { nombre: "cifra-solo-en-el-heroe", datos: { html: cambiar(inicio, [...cifras({ lectores: ["2,315", "1,842"] }), ...donar()]) } },
      // Las del héroe y el bloque de impacto, y la sala de programas con 23.
      { nombre: "salas-sin-cambiar", datos: { html: cambiar(inicio, [...cifras({ bibliotecas: ["26", "23", "26"] }), ...donar()]) } },
      { nombre: "bibliotecas-sin-cambiar", datos: { html: cambiar(inicio, [...cifras({ bibliotecas: ["23", "23", "23"] }), ...donar()]) } },
      { nombre: "quito-de-mas", datos: { html: cambiar(solucion, [["Mediadores formados", ""]]) } },
      { nombre: "corte-viejo", datos: { html: cambiar(inicio, [...cifras({ corte: "junio" }), ...donar()]) } },
      { nombre: "cifra-mal-copiada", datos: { html: cambiar(inicio, [...cifras({ lectores: ["2,351", "2,351"] }), ...donar()]) } },
      { nombre: "dona-de-la-tarjeta-muerto", datos: { html: cambiar(inicio, [...cifras(), ...donar("#")]) } },
      // Un monto que nadie dio, colado al tocar la tarjeta de donativos.
      { nombre: "monto-inventado", datos: { html: cambiar(solucion, [["$150 mensuales sostienen", "$150 mensuales (o $500 una sola vez) sostienen"]]) } },
      { nombre: "paypal-de-otro", datos: { html: cambiar(inicio, [...cifras(), ...donar(PAYPAL, "https://www.paypal.com/donate/?hosted_button_id=OTRA")]) } },
      // La vuelta hecha sobre la página de ANTES: los botones van, las cifras vuelven a las viejas.
      { nombre: "la-vuelta-sobre-la-pagina-vieja", datos: { html: cambiar(inicio, donar()) } },
      { nombre: "desborda", datos: { html: cambiar(solucion, [["<!-- FOOTER LOCAL -->", '<div style="width:900px">x</div><!-- FOOTER LOCAL -->']]) } },
      { nombre: "enlace-roto", datos: { html: cambiar(solucion, [["</nav>", '<a href="/informes/">Informes</a></nav>']]) } },
    ],
  };
}
