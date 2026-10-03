// lib/chat/fusionar-conversacion.ts — juntar la conversación del servidor con la de la vista.
//
// Vivía en línea en el efecto de convergencia de `chat-panel.tsx`. Sale aquí
// con Len 2.1 porque la regla dejó de ser una línea: ahora hay turnos que
// siguen trabajando en el servidor sin stream en esta vista, y el que SÍ lee
// esta vista por su stream no puede pisarse con su fila, que va por detrás.
//
// Puro y sin tipos del panel: quien llama dice cómo restaurar un turno de la
// base y cómo aplicarle el estado del servidor a uno local.

export interface OpcionesDeFusion<L, S> {
  /** El turno que esta vista lee por su stream (su id), o `null`. */
  readonly enVuelo: string | null;
  /** Un turno de la base, como turno de la vista. */
  readonly restaurar: (s: S) => L;
  /** Un turno local con el estado que dice el servidor (otra pestaña pudo
   *  deshacerlo). */
  readonly conEstado: (local: L, s: S) => L;
  /** ¿Es un turno local que el servidor NUNCA va a tener? Un rechazo temprano
   *  —sin créditos, un 4xx— no deja fila en el servidor y el cliente no guarda
   *  los errores. Si ya tiene detrás un turno que el servidor sí tiene, se
   *  queda en su sitio en vez de irse al final (ver abajo). */
  readonly keepsPlace?: (local: L) => boolean;
}

/**
 * La conversación, con el servidor como autoridad de lo asentado:
 *  · el turno EN VUELO en esta vista se queda local (su stream va por delante);
 *  · uno que corre —o corría— en el servidor sin stream aquí (`enCurso` en la
 *    base, `enServidor` en la vista) se toma entero de la fila: no tiene nada
 *    local que guardar, ni preimagen ni Deshacer;
 *  · los demás conservan lo local (la preimagen del Deshacer) con el estado
 *    del servidor;
 *  · lo local que el servidor aún no tiene va detrás, en su orden;
 *  · salvo lo que nunca va a tener (`keepsPlace`) y ya quedó ENTRE turnos que
 *    sí tiene: eso se queda detrás del turno que tenía delante. Si no, un
 *    «sin créditos» saltaba debajo del turno siguiente en cuanto éste se
 *    guardaba, y la barra viva del chat nuevo lo leía como el último turno
 *    (plans/new-chat/, 03/10).
 */
export function fusionarConversacion<
  L extends { readonly id: string; readonly enServidor?: boolean },
  S extends { readonly id: string; readonly enCurso?: boolean },
>(prev: readonly L[], server: readonly S[], o: OpcionesDeFusion<L, S>): L[] {
  const prevById = new Map(prev.map((t) => [t.id, t]));
  const serverIds = new Set(server.map((s) => s.id));
  const merged: L[] = server.map((s) => {
    const local = prevById.get(s.id);
    if (local && s.id === o.enVuelo) return local;
    if (s.enCurso || local?.enServidor) return o.restaurar(s);
    return local ? o.conEstado(local, s) : o.restaurar(s);
  });
  let lastKnown = -1;
  prev.forEach((t, i) => {
    if (serverIds.has(t.id)) lastKnown = i;
  });
  const anchored = new Map<string | null, L[]>();
  const tail: L[] = [];
  let anchor: string | null = null;
  prev.forEach((t, i) => {
    if (serverIds.has(t.id)) {
      anchor = t.id;
      return;
    }
    if (i < lastKnown && o.keepsPlace?.(t)) {
      anchored.set(anchor, [...(anchored.get(anchor) ?? []), t]);
      return;
    }
    tail.push(t);
  });
  const out: L[] = [...(anchored.get(null) ?? [])];
  for (const m of merged) {
    out.push(m, ...(anchored.get(m.id) ?? []));
  }
  return [...out, ...tail];
}
