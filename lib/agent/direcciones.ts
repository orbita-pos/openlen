// lib/agent/direcciones.ts — corregirle el rumbo al Agente SIN pararlo.
//
// POR QUÉ. Un turno del Agente arranca y corre hasta el final. Si va mal en la
// vuelta 3 de 9, el dueño mira cómo quema las otras seis y las paga. En una
// terminal eso no pasa: escribes a media faena y el agente lo lee antes de su
// siguiente paso. Es lo que hace Claude Code — «escribe una corrección y pulsa
// Enter para mandarla sin parar la herramienta en curso: se lee en cuanto
// termina la acción actual y se ajusta antes de decidir el siguiente paso».
//
// No ahorra tokens en el turno bueno. Los ahorra TODOS en el turno malo, que es
// donde se va el dinero y la paciencia.
//
// POR QUÉ UN MAPA EN PROCESO Y NO LA BASE. El SSE es de una sola dirección
// (servidor→cliente), así que la corrección entra por otra petición y tiene que
// encontrarse con un bucle que ya está corriendo. Con UN solo proceso de Node
// —que es el despliegue: un systemd en la caja— un `Map` basta y no añade
// infraestructura. ⚠️ EL DÍA QUE HAYA DOS INSTANCIAS ESTO SE ROMPE EN SILENCIO:
// la corrección llega a un proceso y el turno vive en el otro. Ése es el
// disparador para moverlo a la base, y no antes ([[no-redis-or-queue-until-trigger]]).

import type { QuestionAnswer } from "@/lib/agent/ask-user-question";

/** Cuánto texto se acepta. Una corrección es una frase, no un documento. */
export const MAX_DIRECCION = 2000;

/** Turnos que se guardan a la vez. Un turno que muera sin cerrar deja su fila;
 *  el tope y la caducidad impiden que eso crezca sin fin. */
const MAX_ABIERTOS = 200;
/** Cuándo una fila se da por basura. NO es la duración de un turno: desde
 *  2.1 el turno sigue aunque el cliente se vaya, y lo acotan el techo de
 *  dinero y el reloj de silencio, no el reloj de pared. Medido el 28/09: un
 *  turno de producción duró 25 minutos, y con los 10 de antes se habría
 *  quedado sin poder dirigirse ni cancelarse a la mitad. `cerrarTurno` corre
 *  SIEMPRE en el `finally`, así que esto sólo barre lo que deje un fallo raro. */
const CADUCA_MS = 2 * 60 * 60 * 1000;

interface TurnoAbierto {
  readonly userId: string;
  readonly abiertoEn: number;
  /** En cola: si el usuario escribe dos veces antes de la siguiente vuelta, se
   *  leen las dos, en orden. Perder la primera sería peor que juntarlas. */
  readonly pendientes: string[];
  /** Para el cancelar EXPLÍCITO (`cancelar`). Desde 2.1 cerrar la conexión ya
   *  no corta el turno, así que ésta es la única forma de pararlo. */
  readonly abortar?: () => void;
  /** La fila de la conversación que escribe este turno (el id que eligió el
   *  cliente). Con ella se sabe si una fila `en_curso` sigue viva. */
  readonly filaId?: string;
  /** Pieza 3 de Len 2.5: la pregunta de `ask_user_question` que ESPERA
   *  respuesta ahora mismo (como mucho una: la herramienta es exclusiva), y si
   *  la última ya se contestó — para que un doble clic no la resuelva dos veces. */
  readonly pregunta: { resolver?: (r: QuestionAnswer[] | null) => void; respondida: boolean };
}

// 🔴 EN `globalThis`, NO en un `const` del módulo. MEDIDO el 2026-09-03 con el
// dev levantado: el POST a /api/agent/dirigir devolvía 404 en 45-70 ms —rápido,
// o sea con la ruta ya compilada— mientras un turno corría de verdad.
//
// La causa: en desarrollo, Next compila cada ruta por separado y recompila al
// vuelo, así que este módulo se instancia MÁS DE UNA VEZ. `/api/agent` escribía
// en un Map y `/api/agent/dirigir` leía otro. Dos almacenes, cero correcciones.
//
// En producción (standalone, un solo registro de módulos) un `const` habría
// funcionado — que es lo que lo hace peligroso: pasa la prueba en la caja y
// falla en la máquina de quien desarrolla, o al revés el día que cambie el
// empaquetado. Colgarlo de `globalThis` lo hace cierto en los dos sitios.
const CLAVE = Symbol.for("openlen.agente.direcciones");
type Global = typeof globalThis & { [CLAVE]?: Map<string, TurnoAbierto> };
const abiertos: Map<string, TurnoAbierto> =
  (globalThis as Global)[CLAVE] ?? ((globalThis as Global)[CLAVE] = new Map());

function barrer(ahora: number): void {
  for (const [id, t] of abiertos) {
    if (ahora - t.abiertoEn > CADUCA_MS) abiertos.delete(id);
  }
  // Si aun así sobra, cae el más viejo. Nunca se deja crecer sin techo.
  while (abiertos.size > MAX_ABIERTOS) {
    const primero = abiertos.keys().next();
    if (primero.done) break;
    abiertos.delete(primero.value);
  }
}

