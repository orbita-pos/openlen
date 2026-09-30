// lib/agent/revision/revisar-turno.ts — H14: la revisión entera de un turno, con la receta de Claude Code.
//
// Las fases de `/code-review`, en el orden en que corren:
//   · esfuerzo BAJO («1 diff pass → no verify → ≤4 findings»): un revisor con
//     los cuatro ángulos y ya está;
//   · esfuerzo MEDIO («angles × 6 candidates → 1-vote verify → ≤8 findings»):
//     un buscador por ángulo, todos a la vez y cada uno con contexto limpio;
//     deduplicar («…»); un verificador por candidato, y se quedan CONFIRMED y
//     PLAUSIBLE. Medio es «precision»: un aviso falso puede hacer que Len
//     deshaga lo que sí se pidió, y eso es lo que mata la hipótesis.
//
// Quién corre cada llamada viene INYECTADO (`correr`): en la ruta es el
// subagente de solo lectura (`lib/agent/subagente.ts`); en las pruebas, uno
// falso. Así todo esto se prueba sin gastar.
//
// Lo que NO decide el modelo aquí, y en Claude Code sí (allí orquesta el propio
// Claude): cuándo dos candidatos son el mismo y cuál es más grave. Aquí va sin
// modelo, para no pagar una llamada más: mismo fichero y misma línea es el
// mismo sitio, «más concreto» es el escenario más largo, y la gravedad es el
// veredicto y luego el puesto que le dio su buscador. Es una aproximación, y se
// dice.

import type { NivelEsfuerzo } from "@/lib/agent/esfuerzo";
import {
  ANGULOS_EN_ORDEN,
  MAX_POR_BUSCADOR,
  MAX_UNA_PASADA,
  SISTEMA_DEL_REVISOR,
  encargoDeUnaPasada,
  encargoDelBuscador,
  encargoDelVerificador,
  leerCandidatos,
  leerVeredicto,
  tareaDeRevision,
  type Candidato,
} from "./receta";

export interface Uso {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedTokens: number;
  readonly thinkingTokens: number;
}

export const USO_CERO: Uso = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, thinkingTokens: 0 };

const sumar = (a: Uso, b: Uso): Uso => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  cachedTokens: a.cachedTokens + b.cachedTokens,
  thinkingTokens: a.thinkingTokens + b.thinkingTokens,
});

/** Lo que devuelve una llamada de revisión: el texto final del revisor, o por
 *  qué no lo hay. El uso va en los dos casos: una llamada caída también cuesta.
 *  `vueltas`, cuántas veces llamó al modelo, es para medir la espera. */
export type Corrida =
  | { readonly ok: true; readonly texto: string; readonly uso: Uso; readonly vueltas?: number }
  | { readonly ok: false; readonly motivo: string; readonly uso: Uso; readonly vueltas?: number };

/** Corre UN revisor: su prompt de sistema y sus mensajes de usuario, en orden
 *  (la tarea común primero, su encargo al final: ver `SISTEMA_DEL_REVISOR`). */
export type Correr = (sistema: string, mensajes: readonly string[]) => Promise<Corrida>;

export type ModoDeRevision = "una_pasada" | "completa";

/**
 * Qué receta se usa en los turnos grandes: `por_pasos` es la de la ficha (una
 * pasada de 5 a 9 pasos y la completa desde 10: el esfuerzo medio de Claude
 * Code en los grandes); `una_pasada` es siempre la pasada única, el esfuerzo
 * BAJO de `/code-review` («1 diff pass → no verify → ≤4 findings»).
 */
export type Receta = "por_pasos" | "una_pasada";

/** Desde cuántos pasos (llamadas al modelo en el turno) se revisa. Un cambio de
 *  título no dispara nada (ficha H14, c9 §3–§4). */
export const PASOS_PARA_UNA_PASADA = 5;
export const PASOS_PARA_LA_COMPLETA = 10;

/** Qué revisión le toca a un turno de `pasos` pasos; `null` si ninguna. */
export function modoDeRevision(pasos: number, receta: Receta = "por_pasos"): ModoDeRevision | null {
  if (pasos < PASOS_PARA_UNA_PASADA) return null;
  if (receta === "una_pasada") return "una_pasada";
  return pasos >= PASOS_PARA_LA_COMPLETA ? "completa" : "una_pasada";
}

/**
 * LOS TRES AJUSTES DEL COSTE Y LA ESPERA. La primera pasada pagada (29/09, ficha
 * H14) midió $0,53 y 883 s en un turno grande con la receta completa: el 60 %
 * fue pensar (los revisores heredaban el esfuerzo de Len, `auto` = alto) y el
 * resto, leer; cada revisor dio unas 6 vueltas (deducido de los tokens), y los
 * 7 verificadores no tumbaron nada. Cada ajuste ataca una de esas partes.
 *
 * Los valores de aquí son los que ya se midieron. Los nuevos se miden en la
 * herramienta de la pasada (`--receta`, `--esfuerzo`, `--vueltas`) y, si
 * compensan, se cambian aquí: una línea cada uno.
 */
