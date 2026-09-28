// lib/len-bench/tipos.ts — LEN-BENCH, la vara de Len 2.0 (plans/len-2/diseno.md).
//
// Un ENCARGO es la unidad, no una instrucción: se da por hecho cuando la web
// está publicada y funciona. Por eso cada caso trae la página de partida, lo
// que sabe el dueño (la ficha), lo que pide y cuándo (el guion), cómo se
// califica (los graders), una SOLUCIÓN resuelta a mano —la prueba de que el
// caso se puede hacer y de que sus graders aprueban una buena— y variantes
// ROTAS —la prueba de que cada grader sabe suspender—.
//
// La forma de los resultados es la del corredor de evals de Claude Code
// (memoria `claude-code-plugin-eval-estructura`): caso → corridas → graders,
// cada grader con nombre, peso y explicación, y `puntua:false` para el que se
// estrena sin corpus: corre, se reporta y no vota.

import type { Browser } from "puppeteer";
import type { ProjectData } from "@/lib/projects/types";

export type Nivel = "N1" | "N2" | "N3";

/** Lo que sabe el dueño. Contesta con esto y con nada más. */
export interface Ficha {
  /** «Taquería de barrio en Guadalajara», sin nombres reales. */
  readonly negocio: string;
  /** Los datos que puede dar si se los preguntan. Clave legible → valor literal. */
  readonly datos: Readonly<Record<string, string>>;
  /** Preferencias que puede expresar («nada de morado»), no datos. */
  readonly gustos?: readonly string[];
}

/** Lo que el dueño pide, en orden. `vuelve` es lo mismo que `pide`, pero
 *  marca en el informe el encargo que llega «dos semanas después». */
export interface PasoDelGuion {
  readonly tipo: "pide" | "vuelve";
  /** El mensaje literal con el que abre el paso, como lo escribiría el dueño. */
  readonly mensaje: string;
}

export interface Intercambio {
  readonly quien: "dueno" | "len";
  readonly texto: string;
}

export interface ContextoDeCalificacion {
  /** Raíz de la publicada, servida en local por `servirPublicada`. */
  readonly url: string;
  /** La app —el ápice en producción—, a la que la publicada manda sus
   *  formularios desde OTRO origen (`NEXT_PUBLIC_SITE_URL`, ver entorno.ts). */
  readonly next: string;
  readonly sub: string;
  readonly projectId: string;
  readonly ficha: Ficha;
  /** El estado final del proyecto en la base. */
  readonly datos: ProjectData;
  /** La página de partida, para no culpar a Len de lo que ya venía roto. */
  readonly inicio: ProjectData;
  /** `true` si fue LEN quien publicó durante el encargo. */
  readonly publicadaPorLen: boolean;
  readonly conversacion: readonly Intercambio[];
  readonly navegador: Browser;
  /** Los envíos de formulario que llegaron a la base para este proyecto. */
  readonly leerEnvios: () => Promise<readonly Record<string, string>[]>;
}

export interface Grader {
  readonly nombre: string;
  readonly peso: number;
  /** Ausente = vota. `false` = corre, se reporta y NO entra en el score. */
  readonly puntua?: false;
  calificar(ctx: ContextoDeCalificacion): Promise<{ paso: boolean; explicacion: string }>;
}

export interface ResultadoDeGrader {
  readonly nombre: string;
  readonly paso: boolean;
  readonly peso: number;
  readonly explicacion: string;
  readonly puntua: boolean;
}

export interface Encargo {
  readonly id: string;
  readonly nivel: Nivel;
  /** Una línea, para el informe. */
  readonly resumen: string;
  readonly inicio: ProjectData;
  readonly ficha: Ficha;
  readonly guion: readonly PasoDelGuion[];
  readonly graders: readonly Grader[];
  /** El caso resuelto a mano. Todos los graders que votan pasan con él. */
  readonly solucion: ProjectData;
  /** Variantes rotas plantadas. Entre `inicio` y éstas, cada grader que vota
   *  tiene que suspender al menos una vez. */
  readonly rotas: readonly { readonly nombre: string; readonly datos: ProjectData }[];
  /** El dueño pide publicar («…y publícalo»): la solución cuenta como publicada
   *  por Len al validar (ver `publicadaAlValidar`). */
  readonly publicaLen?: boolean;
}

/**
 * CÓMO TERMINÓ UNA CORRIDA. `completa` y `error_de_len` son de Len. `proveedor`
 * (no contestó) y `cliente_fuera_de_ficha` (el cliente simulado dijo algo que
 * no estaba en su ficha) son del ARNÉS: cuentan como 0 y dejan la suite en
 * error, como en el corredor de evals de Claude Code (ver `DEL_ARNES` en puntuar.ts).
 * `tope_de_gasto` es una corrida que no se llegó a correr.
 */
export type Desenlace =
  | "completa"
  | "error_de_len"
  | "proveedor"
  | "cliente_fuera_de_ficha"
  | "tope_de_gasto";

export interface ResultadoDeCorrida {
  readonly graders: readonly ResultadoDeGrader[];
  readonly score: number;
  readonly desenlace: Desenlace;
  /** Texto del error que cortó la corrida, si lo hubo. Manda en las NOTAS. */
  readonly error?: string;
  readonly turnosDeLen: number;
  /** Lo que se le cobró al dueño, en créditos. */
  readonly creditos: number;
  /** Lo que costó de verdad: el papel `agent` (grabaciones) + el cliente simulado. */
  readonly usd: number;
  readonly segundos: number;
  readonly sub: string;
  /** Lo que se dijeron el dueño simulado y Len. Es lo que se lee para saber
   *  POR QUÉ falló un caso (fase 2): sin ella, `resultados.json` sólo dice que
   *  falló. Ausente en las corridas que no llegaron a hablar (tope de gasto). */
  readonly conversacion?: readonly Intercambio[];
}

export interface ResultadoDeCaso {
  readonly id: string;
  readonly nivel: Nivel;
  readonly corridas: readonly ResultadoDeCorrida[];
  readonly score: number;
  readonly passRate: number;
  readonly notas: string;
}