/** El turno empieza y queda disponible para recibir correcciones y para que
 *  lo cancelen (`abortar`). */
export function abrirTurno(
  turnoId: string,
  userId: string,
  ahora = Date.now(),
  extra: { readonly abortar?: () => void; readonly filaId?: string } = {},
): void {
  barrer(ahora);
  abiertos.set(turnoId, {
    userId,
    abiertoEn: ahora,
    pendientes: [],
    pregunta: { respondida: false },
    ...(extra.abortar ? { abortar: extra.abortar } : {}),
    ...(extra.filaId ? { filaId: extra.filaId } : {}),
  });
}

export type ResultadoDirigir = "ok" | "no_existe" | "ajeno" | "vacio";

/**
 * Deja una corrección para un turno en marcha.
 *
 * 🔴 EL `userId` NO ES DECORATIVO. El id del turno viaja al cliente por el SSE,
 * y sin comprobar el dueño cualquiera que adivine uno podría inyectar texto en
 * la conversación de otro — que en este producto significa escribir en su
 * página. Se comprueba aquí, en el almacén, y no sólo en la ruta: es el único
 * sitio por el que pasan TODOS los caminos.
 */
export function dirigir(
  turnoId: string,
  userId: string,
  texto: string,
): ResultadoDirigir {
  const limpio = texto.trim().slice(0, MAX_DIRECCION);
  if (!limpio) return "vacio";
  const turno = abiertos.get(turnoId);
  if (!turno) return "no_existe";
  if (turno.userId !== userId) return "ajeno";
  turno.pendientes.push(limpio);
  return "ok";
}

/**
 * Lo que haya pendiente, y se CONSUME.
 *
 * Consumir es lo correcto: si se quedara, el bucle lo reinyectaría en cada
 * vuelta y el modelo leería la misma corrección cinco veces, cada una como si
 * fuera nueva.
 */
export function leerDireccion(turnoId: string): string | null {
  const turno = abiertos.get(turnoId);
  if (!turno || turno.pendientes.length === 0) return null;
  const juntas = turno.pendientes.join("\n");
  turno.pendientes.length = 0;
  return juntas;
}

/** Lo que acepta una respuesta: lo que el dueño escribe en «otra» es DATO para
 *  el modelo, nunca una orden, y se acota como una corrección. */
export const MAX_RESPUESTA_LIBRE = MAX_DIRECCION;
const MAX_RESPUESTAS = 20;
const MAX_ELEGIDAS = 10;
const MAX_ETIQUETA = 120;

/**
 * PIEZA 3 DE LEN 2.5 · ESPERAR LA RESPUESTA DENTRO DEL TURNO, como
 * `ask_user_question` de DeepSeek (`ctx.userQuestions.ask`): la herramienta se
 * queda esperando aquí y la respuesta entra por otra petición
 * (`POST /api/agent/responder` → `responder`), igual que una corrección.
 *
 * Resuelve con las respuestas, o con `null` si vence `timeoutMs` (el límite de
 * espera: Len corre en un servidor, no en una terminal abierta), con el ■ o si
 * el turno se cierra. `null` NUNCA es una aprobación: la herramienta cierra el
 * turno con la pregunta y la respuesta abre el siguiente.
 */
export function esperarRespuesta(
  turnoId: string,
  o: { readonly timeoutMs: number; readonly signal?: AbortSignal },
): Promise<QuestionAnswer[] | null> {
  const turno = abiertos.get(turnoId);
  if (!turno || o.signal?.aborted) return Promise.resolve(null);
  return new Promise((resolve) => {
    let reloj: ReturnType<typeof setTimeout> | undefined;
    const alAbortar = () => terminar(null);
    function terminar(r: QuestionAnswer[] | null): void {
      if (turno!.pregunta.resolver !== terminar) return;
      turno!.pregunta.resolver = undefined;
      if (reloj) clearTimeout(reloj);
      o.signal?.removeEventListener("abort", alAbortar);
      resolve(r);
    }
    turno.pregunta.respondida = false;
    turno.pregunta.resolver = terminar;
    reloj = setTimeout(() => terminar(null), o.timeoutMs);
    (reloj as { unref?: () => void }).unref?.();
    o.signal?.addEventListener("abort", alAbortar, { once: true });
  });
}

export type ResultadoResponder = "ok" | "no_existe" | "ajeno" | "sin_pregunta" | "ya_respondida" | "invalida";

