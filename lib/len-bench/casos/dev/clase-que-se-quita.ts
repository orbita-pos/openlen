// lib/len-bench/casos/dev/clase-que-se-quita.ts — N1, sobre una página REAL de
// OpenLen (plantilla `forja-gym`, gimnasio de fuerza en Monterrey).
//
// Cambio suelto en una TABLA: el dueño deja de dar la clase de las 20:00 entre
// semana. Lo que se mide: que la fila se vaya y que el resto del horario siga
// intacto (quitar de más es el otro fallo). No se pide cambiar la hora de
// cierre del pie («L-V 5:30–21:00»): el dueño no dijo que cerrara antes, y
// ponerle otra sería inventarla.
import fs from "node:fs";
import path from "node:path";
import type { Encargo } from "@/lib/len-bench/tipos";
import { cambiar } from "@/lib/len-bench/casos/cambiar";
import {
  contieneTexto,
  enlacesInternosVan,
  nadaInventado,
  sinCifrasInventadas,
  sinDesbordeMovil,
  yaNoAparece,
} from "@/lib/len-bench/graders";

const fila = (hora: string, clase: string) =>
  `            <tr><td class="px-5 py-3.5">${hora}</td><td class="px-5 py-3.5 text-[color:var(--fg)]">${clase}</td><td class="px-5 py-3.5">—</td></tr>\n`;

export function crear(dirPaginas: string): Encargo {
  const inicio = fs.readFileSync(path.join(dirPaginas, "clase-que-se-quita.inicio.html"), "utf8");
  const solucion = cambiar(inicio, [[fila("20:00", "Conditioning"), ""]]);
  return {
    id: "clase-que-se-quita",
    nivel: "N1",
    resumen: "Quitar del horario la clase de las 20:00 entre semana, sin llevarse otras filas.",
    inicio: { html: inicio },
    ficha: { negocio: "Gimnasio de fuerza y acondicionamiento en Monterrey", datos: {} },
    guion: [{ tipo: "pide", mensaje: "ya no vamos a dar la clase de las 8 de la noche entre semana, quitala del horario" }],
    graders: [
      // «20:00» a secas no: si Len pone en el pie que ahora se cierra a las
      // 20:00, el fallo no es haber dejado la clase.
      yaNoAparece("sin-la-clase-de-las-20", "20:00 Conditioning"),
      contieneTexto("sigue-el-resto-del-horario", "/", /5:30\s+Fuerza[\s\S]*9:00\s+Fundamentos[\s\S]*18:00\s+Fuerza[\s\S]*19:00\s+Halterofilia/),
      nadaInventado(),
      sinCifrasInventadas(),
      sinDesbordeMovil(),
      enlacesInternosVan(),
    ],
    solucion: { html: solucion },
    rotas: [
      // Se llevó también la de las 19:00.
      { nombre: "quito-de-mas", datos: { html: cambiar(solucion, [[fila("19:00", "Halterofilia"), ""]]) } },
      // «Avisa por WhatsApp» con un número que nadie dio.
      { nombre: "telefono-inventado", datos: { html: cambiar(solucion, [["</footer>", "<p>Dudas del horario: 81 1234 5678</p></footer>"]]) } },
      { nombre: "desborda", datos: { html: cambiar(solucion, [["</footer>", '<div style="width:900px">x</div></footer>']]) } },
      { nombre: "enlace-roto", datos: { html: cambiar(solucion, [["</nav>", '<a href="/reglamento/">Reglamento</a></nav>']]) } },
    ],
  };
}
