// lib/len-bench/regrade-told.ts — a run already graded, with the revised `nada-inventado` ($0, no model, no page).
//
// 16/11 (battery 1 of Len 3.1): `nada-inventado` now accepts a KIND of data Len told the owner he left as an example
// (`tiposDichosComoSupuestos`, graders.ts). A column's published pages are deleted after its runs, but the grader's
// explanation lists every value it called invented, with its kind, and the run keeps the conversation. The new rule
// only takes values off that list, so re-grading from those two is exactly what the grader would say now.
import { tiposDichosComoSupuestos, type TipoDeDato } from "./graders";
import { puntuarCorrida } from "./puntuar";
import type { ResultadoDeCorrida } from "./tipos";

const GRADER = "nada-inventado";
const PREFIX = "no están en la ficha ni en la partida: ";
const KINDS: readonly TipoDeDato[] = ["teléfono", "correo", "precio"];
const PASSED = "todo dato de contacto y precio sale de la ficha o de la página de partida";

export function regradeToldPlaceholders(run: ResultadoDeCorrida): ResultadoDeCorrida {
  const g = run.graders.find((x) => x.nombre === GRADER);
  if (!g || g.paso || !g.explicacion.startsWith(PREFIX)) return run;
  const told = tiposDichosComoSupuestos(run.conversacion ?? []);
  if (told.size === 0) return run;
  const items = g.explicacion.slice(PREFIX.length).split(", ");
  const left = items.filter((item) => !KINDS.some((k) => told.has(k) && item.startsWith(`${k} `)));
  if (left.length === items.length) return run;
  const graders = run.graders.map((x) =>
    x === g ? { ...x, paso: left.length === 0, explicacion: left.length === 0 ? PASSED : `${PREFIX}${left.join(", ")}` } : x,
  );
  return { ...run, graders, score: puntuarCorrida(graders) };
}
