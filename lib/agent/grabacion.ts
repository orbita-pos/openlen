// EL GRABADOR DE TURNOS — la mitad que faltaba del replay.
//
// POR QUÉ EXISTE. Auditado el 2026-09-01: se puede reproducir un turno del
// Agente entero, determinista y sin llamar al modelo, porque `loop.test.ts`
// tiene `scripted(...)`, que alimenta `openStream` con eventos y ejecuta el
// `runAgentLoop` REAL. O sea que el REPRODUCTOR ya estaba. Lo que no existía
// era nada que capturase un turno de VERDAD: los eventos de `scripted` se
// escriben a mano, así que las pruebas comprueban el bucle contra lo que
// imaginamos que dice el modelo, nunca contra lo que dijo.
//
// Eso importa cuando el turno sale mal. Hoy, de un turno roto en producción
// quedan DOS LÍNEAS de consola con el recuento de tokens (ver la zona 1 de la
// auditoría): ni lo que se envió, ni lo que contestó, ni qué guardas saltaron.
// Reproducirlo significa adivinar el guion. Con una grabación, el turno que
// falló se convierte en un caso de prueba que corre en `npm test`, gratis y
// para siempre.
//
// ESTE MÓDULO ES PURO: ni `fs`, ni `db`, ni bindings nativos. Graba en memoria y
// devuelve un objeto; quien lo llame decide dónde escribirlo. Así su prueba
// corre bajo vitest sin mockear nada, que es la misma razón por la que
// `context.ts` se mantiene libre de importaciones nativas.
//
// LAS DOS MITADES VIVEN JUNTAS a propósito. El formato tiene UN dueño: si el
// grabador y el reproductor estuvieran en ficheros distintos, el día que uno
// cambie el otro sigue leyendo lo de ayer y el fallo aparece como un replay que
// «no reproduce», que es de los más caros de diagnosticar.

import type { Message, StreamEvent } from "@/lib/ai-gateway";

// CÓMO SE USA, en tres pasos:
//
//   1. GRABAR. Levanta el servidor con el directorio puesto y usa el Chat:
//
//        OPENLEN_AGENT_RECORD_DIR=.claude/qa/turnos npm run dev
//
//      Cada turno deja un JSON ahí (`.claude/` está gitignored, que es donde
//      tiene que quedarse: el fixture lleva dentro la página y el mensaje del
//      usuario, y este repo es público). Se graba también el turno que
//      REVIENTA — el volcado vive en el `finally` de la ruta, porque ése es
//      justo el que hay que poder volver a correr.
//
//   2. REPRODUCIR, en una prueba, sin llamar a nadie y sin gastar un céntimo:
//
//        const grabado = JSON.parse(readFileSync(ruta, "utf8"));
//        const r = await runAgentLoop({
//          messages: grabado.messages,
//          tools: buildFunctionDeclarations(),
//          openStream: reproducir(grabado),
//          closeOut: reproducirCierre(grabado),
//          runTool: …, emit: …,
//        });
//
//   3. AFIRMAR sobre `r` y sobre los eventos emitidos. A partir de aquí el
//      turno que falló en producción es un caso que corre en `npm test`.


/** Sube cuando el formato deje de poder leerse hacia atrás. `reproducir`
 *  RECHAZA lo que no entiende en vez de interpretarlo a medias: una grabación
 *  medio leída produce un replay que diverge por un motivo que no es el bug que
 *  se estaba buscando. */
export const FORMATO_GRABACION = 1;

export interface MetaGrabacion {
  /** Qué modelo llevó el turno; lo reporta el cerebro, no una constante. */
  readonly modelId?: string;
  /** El `requestId` del turno, para cruzarlo con la línea de log. */
  readonly requestId?: string;
  /** Escrita a mano al guardar un caso interesante. */
  readonly nota?: string;
}

export interface TurnoGrabado {
  readonly formato: number;
  readonly grabadoEn: string;
  readonly meta: MetaGrabacion;
  /** Los mensajes con los que ARRANCÓ el turno — lo que recibe
   *  `runAgentLoop({ messages })`. El bucle va añadiendo los suyos; grabar
   *  también ésos duplicaría el documento, que es el ítem más caro. */
  readonly messages: Message[];
  /** Un array POR LLAMADA a `openStream`, en orden. Es exactamente la forma que
   *  come `scripted(...)` en `loop.test.ts`, y no es casualidad: el reproductor
   *  ya existía y el formato se pliega a él en vez de inventar otro. */
  readonly turnos: StreamEvent[][];
  /** El stream de cierre (`closeOut`), que sólo corre cuando se agota un tope.
   *  Va aparte porque es otra llamada con otras reglas — y grabarlo mezclado
   *  con los `turnos` haría que el replay se lo comiera como una vuelta más. */
  readonly cierre?: StreamEvent[];
}

