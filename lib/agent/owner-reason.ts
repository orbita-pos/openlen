// lib/agent/owner-reason.ts — POR QUÉ FALLÓ UN PASO, dicho para el DUEÑO.
//
// 🔴 N41 (taller, 03/10). La tarjeta roja de un paso pintaba el motivo que la
// herramienta le devolvió AL MODELO —«falló · the user has never said
// "reformas-bernal" — you made that name up…»—: escrito para Len, en segunda
// persona y, desde la traducción de Len 2.5, en inglés. Era la regla del
// 2026-09-18 («un solo canal», como Claude Code: la interfaz pinta el mismo
// string que leyó el modelo), que sólo vale cuando quien mira lee lo mismo que
// el modelo. En OpenLen no: el dueño no es el programador de Len, y habla
// cualquiera de diez idiomas.
//
// LA REGLA (Jesús, 03/10): lo que lee Len NUNCA sale en la tarjeta. Cuando el
// fallo es un hecho que el dueño entiende o puede resolver, la herramienta lo
// declara con un CÓDIGO de esta lista y el chat compone la frase en el idioma
// de quien mira ([[error-del-servidor-como-dato-no-prosa]]). El resto —casi
// todo: Len pidió algo de una forma que no valía, y lo corrige él— sale como
// «No pudo» y nada más. Lo que leyó el modelo sigue entero en el diario del
// turno.
//
// Puro y sin imports: lo leen el servidor (las herramientas, el bucle, el
// esquema del historial) y el cliente (las tarjetas).

export const OWNER_REASON_CODES = [
  /** `publish` sin una dirección que el dueño haya dicho: falta o Len se la
   *  inventó. La dirección la elige el dueño. */
  "address_needed",
  /** La dirección no cumple la forma (minúsculas, números y guiones). */
  "address_invalid",
  /** La dirección está reservada. */
  "address_reserved",
  /** Guardar chocó: la página cambió mientras se guardaba. */
  "page_changed",
  /** Buscar o leer en internet no está disponible en este servidor. */
  "web_unavailable",
  /** La búsqueda en internet falló (el servicio, la red, el plazo). */
  "search_failed",
  /** El tope de búsquedas de un turno. */
  "search_limit",
  /** Esa página de internet no se pudo leer. */
  "web_page_unreadable",
  /** El tope de páginas de internet leídas en un turno. */
  "web_pages_limit",
  /** La imagen a editar no se pudo descargar. */
  "image_unreachable",
  /** El servicio no pudo editar la imagen. */
  "image_edit_failed",
  /** Una edición de imagen por turno. */
  "image_edit_limit",
  /** El sitio ya tiene el máximo de páginas. */
  "site_page_limit",
  /** La memoria de lo que Len recuerda del dueño está llena. */
  "memory_full",
] as const;

export type OwnerReasonCode = (typeof OWNER_REASON_CODES)[number];

/** Código + datos CRUDOS; la frase la compone el cliente. */
export interface OwnerReason {
  readonly code: OwnerReasonCode;
  /** La dirección de la que se habla (`address_*`). */
  readonly address?: string;
  /** El tope del que se habla (`*_limit`). */
  readonly limit?: number;
}

/** Tope de `address` al viajar y guardarse: un subdominio válido tiene 63. */
const TOPE_ADDRESS = 63;

/**
 * Lo que venga de fuera (el evento del stream, una fila guardada) convertido en
 * un `OwnerReason` válido, o `undefined`. Un código que esta lista no conoce se
 * descarta: la tarjeta dirá «No pudo», nunca una clave de traducción cruda.
 */
export function ownerReasonFrom(x: unknown): OwnerReason | undefined {
  if (!x || typeof x !== "object") return undefined;
  const o = x as Record<string, unknown>;
  if (typeof o.code !== "string" || !(OWNER_REASON_CODES as readonly string[]).includes(o.code)) return undefined;
  return {
    code: o.code as OwnerReasonCode,
    ...(typeof o.address === "string" && o.address.trim() ? { address: o.address.trim().slice(0, TOPE_ADDRESS) } : {}),
    ...(typeof o.limit === "number" && Number.isInteger(o.limit) && o.limit >= 0 ? { limit: o.limit } : {}),
  };
}
