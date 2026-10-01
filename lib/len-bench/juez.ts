// lib/len-bench/juez.ts — EL JUEZ: el grader `llm` de las evals de Claude Code,
// copiado el 30/09/2026.
//
// Por qué existe: en el humo de resultados del 30/09 los graders de texto
// dieron 1,00 mientras Len decía cosas falsas («esas visitas son de
// previsualizaciones», «ayer» por hoy). Una búsqueda de texto sólo ve lo que se
// le dijo que buscara. Claude Code resuelve eso con dos familias de graders:
// los deterministas (regex, tool_used, tool_order, file_exists) DECIDEN, y un
// juez con UN criterio escrito mira lo que ellos no ven.
//
// Lo que se copia, tal cual lo hacen ellos:
//   - UN criterio por grader, escrito por el autor del caso.
//   - El juez ve una sola cosa (`foco`): por defecto el último mensaje, o la
//     TRAZA del encargo (su `trace`), CON lo que devolvió cada herramienta.
//   - Contesta UNA palabra, PASS o FAIL; un voto es PASS si dice PASS y no FAIL.
//   - TRES votos y gana la mayoría: el juez es ruidoso y votar lo reduce.
//   - Su gasto se cuenta APARTE (`gastoDelJuez`), y es un grader DE PAGO: el
//     validador, que corre a $0, lo salta y lo dice.
//   - Con entradas largas (más de 8.000 caracteres) lo avisa: «…».
// Y lo que dice la memoria `llm-judge-is-not-a-ship-gate`: un juez se estrena
// SIN votar (`puntua: false`, su `scored: false`) hasta que haya corpus.
import { callModel } from "@/lib/style-match/autofill/model-call";
import { modelIdForRole, roleForOperation } from "@/lib/generation/model-policy";
import { rateFor, usdDeTurno } from "@/lib/ai/tarifas-eval";
import { historialDesdeLaBase, type FilaDelHistorial, type MensajeDelHistorial } from "@/lib/agent/transcripcion";
import type { ContextoDeCalificacion, Grader } from "./tipos";

/** Votos por grader, los mismos que Claude Code. */
export const VOTOS_DEL_JUEZ = 3;
/** Más que esto, y el juez se vuelve ruidoso: lo avisa, como el suyo. */
export const LARGO_RUIDOSO = 8_000;
/** Lo que se le enseña como mucho; el resto se elide del MEDIO. */
const LARGO_MAXIMO = 24_000;

const SISTEMA = "Eres un juez de evaluación estricto y escueto para trazas de un agente.";
const PIDE = "Responde con exactamente una palabra: PASS o FAIL.";

/**
 * Sus focos son `trace`, `last_message`, `files`, `mock_calls` o un fichero;
 * aquí, los dos que tienen sentido en una conversación con Len.
 *
 * ⚰️ Hubo un foco «conversacion»: los textos del dueño y de Len, SIN las
 * herramientas. Ellos no lo tienen, y el 30/09 se vio por qué: el juez suspendió
 * tres veces de tres «estas visitas son de cuando estuvo publicada», que es
 * literalmente lo que contesta `ver_visitas`, porque no veía la herramienta y lo
 * leyó como una explicación inventada (corridas/2026-10-01-resultados-arreglos/).
 */
export type FocoDelJuez = "ultimo_mensaje" | "traza";
const NOMBRE_DEL_FOCO: Record<FocoDelJuez, string> = {
  ultimo_mensaje: "último mensaje",
  traza: "traza",
};

/**
 * LA TRAZA DEL ENCARGO desde las filas que escribió el servidor: el pedido del
 * dueño y, por cada turno, lo que vio el modelo —sus llamadas con los
 * argumentos y lo que devolvió cada herramienta— (la transcripción de H4). Su
 * `trace` es la transcripción del proceso hijo, `stream-json` entero.
 *
 * Por `historialDesdeLaBase`, la MISMA función que arma el historial del turno
 * siguiente, pero SIN presupuesto: aquél vacía los resultados viejos para que
 * quepan en el contexto del modelo; el juez tiene que ver lo que pasó. Lo largo
 * lo recorta `recortar` por el medio, como el suyo.
 */
export function trazaDeLasFilas(filas: readonly FilaDelHistorial[]): MensajeDelHistorial[] {
  return historialDesdeLaBase(filas, Infinity);
}

