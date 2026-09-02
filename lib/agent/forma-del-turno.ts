// LA FORMA DE UN TURNO — qué vio el modelo, sin guardar lo que vio.
//
// POR QUÉ EXISTE. Auditado el 2026-09-01: de un turno del Agente quedan DOS
// líneas de consola, y las dos son de dinero — el recuento de tokens y el cargo.
// Ni lo que se envió, ni qué bloques llevaba el contexto, ni si el documento
// iba entero o recortado. Cuando un turno sale raro, la pregunta que hay que
// responder es «¿qué vio el modelo?», y hoy no hay con qué.
//
// LA PROPUESTA ORIGINAL ERA VOLCAR `built.messages` A DISCO, y esa parte se
// queda fuera a propósito: son el HTML de la página y el mensaje del usuario,
// y escribirlos en cada turno de cada proyecto es un coste de privacidad que no
// paga lo que da. Para cuando de verdad hace falta el contenido está el
// GRABADOR (`grabacion.ts`), que es opt-in y deja el fixture entero.
//
// Esto es lo otro: la FORMA. Tamaños, qué bloques había, si el documento viajó
// completo, recortado o como índice, y el hash del documento. Nada de eso es
// contenido del usuario — un hash no se lee hacia atrás, y un número de
// caracteres tampoco.
//
// Y ES LO QUE JUSTIFICA QUE VAYA SIEMPRE ENCENDIDO, que es la diferencia que de
// verdad importa: el grabador hay que encenderlo ANTES de que pase lo que
// quieres ver, y los turnos que salen mal no avisan. La forma cuesta una línea
// de log y está ahí cuando la necesitas.
//
// Módulo PURO: sin `fs`, sin `db`, sin bindings nativos. Su prueba corre bajo
// vitest sin mockear nada.

import { createHash } from "node:crypto";

/** Cómo viajó el documento en este turno. Las tres son caminos distintos del
 *  contexto y explican por sí solas la mitad de los «¿por qué hizo eso?»: con
 *  `indice` el modelo NO vio el HTML de ninguna sección que no abriera. */
export type VistaDelDocumento = "completa" | "recortada" | "indice";

export interface EntradaDeForma {
  readonly projectId: string;
  readonly systemPrompt: string;
  readonly contextBlock: string;
  /** El documento ya etiquetado — el que se le manda al modelo. */
  readonly taggedHtml: string;
  readonly vista: VistaDelDocumento;
  readonly history: readonly { readonly content: string }[];
  /** Cuántos turnos tiene la conversación entera, si se sabe. */
  readonly turnosTotales?: number;
  readonly prompt: string;
  readonly userBrief?: string | null;
  readonly userMemory?: string | null;
  readonly cambios?: readonly unknown[];
  readonly degradaciones?: readonly unknown[];
  readonly turnoAnteriorMudo?: boolean;
  readonly conPin?: boolean;
  readonly conImagen?: boolean;
  readonly activePage?: string | null;
}

export interface FormaDelTurno {
  readonly projectId: string;
  readonly vista: VistaDelDocumento;
  readonly docChars: number;
  /** 16 hex de un sha256 del documento. NO es criptografía y NO es el
   *  documento: es una etiqueta corta que permite decir «el mismo de antes» o
   *  «otro» entre dos turnos sin arrastrar 100 KB a ninguna parte. El mismo
   *  formato que usa `hashDocumento` en page-engine/persist. */
  readonly docHash: string;
  readonly sysChars: number;
  readonly ctxChars: number;
  readonly histChars: number;
  readonly promptChars: number;
  /** Estimación, con la misma regla que la guarda de tamaño de la ruta. */
  readonly tokensAprox: number;
  readonly histVisibles: number;
  readonly histTotales: number;
  readonly conMemoria: boolean;
  readonly conBrief: boolean;
  readonly cambios: number;
  readonly degradaciones: number;
  readonly mudo: boolean;
  readonly conPin: boolean;
  readonly conImagen: boolean;
  readonly pagina: string;
}

/** ~3,5 caracteres por token sobre HTML denso en etiquetas + JSON. Es la misma
 *  constante que `estimateContextTokens` usa en la guarda previa al envío; se
 *  repite aquí para que este módulo no arrastre `context.ts` (y con él el
 *  catálogo entero) sólo por una división. */
const CHARS_POR_TOKEN = 3.5;

export function formaDelTurno(e: EntradaDeForma): FormaDelTurno {
  const histChars = e.history.reduce((n, h) => n + h.content.length, 0);
  const total = e.systemPrompt.length + e.contextBlock.length + histChars + e.prompt.length;
  return {
    projectId: e.projectId,
    vista: e.vista,
    docChars: e.taggedHtml.length,
    docHash: createHash("sha256").update(e.taggedHtml).digest("hex").slice(0, 16),
    sysChars: e.systemPrompt.length,
    ctxChars: e.contextBlock.length,
    histChars,
    promptChars: e.prompt.length,
    tokensAprox: Math.ceil(total / CHARS_POR_TOKEN),
    histVisibles: e.history.length,
    // Sin dato, «totales» es lo visible: decir 0 sería afirmar que la
    // conversación está vacía cuando lo que pasa es que no se midió.
    histTotales: e.turnosTotales ?? e.history.length,
    conMemoria: Boolean(e.userMemory?.trim()),
    conBrief: Boolean(e.userBrief?.trim()),
    cambios: e.cambios?.length ?? 0,
    degradaciones: e.degradaciones?.length ?? 0,
    mudo: e.turnoAnteriorMudo === true,
    conPin: e.conPin === true,
    conImagen: e.conImagen === true,
    pagina: e.activePage ?? "principal",
  };
}

/** Un booleano se escribe 1/0 y no true/false: la línea tiene catorce campos y
 *  la diferencia entre leerla de un vistazo y no leerla es esa. */
const b = (v: boolean) => (v ? "1" : "0");

/**
 * UNA línea, en pares `clave=valor` para poder pasarle `grep` y `awk`.
 *
 * Va en una sola línea a propósito: un turno que produce cinco líneas de
 * diagnóstico se convierte en ruido que se acaba filtrando, y entonces no está
 * cuando hace falta.
 */
export function lineaDeForma(f: FormaDelTurno): string {
  return [
    "[agent] forma",
    `proj=${f.projectId}`,
    `pagina=${f.pagina}`,
    `vista=${f.vista}`,
    `doc=${f.docChars}`,
    `dochash=${f.docHash}`,
    `sys=${f.sysChars}`,
    `ctx=${f.ctxChars}`,
    `hist=${f.histVisibles}/${f.histTotales}`,
    `histchars=${f.histChars}`,
    `prompt=${f.promptChars}`,
    `tok~=${f.tokensAprox}`,
    `mem=${b(f.conMemoria)}`,
    `brief=${b(f.conBrief)}`,
    `cambios=${f.cambios}`,
    `degr=${f.degradaciones}`,
    `mudo=${b(f.mudo)}`,
    `pin=${b(f.conPin)}`,
    `img=${b(f.conImagen)}`,
  ].join(" ");
}
