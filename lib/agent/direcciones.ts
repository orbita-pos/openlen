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

/** Cuánto texto se acepta. Una corrección es una frase, no un documento. */
export const MAX_DIRECCION = 2000;

/** Turnos que se guardan a la vez. Un turno que muera sin cerrar deja su fila;
 *  el tope y la caducidad impiden que eso crezca sin fin. */
const MAX_ABIERTOS = 200;
/** Un turno no dura más que el tope del stream. Pasado eso, su fila es basura. */
const CADUCA_MS = 10 * 60 * 1000;

interface TurnoAbierto {
  readonly userId: string;
  readonly abiertoEn: number;
  /** En cola: si el usuario escribe dos veces antes de la siguiente vuelta, se
   *  leen las dos, en orden. Perder la primera sería peor que juntarlas. */
  readonly pendientes: string[];
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

/** El turno empieza y queda disponible para recibir correcciones. */
export function abrirTurno(turnoId: string, userId: string, ahora = Date.now()): void {
  barrer(ahora);
  abiertos.set(turnoId, { userId, abiertoEn: ahora, pendientes: [] });
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

/** El turno terminó. Se llama SIEMPRE, también cuando revienta. */
export function cerrarTurno(turnoId: string): void {
  abiertos.delete(turnoId);
}

/** Sólo para las pruebas: deja el almacén como recién arrancado. */
export function _vaciarTodo(): void {
  abiertos.clear();
}
