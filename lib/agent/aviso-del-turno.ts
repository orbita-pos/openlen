// lib/agent/aviso-del-turno.ts — el aviso de que Len terminó sin nadie mirando.
//
// LEN 2.1 (diagnóstico §4.4 punto 5). El turno ya no muere con el cliente: si
// la persona cerró la pestaña o el móvil se durmió, Len termina igual, y hay
// que decírselo. Es la otra mitad de «cierra, Len sigue, te aviso», que es el
// diseño entero de la app móvil.
//
// Puro: compone el evento; quien lo agenda es la ruta. Sin prosa nuestra —el
// servidor no sabe el idioma de quien lo lee—: el cuerpo es lo último que dijo
// Len, que ya habla el idioma del usuario.

import type { LenTurnoEvent } from "@/lib/notifications/types";

/** Lo que cabe en una notificación sin que el sistema lo corte a su manera. */
export const MAX_AVISO = 140;

/** Lo último que dijo Len: el último párrafo con texto, recortado. Los turnos
 *  largos hablan en varias vueltas y el cierre es lo que resume el trabajo. */
export function ultimoParrafo(texto: string): string {
  const parrafos = texto
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const ultimo = parrafos.at(-1) ?? "";
  return ultimo.length > MAX_AVISO ? `${ultimo.slice(0, MAX_AVISO - 1).trimEnd()}…` : ultimo;
}

export function avisoDelTurno(o: {
  readonly projectId: string;
  readonly userId: string;
  readonly texto: string;
  readonly tarjetas: readonly { readonly tool: string }[];
}): LenTurnoEvent {
  return {
    type: "len_turno",
    projectId: o.projectId,
    recipientUserId: o.userId,
    preview: ultimoParrafo(o.texto),
    // `preguntar` cierra el turno esperando al usuario: sin su respuesta, Len
    // no sigue. Es el aviso que más importa no perderse.
    pregunta: o.tarjetas.some((t) => t.tool === "preguntar"),
  };
}