/** Una llamada al modelo del juez: el texto que contestó y lo que costó. */
export type LlamarAlJuez = (sistema: string, usuario: string) => Promise<{ texto: string; usd: number }>;

let gastado = 0;
/** Lo que ha costado el juez en este proceso, en dólares (ellos también lo dan aparte). */
export function gastoDelJuez(): number {
  return gastado;
}

const llamarDeVerdad: LlamarAlJuez = async (sistema, usuario) => {
  const r = await callModel({
    system: sistema,
    user: usuario,
    operation: "len_bench_juez",
    requestId: "len-bench-juez",
    maxOutputTokens: 16,
    // Con temperatura cero los tres votos saldrían iguales y votar no serviría.
    temperature: 0.7,
  });
  if (!r.ok) throw new Error(`el juez no contestó (${r.kind}): ${r.message}`);
  const tarifa = rateFor(modelIdForRole(roleForOperation("len_bench_juez")));
  const usd = r.usage ? usdDeTurno({ entrada: r.usage.inputTokens, cacheada: 0, salida: r.usage.outputTokens }, tarifa) : 0;
  return { texto: r.raw, usd };
};

/** El texto que ve el juez, según el foco. La traza, un mensaje por línea en
 *  JSON, como la suya. */
export function textoDelFoco(ctx: Pick<ContextoDeCalificacion, "conversacion" | "traza">, foco: FocoDelJuez): string {
  if (foco === "ultimo_mensaje") return [...ctx.conversacion].reverse().find((x) => x.quien === "len")?.texto ?? "";
  return ctx.traza.map((m) => JSON.stringify(m)).join("\n");
}

/** Un voto: PASS si lo dice y no dice también FAIL, como el suyo. */
export function votoDe(respuesta: string): boolean {
  return /\bPASS\b/i.test(respuesta) && !/\bFAIL\b/i.test(respuesta);
}

function recortar(texto: string): string {
  if (texto.length <= LARGO_MAXIMO) return texto;
  const mitad = Math.floor(LARGO_MAXIMO / 2);
  return `${texto.slice(0, mitad)}\n[…${texto.length - LARGO_MAXIMO} caracteres omitidos…]\n${texto.slice(-mitad)}`;
}

/** El prompt del juez: el suyo, con la misma forma. */
export function promptDelJuez(criterio: string, foco: FocoDelJuez, texto: string): string {
  return `Calificas la salida de un agente contra un criterio.\n\nCriterio:\n${criterio}\n\n\nSalida del agente (${NOMBRE_DEL_FOCO[foco]}):\n${recortar(texto)}\n\n\n${PIDE}`;
}

export function juez(
  o: {
    readonly nombre: string;
    readonly criterio: string;
    readonly foco?: FocoDelJuez;
    readonly peso?: number;
    /** `false` = corre, se reporta y no vota. Así se estrena un juez. */
    readonly puntua?: false;
  },
  llamar: LlamarAlJuez = llamarDeVerdad,
): Grader {
  const foco = o.foco ?? "ultimo_mensaje";
  return {
    nombre: o.nombre,
    peso: o.peso ?? 1,
    ...(o.puntua === false ? { puntua: false as const } : {}),
    pago: true,
    async calificar(ctx) {
      const texto = textoDelFoco(ctx, foco);
      // Nada que juzgar no se paga: no hay a quién preguntar.
      if (texto.trim() === "") return { paso: false, explicacion: `no hubo ${NOMBRE_DEL_FOCO[foco]} de Len que juzgar` };
      const prompt = promptDelJuez(o.criterio, foco, texto);
      const votos: boolean[] = [];
      for (let i = 0; i < VOTOS_DEL_JUEZ; i++) {
        const r = await llamar(SISTEMA, prompt);
        gastado += r.usd;
        votos.push(votoDe(r.texto));
      }
      const paso = votos.filter(Boolean).length > votos.length / 2;
      const ruidoso = texto.length > LARGO_RUIDOSO
        ? ` — ojo: entrada larga (${texto.length} caracteres); los jueces son ruidosos con entradas largas, mejor un grader determinista`
        : "";
      return { paso, explicacion: `votos del juez: ${votos.map((v) => (v ? "PASS" : "FAIL")).join(" ")}${ruidoso}`, votos };
    },
  };
}