export interface AjustesDeRevision {
  readonly receta: Receta;
  /** Cuánto piensa cada revisor. `null` = el de Len, que es lo que hace Claude
   *  Code: sus subagentes (Explore, Plan) heredan el del principal. */
  readonly esfuerzo: NivelEsfuerzo | null;
  /** Vueltas de cada revisor antes de pedirle que conteste; `null` = el tope
   *  del subagente (`MAX_VUELTAS_DEL_SUBAGENTE`). */
  readonly vueltas: number | null;
}

export const AJUSTES_DE_REVISION: AjustesDeRevision = { receta: "por_pasos", esfuerzo: null, vueltas: null };

/** El «≤8 findings» del esfuerzo medio. */
export const MAX_HALLAZGOS = 8;

/** Cuántos mensajes anteriores del usuario ve el revisor, los últimos. Claude
 *  Code no tiene esto (su revisión no mira la petición): es lo que pide el
 *  ángulo de alcance cuando lo pedido se reparte entre turnos. */
export const MENSAJES_ANTERIORES = 6;

/** Cuántas llamadas a la vez: el `CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY ?? 10`
 *  de Claude Code, que es lo que limita cuántos subagentes corren juntos. */
export const EN_PARALELO = 10;

export interface Hallazgo extends Candidato {
  /** `null` en la pasada única, que no verifica. */
  readonly veredicto: "CONFIRMED" | "PLAUSIBLE" | null;
  /** La cita con la que el verificador lo sostuvo. */
  readonly evidencia?: string;
}

export interface ResultadoRevision {
  readonly modo: ModoDeRevision;
  /** Lo que llega a Len, los más graves primero. */
  readonly hallazgos: readonly Hallazgo[];
  /** Lo que trajeron los buscadores, antes de deduplicar. */
  readonly candidatos: number;
  /** Los que el verificador tumbó con una cita. */
  readonly refutados: number;
  /** Llamadas que cayeron o cuya respuesta no se entendió. No son «sin
   *  hallazgos»: se cuentan aparte para poder medirlas. */
  readonly fallos: number;
  readonly llamadas: number;
  readonly uso: Uso;
}

/** `f` sobre cada elemento, con `n` a la vez como mucho, en el orden de entrada. */
async function enParalelo<T, R>(xs: readonly T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length);
  let siguiente = 0;
  const obrero = async () => {
    while (siguiente < xs.length) {
      const i = siguiente++;
      out[i] = await f(xs[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, xs.length) }, obrero));
  return out;
}

type ConPuesto = Candidato & { readonly puesto: number };

/**
 * «…» El mismo sitio es el mismo fichero
 * y la misma línea; sin línea, el mismo fichero y el mismo resumen. El que se
 * queda hereda el mejor puesto de los dos.
 */
export function deduplicar<T extends ConPuesto>(cs: readonly T[]): T[] {
  const porSitio = new Map<string, T>();
  for (const c of cs) {
    const sitio = c.line !== null ? `${c.file}\u0000${c.line}` : `${c.file}\u0000${c.summary.toLowerCase()}`;
    const ya = porSitio.get(sitio);
    if (!ya) {
      porSitio.set(sitio, c);
      continue;
    }
    const gana = c.failure_scenario.length > ya.failure_scenario.length ? c : ya;
    porSitio.set(sitio, { ...gana, puesto: Math.min(c.puesto, ya.puesto) });
  }
  return [...porSitio.values()];
}

const RANGO_VEREDICTO = { CONFIRMED: 0, PLAUSIBLE: 1 } as const;

const NOMBRE_ANGULO: Readonly<Record<NonNullable<Candidato["angulo"]>, string>> = {
  alcance: "alcance",
  quitado: "lo quitado",
  procedencia: "procedencia",
  dicho: "lo dicho contra lo hecho",
};
const NOMBRE_VEREDICTO = { CONFIRMED: "confirmado", PLAUSIBLE: "plausible" } as const;

/**
 * LO QUE RECIBE LEN cuando hay hallazgos: el hook de `Stop` de Claude Code, que
 * no deja cerrar y le devuelve al modelo por qué. La forma es la del objetivo
 * (`SISTEMA (el usuario NO escribió esto): …`) y cada hallazgo va como una línea
 * de `<new-diagnostics>`, que es lo que Len ya sabe leer: fichero, línea, qué,
 * qué sale mal, de qué ángulo y con qué voto.
 *
 * 🔴 ES CONSEJO, NO UN VEREDICTO (Aurora, el comprobador que acertó 0 de 3): Len
 * lo comprueba y decide. Y la frase de no deshacer lo pedido es la condición
 * que mata la hipótesis (ficha H14): un aviso falso no puede costarle al
 * usuario lo que pidió.
 */