export interface Grabadora {
  /** Envuelve un stream del modelo: deja pasar cada evento tal cual y se queda
   *  una copia. No cambia el orden, ni el tiempo, ni el contenido. */
  envuelve(source: AsyncIterable<StreamEvent>): AsyncIterable<StreamEvent>;
  /** Lo mismo para `closeOut`. */
  envuelveCierre(source: AsyncIterable<StreamEvent>): AsyncIterable<StreamEvent>;
  /** La grabación, lista para serializar. */
  resultado(meta?: MetaGrabacion): TurnoGrabado;
  /** ¿Llegó a grabarse algo? Un turno que reventó antes del primer evento no
   *  deja fixture: un fichero con cero eventos no reproduce nada y sólo
   *  ensucia el directorio. */
  readonly vacia: boolean;
}

export function creaGrabadora(messages: Message[], ahora: () => Date = () => new Date()): Grabadora {
  // Copia defensiva: el bucle MUTA el array de mensajes que recibe (les añade
  // las respuestas de herramientas y les poda los documentos viejos). Sin esto
  // la grabación no guardaría el arranque del turno sino su estado final, que
  // es justo lo que no sirve para volver a empezarlo.
  const inicio = structuredClone(messages) as Message[];
  const turnos: StreamEvent[][] = [];
  let cierre: StreamEvent[] | undefined;

  async function* tee(
    source: AsyncIterable<StreamEvent>,
    sumidero: StreamEvent[],
  ): AsyncIterable<StreamEvent> {
    for await (const ev of source) {
      sumidero.push(ev);
      yield ev;
    }
  }

  return {
    envuelve(source) {
      const buffer: StreamEvent[] = [];
      turnos.push(buffer);
      return tee(source, buffer);
    },
    envuelveCierre(source) {
      cierre = [];
      return tee(source, cierre);
    },
    get vacia() {
      return turnos.every((t) => t.length === 0) && !cierre?.length;
    },
    resultado(meta = {}) {
      return {
        formato: FORMATO_GRABACION,
        grabadoEn: ahora().toISOString(),
        meta,
        messages: inicio,
        turnos,
        ...(cierre ? { cierre } : {}),
      };
    },
  };
}

/**
 * De grabación a `openStream`. Lo que devuelve se le pasa tal cual a
 * `runAgentLoop`, junto con `grabado.messages`.
 *
 * 🔴 SE QUEJA AL PASARSE, y ahí se aparta de `scripted(...)`, que repite el
 * último turno indefinidamente. Esa comodidad está bien para un guion escrito a
 * mano; sobre una GRABACIÓN significa que el bucle pidió más vueltas de las que
 * el modelo dio, o sea que el replay YA divergió de lo que pasó. Repetir el
 * último evento lo taparía y el fallo aparecería más adelante, disfrazado.
 */
export function reproducir(grabado: TurnoGrabado): (messages: Message[]) => AsyncIterable<StreamEvent> {
  if (grabado.formato !== FORMATO_GRABACION) {
    throw new Error(
      `grabación en formato ${grabado.formato}; este código lee el ${FORMATO_GRABACION}`,
    );
  }
  let i = 0;
  return () => {
    const turno = grabado.turnos[i];
    if (!turno) {
      throw new Error(
        `el replay pidió la vuelta ${i + 1} y la grabación sólo tiene ${grabado.turnos.length}: el bucle divergió de lo grabado`,
      );
    }
    i += 1;
    return (async function* () {
      for (const ev of turno) yield ev;
    })();
  };
}

/** El `closeOut` grabado, o `undefined` si aquel turno no agotó ningún tope. */
export function reproducirCierre(
  grabado: TurnoGrabado,
): ((messages: Message[]) => AsyncIterable<StreamEvent>) | undefined {
  const cierre = grabado.cierre;
  if (!cierre) return undefined;
  return () =>
    (async function* () {
      for (const ev of cierre) yield ev;
    })();
}

/**
 * LA PALANCA, y es OPT-IN de verdad: grabar escribe ficheros con el HTML y el
 * mensaje del usuario dentro, así que no puede encenderse sola. Sin la variable
 * puesta, nada de este módulo llega a construirse y el turno sale byte a byte
 * como antes.
 *
 * Devuelve el DIRECTORIO donde escribir, no un booleano: obliga a decir dónde,
 * y así el que la enciende ya ha pensado que eso deja rastro en el disco.
 */
export function directorioDeGrabacion(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
  const v = env.OPENLEN_AGENT_RECORD_DIR?.trim();
  return v ? v : null;
}

/** Nombre de fichero de una grabación: ordenable por tiempo y único. */
export function nombreDeFichero(grabado: TurnoGrabado): string {
  const sello = grabado.grabadoEn.replace(/[:.]/g, "-");
  const id = grabado.meta.requestId?.replace(/[^a-zA-Z0-9_-]/g, "") || "turno";
  return `${sello}-${id}.json`;
}
