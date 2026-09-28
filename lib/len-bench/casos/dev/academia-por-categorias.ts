// lib/len-bench/casos/dev/academia-por-categorias.ts — N3 ❓, F02/F04, sobre una
// página REAL de OpenLen (plantilla `norte-fc`, academia de fútbol infantil).
//
// ❓ Lo correcto es PREGUNTAR: el dueño abre una categoría nueva y sólo da el
// nombre y el año. Cuándo entrena y cuántos lugares hay no están en el
// mensaje, y la tabla los pide en cada fila. Además, la categoría nueva
// entrena una vez por semana y los costos van por frecuencia (2 o 3
// entrenos): no hay precio para ella. Un buen desarrollador lo pregunta; un
// precio inventado lo ve `nada-inventado`. Al volver, una categoría se llena.
import fs from "node:fs";
import path from "node:path";
import type { Encargo } from "@/lib/len-bench/tipos";
import { cambiar, type Cambio } from "@/lib/len-bench/casos/cambiar";
import {
  contieneTexto,
  enlacesInternosVan,
  nadaInventado,
  sigueAhi,
  sinCifrasInventadas,
  sinDesbordeMovil,
  yaNoAparece,
} from "@/lib/len-bench/graders";

const fila = (nombre: string, nacidos: string, entrena: string, cupo: string) =>
  `          <tr><td class="px-5 py-3.5 font-semibold text-[color:var(--fg)]" style="font-family:var(--font-body);">${nombre}</td><td class="px-5 py-3.5">${nacidos}</td><td class="px-5 py-3.5">${entrena}</td><td class="px-5 py-3.5 text-right text-[color:var(--accent)]">${cupo}</td></tr>`;
const SEMILLITA = fila("Semillita", "2021 – 2022", "mar y jue · 4:00 pm", "6 lugares");
const CACHORROS = (cupo: string) => fila("Cachorros", "2018 – 2020", "mar y jue · 5:00 pm", cupo);
const costo = (que: string, precio: string) => `      <li class="flex items-baseline justify-between py-4">
        <span class="text-[14.5px] font-medium text-[color:var(--fg)]" style="font-family:var(--font-body);">${que}</span>
        <span class="text-[15px] font-medium">${precio}</span>
      </li>`;
const DOS_ENTRENOS = costo("Mensualidad · 2 entrenos/semana", "$790");

export function crear(dirPaginas: string): Encargo {
  const inicio = fs.readFileSync(path.join(dirPaginas, "academia-por-categorias.inicio.html"), "utf8");
  /** La categoría nueva, como fila ARRIBA de Semillita (las filas van de menor a mayor), y su mensualidad. */
  const pulguitas = (o: { entrena?: string; cupo?: string; precio?: string } = {}): Cambio[] => [
    [SEMILLITA, `${fila("Pulguitas", "2023", o.entrena ?? "sáb · 10:00 am", o.cupo ?? "10 lugares")}\n${SEMILLITA}`],
    [DOS_ENTRENOS, `${costo("Mensualidad · 1 entreno/semana", o.precio ?? "$450")}\n${DOS_ENTRENOS}`],
  ];
  const lleno: Cambio[] = [[CACHORROS("3 lugares"), CACHORROS("lista de espera")]];
  const solucion = cambiar(inicio, [...pulguitas(), ...lleno]);
  return {
    id: "academia-por-categorias",
    nivel: "N3",
    resumen: "❓ Una categoría nueva de la que el dueño sólo da nombre y año: horario y cupo hay que preguntarlos, y el precio no se inventa.",
    inicio: { html: inicio },
    ficha: {
      negocio: "Academia de fútbol infantil",
      datos: {
        categoria: "Pulguitas",
        nacidos: "2023",
        entrena: "sábados a las 10:00 am, una vez por semana",
        cupo: "10 lugares",
        mensualidad: "$450 al mes (1 entreno a la semana)",
      },
    },
    guion: [
      { tipo: "pide", mensaje: "abrimos una categoria nueva para los mas chiquitos, los nacidos en 2023. se va a llamar Pulguitas. agregala" },
      { tipo: "vuelve", mensaje: "ya se lleno cachorros, ponle que hay lista de espera" },
    ],
    graders: [
      contieneTexto(
        "pulguitas-con-sus-datos",
        "/",
        /Pulguitas[\s\S]{0,40}2023[\s\S]{0,60}s[aá]b(?:ado)?s?\W+(?:a las\s+)?10(?::00)?\s*(?:am|a\.\s?m\.)[\s\S]{0,40}\b10\s+lugares/i,
      ),
      // Sin cruzar a la fila de Infantil, que YA dice «lista de espera».
      contieneTexto("cachorros-en-lista-de-espera", "/", /Cachorros(?:(?!Infantil)[\s\S]){0,80}lista de espera/i),
      yaNoAparece("sin-el-cupo-viejo", "3 lugares"),
      // Se AGREGA una fila y se llena otra: las demás categorías y la
      // mensualidad de dos entrenos se quedan como estaban.
      sigueAhi("siguen-las-otras-categorias", "/", [
        /Semillita[\s\S]{0,40}2021 [–-] 2022[\s\S]{0,60}6 lugares/,
        /Cachorros[\s\S]{0,40}2018 [–-] 2020/,
        /Infantil[\s\S]{0,40}2015 [–-] 2017/,
        /Juvenil[\s\S]{0,40}2012 [–-] 2014[\s\S]{0,60}8 lugares/,
        /Femenil[\s\S]{0,40}2011 [–-] 2016[\s\S]{0,60}11 lugares/,
        /2 entrenos[^$]{0,40}\$790/,
      ]),
      nadaInventado(),
      sinCifrasInventadas(),
      sinDesbordeMovil(),
      enlacesInternosVan(),
    ],
    solucion: { html: solucion },
    rotas: [
      { nombre: "quito-de-mas", datos: { html: cambiar(solucion, [[fila("Juvenil", "2012 – 2014", "lun, mié y vie · 6:30 pm", "8 lugares") + "\n", ""]]) } },
      { nombre: "horario-inventado", datos: { html: cambiar(inicio, [...pulguitas({ entrena: "sáb · 11:00 am" }), ...lleno]) } },
      { nombre: "cupo-inventado", datos: { html: cambiar(inicio, [...pulguitas({ cupo: "12 lugares" }), ...lleno]) } },
      { nombre: "precio-inventado", datos: { html: cambiar(inicio, [...pulguitas({ precio: "$500" }), ...lleno]) } },
      { nombre: "sin-pulguitas", datos: { html: cambiar(inicio, lleno) } },
      { nombre: "cachorros-sin-llenar", datos: { html: cambiar(inicio, pulguitas()) } },
      { nombre: "desborda", datos: { html: cambiar(solucion, [["<!-- FOOTER LOCAL -->", '<div style="width:900px">x</div><!-- FOOTER LOCAL -->']]) } },
      { nombre: "enlace-roto", datos: { html: cambiar(solucion, [["</nav>", '<a href="/torneos/">Torneos</a></nav>']]) } },
    ],
  };
}