export function avisoDeRevision(hallazgos: readonly Hallazgo[]): string {
  const porFichero = new Map<string, Hallazgo[]>();
  for (const h of hallazgos) porFichero.set(h.file, [...(porFichero.get(h.file) ?? []), h]);
  const lista = [...porFichero]
    .map(
      ([file, hs]) =>
        `${file}:\n` +
        hs
          .map((h) => {
            const donde = h.line !== null ? `[Line ${h.line}]` : "[no line]";
            const de = [h.angulo ? NOMBRE_ANGULO[h.angulo] : null, h.veredicto ? NOMBRE_VEREDICTO[h.veredicto] : "sin verificar"]
              .filter(Boolean)
              .join(" · ");
            return `  ${donde} ${h.summary} — ${h.failure_scenario} (${de})`;
          })
          .join("\n"),
    )
    .join("\n\n");
  return (
    "SISTEMA (el usuario NO escribió esto): antes de cerrar, un revisor aparte —el mismo modelo, que no vio esta " +
    "conversación: sólo la petición del usuario, el diff de este turno y tu mensaje de cierre— marcó esto:\n\n" +
    `${lista}\n\n` +
    "Es consejo, no un veredicto, y puede equivocarse: compruébalo en los ficheros antes de tocar nada. Si es cierto, " +
    "arréglalo o díselo al usuario; si no, déjalo. No deshagas nada que el usuario haya pedido por un punto de esta " +
    "lista. Después, cuéntale al usuario en una frase qué hiciste con ello."
  );
}

export async function revisarTurno(o: {
  readonly modo: ModoDeRevision;
  readonly peticion: string;
  /** Lo que el usuario escribió en turnos anteriores (ver `tareaDeRevision`). */
  readonly anteriores?: readonly string[];
  readonly diff: string;
  readonly cierre: string;
  readonly correr: Correr;
}): Promise<ResultadoRevision> {
  let uso = USO_CERO;
  let fallos = 0;
  let llamadas = 0;
  /** Una llamada que no puede tumbar la revisión: si lanza, es un fallo más. */
  const correr = async (encargo: string): Promise<Corrida> => {
    llamadas += 1;
    let r: Corrida;
    try {
      r = await o.correr(SISTEMA_DEL_REVISOR, [tarea, encargo]);
    } catch (e) {
      r = { ok: false, motivo: e instanceof Error ? e.message : String(e), uso: USO_CERO };
    }
    uso = sumar(uso, r.uso);
    return r;
  };
  const leer = (r: Corrida, max: number): Candidato[] => {
    const cs = r.ok ? leerCandidatos(r.texto, max) : null;
    if (cs === null) fallos += 1;
    return cs ?? [];
  };

  const tarea = tareaDeRevision({ peticion: o.peticion, anteriores: o.anteriores, diff: o.diff, cierre: o.cierre });

  if (o.modo === "una_pasada") {
    const cs = leer(await correr(encargoDeUnaPasada()), MAX_UNA_PASADA);
    return {
      modo: o.modo,
      hallazgos: cs.map((c) => ({ ...c, veredicto: null })),
      candidatos: cs.length,
      refutados: 0,
      fallos,
      llamadas,
      uso,
    };
  }

  // FASE 1 — un buscador por ángulo, todos a la vez y con la MISMA tarea delante:
  // así la entrada de todos es igual hasta su encargo y se lee de caché.
  const porAngulo = await enParalelo(ANGULOS_EN_ORDEN, EN_PARALELO, async (angulo) =>
    leer(await correr(encargoDelBuscador(angulo)), MAX_POR_BUSCADOR).map(
      (c, puesto): ConPuesto => ({ ...c, angulo, puesto }),
    ),
  );
  const todos = porAngulo.flat();
  const unicos = deduplicar(todos);

  // FASE 2 — un verificador por candidato, de un voto y tres salidas.
  const votos = await enParalelo(unicos, EN_PARALELO, async (c) => {
    const r = await correr(encargoDelVerificador(c));
    const voto = r.ok ? leerVeredicto(r.texto) : null;
    if (voto === null) fallos += 1;
    return voto;
  });

  let refutados = 0;
  const sostenidos: (Hallazgo & { puesto: number })[] = [];
  unicos.forEach((c, i) => {
    const voto = votos[i];
    if (voto?.veredicto === "REFUTED") refutados += 1;
    // «…» Un voto que
    // no se entendió no es ninguno de los dos: con medio, precisión, se cae.
    if (voto?.veredicto !== "CONFIRMED" && voto?.veredicto !== "PLAUSIBLE") return;
    sostenidos.push({ ...c, veredicto: voto.veredicto, ...(voto.evidencia ? { evidencia: voto.evidencia } : {}) });
  });

  const ordenAngulo = (h: Hallazgo) => (h.angulo ? ANGULOS_EN_ORDEN.indexOf(h.angulo) : ANGULOS_EN_ORDEN.length);
  const hallazgos = sostenidos
    .sort(
      (a, b) =>
        RANGO_VEREDICTO[a.veredicto as "CONFIRMED" | "PLAUSIBLE"] - RANGO_VEREDICTO[b.veredicto as "CONFIRMED" | "PLAUSIBLE"] ||
        a.puesto - b.puesto ||
        ordenAngulo(a) - ordenAngulo(b),
    )
    .slice(0, MAX_HALLAZGOS)
    .map(({ puesto: _puesto, ...h }) => h);

  return { modo: o.modo, hallazgos, candidatos: todos.length, refutados, fallos, llamadas, uso };
}
