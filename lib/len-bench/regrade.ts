// lib/len-bench/regrade.ts — a run already run, graded with the rules as they are now ($0, no model, no page).
//
// 16/11 (battery 1 of Len 3.1): `nada-inventado` now accepts a KIND of data Len told the owner he left as an example
// (`tiposDichosComoSupuestos`, graders.ts). A column's published pages are deleted after its runs, but the grader's
// explanation lists every value it called invented, with its kind, and the run keeps the conversation. The new rule
// only takes values off that list, so re-grading from those two is exactly what the grader would say now.
import { tiposDichosComoSupuestos, type TipoDeDato } from "./graders";
import { puntuarCorrida } from "./puntuar";
import { BenchClockError } from "./sesion";
import type { ResultadoDeCorrida } from "./tipos";

const GRADER = "nada-inventado";
const PREFIX = "no están en la ficha ni en la partida: ";
const KINDS: readonly TipoDeDato[] = ["teléfono", "correo", "precio"];
const PASSED = "todo dato de contacto y precio sale de la ficha o de la página de partida";

/** What the fetch threw when the bench's clock aborted it, before 16/11. The only abort in the runner is that
 *  clock (`enviarTurno`, sesion.ts), so a stored run with this error was cut by it. */
const OLD_CLOCK_ABORT = "This operation was aborted";
const OLD_CLOCK_MS = 1_200_000;

/** A stored run the old 20-min clock cut, as the conductor would record it now: the harness's (`plazo_del_banco`). */
export function reclassifyBenchClock(run: ResultadoDeCorrida): ResultadoDeCorrida {
  if (run.desenlace !== "error_de_len" || run.error !== OLD_CLOCK_ABORT) return run;
  return { ...run, desenlace: "plazo_del_banco", error: new BenchClockError(OLD_CLOCK_MS).message };
}

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