/** La forma de DeepSeek (`{ id, selected, custom? }`), validada y acotada. */
function respuestasValidas(raw: unknown): QuestionAnswer[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_RESPUESTAS) return null;
  const out: QuestionAnswer[] = [];
  for (const a of raw) {
    if (!a || typeof a !== "object") return null;
    const { id, selected, custom } = a as { id?: unknown; selected?: unknown; custom?: unknown };
    if (typeof id !== "string" || !id.trim()) return null;
    if (!Array.isArray(selected) || !selected.every((x) => typeof x === "string")) return null;
    if (custom !== undefined && typeof custom !== "string") return null;
    const libre = typeof custom === "string" ? custom.trim().slice(0, MAX_RESPUESTA_LIBRE) : "";
    out.push({
      id: id.trim(),
      selected: (selected as string[]).slice(0, MAX_ELEGIDAS).map((x) => x.trim().slice(0, MAX_ETIQUETA)).filter(Boolean),
      ...(libre ? { custom: libre } : {}),
    });
  }
  return out;
}

/**
 * La respuesta del dueño a la pregunta que espera. Mismo control de dueño que
 * `dirigir` y por lo mismo. Se resuelve UNA vez: la segunda respuesta (doble
 * clic, dos pestañas) es `ya_respondida` y no toca nada.
 */
export function responder(turnoId: string, userId: string, raw: unknown): ResultadoResponder {
  const turno = abiertos.get(turnoId);
  if (!turno) return "no_existe";
  if (turno.userId !== userId) return "ajeno";
  const resolver = turno.pregunta.resolver;
  if (!resolver) return turno.pregunta.respondida ? "ya_respondida" : "sin_pregunta";
  const respuestas = respuestasValidas(raw);
  if (!respuestas) return "invalida";
  turno.pregunta.respondida = true;
  resolver(respuestas);
  return "ok";
}

export type ResultadoCancelar = "ok" | "no_existe" | "ajeno";

/**
 * PARAR EL TURNO A PROPÓSITO (■, o el plazo de Len-Bench).
 *
 * Hasta 2.1 cancelar era cerrar la conexión: el `cancel()` del stream abortaba
 * el modelo. Eso también mataba el turno cuando se cerraba la pestaña, se caía
 * la red o se dormía el móvil (diagnóstico de 2.1, §3.1). Ahora la conexión es
 * sólo la vista, y parar es una petición aparte, como `dirigir`.
 *
 * Mismo control de dueño que `dirigir`, y por lo mismo: el id viaja al cliente
 * por el SSE. Parar no borra la fila: el `finally` del turno la cierra.
 */
export function cancelar(turnoId: string, userId: string): ResultadoCancelar {
  const turno = abiertos.get(turnoId);
  if (!turno) return "no_existe";
  if (turno.userId !== userId) return "ajeno";
  turno.abortar?.();
  return "ok";
}

/**
 * ¿QUÉ TURNO VIVO ESCRIBE ESTA FILA? Su id, o `null` si ninguno en ESTE
 * proceso.
 *
 * Es cómo se distingue una fila `en_curso` que sigue trabajando de una que se
 * quedó huérfana: el servidor se reinició a mitad (un deploy) y su `finally`
 * no llegó a cerrarla. Con UN proceso —el despliegue de hoy— el mapa es la
 * verdad. ⚠️ Con dos instancias dejaría de serlo, igual que `dirigir`.
 *
 * Mismo control de dueño que todo lo demás: la fila de otro no existe.
 */
export function turnoDeLaFila(filaId: string, userId: string): string | null {
  for (const [id, t] of abiertos) {
    if (t.filaId === filaId && t.userId === userId) return id;
  }
  return null;
}

/** El turno terminó. Se llama SIEMPRE, también cuando revienta. */
export function cerrarTurno(turnoId: string): void {
  // Una pregunta que seguía esperando se suelta: su herramienta cierra el turno
  // como cuando nadie contesta.
  abiertos.get(turnoId)?.pregunta.resolver?.(null);
  abiertos.delete(turnoId);
}

// PIEZA 8 DE LEN 2.5 · LA RONDA QUE SIGUE A UNA FILA. Al cerrar una ronda del
// encargo, la ruta abre la siguiente; quien sigue la conversación releyendo la
// fila (el chat, `GET /api/agent/turno/[fila]`) necesita saber a cuál pasar. Es
// del proceso, como lo demás de aquí: tras un reinicio no hay cadena que seguir.
const CLAVE_RONDAS = Symbol.for("openlen.agente.rondas");
type GlobalRondas = typeof globalThis & { [CLAVE_RONDAS]?: Map<string, string> };
const siguientes: Map<string, string> =
  (globalThis as GlobalRondas)[CLAVE_RONDAS] ?? ((globalThis as GlobalRondas)[CLAVE_RONDAS] = new Map());

export function rondaSiguiente(filaId: string, siguiente: string): void {
  siguientes.set(filaId, siguiente);
  while (siguientes.size > MAX_ABIERTOS) {
    const primero = siguientes.keys().next();
    if (primero.done) break;
    siguientes.delete(primero.value);
  }
}

/** La fila de la ronda que siguió a ésta, si la hubo. */
export function siguienteDeLaFila(filaId: string): string | null {
  return siguientes.get(filaId) ?? null;
}

/** Sólo para las pruebas: deja el almacén como recién arrancado. */
export function _vaciarTodo(): void {
  abiertos.clear();
  siguientes.clear();
}
