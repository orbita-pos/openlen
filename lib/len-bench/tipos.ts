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
import type { MensajeDelHistorial } from "@/lib/agent/transcripcion";
import type { ProjectData } from "@/lib/projects/types";

export type Nivel = "N1" | "N2" | "N3";

/** Un resultado de buscar en la web, con los campos que da un buscador de verdad. */
export interface ResultadoDeBusqueda {
  readonly titulo: string;
  readonly url: string;
  readonly fragmento: string;
  /** Fecha de la página, `AAAA-MM-DD`. Una fuente vieja se distingue por ella. */
  readonly fecha?: string;
}

/**
 * LA INTERNET DEL CASO (plans/len-agente-2026, F0): lo que encontraría Len si
 * buscara, fijo para que la corrida sea reproducible. Contra un buscador de
 * verdad se mediría la web, que cambia cada día, y no a Len. Ver
 * `web-sustituta.ts`, que es quien la consulta.
 */
export interface WebDelCaso {
  /** En orden: la primera regla que casa con la consulta da sus resultados.
   *  Ninguna = la búsqueda no encuentra nada. */
  readonly busquedas: readonly { readonly si: RegExp; readonly resultados: readonly ResultadoDeBusqueda[] }[];
  /** Las páginas que existen en esta web: URL absoluta → HTML. Cualquier otra no existe. */
  readonly paginas: Readonly<Record<string, string>>;
}

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
  /** El texto de la web del caso (`textoDeLaWeb`): lo que está publicado ahí
   *  fuera también es un dato DADO, no inventado. Vacío si el caso no tiene web. */
  readonly loDeLaWeb: string;
  /** El estado final del proyecto en la base. */
  readonly datos: ProjectData;
  /** La página de partida, para no culpar a Len de lo que ya venía roto. */
  readonly inicio: ProjectData;
  /** `true` si fue LEN quien publicó durante el encargo. */
  readonly publicadaPorLen: boolean;
  readonly conversacion: readonly Intercambio[];
  /** EL ENCARGO COMO LO VIO EL MODELO, de las filas que escribió el servidor:
   *  el pedido del dueño, las llamadas con sus argumentos y lo que devolvió cada
   *  herramienta (`trazaDeLasFilas`, juez.ts). Lo que ve el juez con foco
   *  `traza`. Vacía al validar: no hay turnos. */
  readonly traza: readonly MensajeDelHistorial[];
  /** Nombres de las herramientas que Len llamó (eventos `action`), en orden, sin repetir. */
  readonly herramientas: readonly string[];
  /** Los eventos `confirm` del encargo (publicar, responder…). */
  readonly tarjetas: readonly Record<string, unknown>[];
  /** La zona del dueño en esta corrida. */
  readonly zona: string;
  readonly navegador: Browser;
  /** Los envíos de formulario que llegaron a la base para este proyecto. */
  readonly leerEnvios: () => Promise<readonly Record<string, string>[]>;
}

export interface Grader {
  readonly nombre: string;
  readonly peso: number;
  /** Ausente = vota. `false` = corre, se reporta y NO entra en el score. */
  readonly puntua?: false;
  /** Llama a un modelo y CUESTA (el juez, `juez.ts`): el validador, que corre a
   *  $0, lo salta y lo dice — los `llm` de Claude Code son «paid graders». */
  readonly pago?: true;
  calificar(ctx: ContextoDeCalificacion): Promise<{ paso: boolean; explicacion: string; votos?: readonly boolean[]; evidencia?: string }>;
}

export interface ResultadoDeGrader {
  readonly nombre: string;
  readonly paso: boolean;
  readonly peso: number;
  readonly explicacion: string;
  readonly puntua: boolean;
  /** Los votos del juez, si lo hubo (su `judge_votes`). */
  readonly votos?: readonly boolean[];
  /** Lo que vio el juez, ya recortado (su `evidence`): la traza de una corrida
   *  no se guarda en ningún otro sitio, y el proyecto se borra al acabar. */
  readonly evidencia?: string;
}

/** Lo que un caso de RESULTADOS planta en la base antes del primer turno
 *  (plans/len-resultados/): visitas, formularios, mensajes. En la hora del dueño. */
export interface Siembra {
  readonly projectId: string;
  readonly ownerId: string;
  readonly zona: string;
  readonly ahora: Date;
}

/** Al validar no hay Len: lo que diría y haría en esta variante, para los
 *  graders que califican la CONVERSACIÓN y no la página. */
export interface TurnoDeValidacion {
  readonly len: readonly string[];
  readonly herramientas: readonly string[];
  readonly tarjetas: readonly Record<string, unknown>[];
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
  readonly rotas: readonly {
    readonly nombre: string;
    readonly datos: ProjectData;
    /** Lo que diría y haría Len en esta rota (casos de resultados). */
    readonly turno?: TurnoDeValidacion;
    /** Estado roto plantado DESPUÉS de sembrar (p. ej. un mensaje que «se mandó solo»). */
    readonly despues?: (s: Siembra) => Promise<void>;
  }[];
  /** El dueño pide publicar («…y publícalo»): la solución cuenta como publicada
   *  por Len al validar (ver `publicadaAlValidar`). */
  readonly publicaLen?: boolean;
  /** Casos de resultados: se planta tras crear el proyecto y antes del primer turno. */
  readonly sembrar?: (s: Siembra) => Promise<void>;
  /** La zona del dueño que manda el panel con cada turno. Por omisión, `America/Mexico_City`. */
  readonly zona?: string;
  /** Lo que diría y haría Len en la solución (ver `TurnoDeValidacion`). */
  readonly solucionTurno?: TurnoDeValidacion;
  /** Lo que la SOLUCIÓN deja en la base y no cabe en su HTML —sus filas—,
   *  plantado tras sembrar, como el `despues` de una rota. */
  readonly solucionDespues?: (s: Siembra) => Promise<void>;
  /** Lo que hay en internet para este caso. Sin ella, buscar no encuentra nada. */
  readonly web?: WebDelCaso;
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
  /** Lo que costó de verdad: el papel `agent` (grabaciones) + el cliente simulado
   *  + el juez, si lo hubo. */
  readonly usd: number;
  /** Lo que costó el juez, aparte (su `judge_cost_usd`). Ya va dentro de `usd`. */
  readonly usdJuez?: number;
  readonly segundos: number;
  /** Llamadas al modelo de todo el encargo, el cierre por tope incluido (`pasos.ts`).
   *  Ausente en las corridas de antes del 01/10/2026. */
  readonly pasos?: number;
  /** Los `Edit` que volvieron con `ok:false` («no leído», texto no encontrado…).
   *  Ausente si la corrida no llegó a calificarse: sale de la traza. */
  readonly editFallidos?: number;
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
