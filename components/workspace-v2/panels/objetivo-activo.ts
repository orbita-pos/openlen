// ─────────────────────────────────────────────────────────────────────────────
// EL OBJETIVO ACTIVO, DEL LADO DEL DUEÑO.
//
// La condición de parada se ponía por UNA sola vía: Len la propone y el dueño
// aprueba la tarjeta. El servidor, en cambio, sabía cancelarla desde el primer
// día —`objetivo: null` la borra (`lib/projects/settings-patch.ts`), con el
// comentario «así lo cancela el dueño sin esperar a que se cumpla»— y NINGÚN
// cliente mandaba eso jamás. Medido el 2026-09-08: cero llamadas en el repo.
// Una puerta con cerradura, sin picaporte por dentro.
//
// Vive fuera del componente por la misma razón que `undo-turn.ts`: lo que decide
// si al usuario se le dice «cancelado» tiene que poder probarse sin montar el
// panel, porque esa frase tiene que ser VERDAD.
// ─────────────────────────────────────────────────────────────────────────────

export type ResultadoCancelar =
  | { readonly ok: true }
  /** `servidor` = contestó y dijo que no. `red` = no llegó a contestar. Se
   *  distinguen porque al usuario se le dicen cosas distintas. */
  | { readonly ok: false; readonly motivo: "servidor" | "red" };

/** Lo MÍNIMO de `fetch` que hace falta. Estrecho a propósito: el `fetch` real
 *  encaja, y una prueba no necesita fabricar una `Response` entera. */
type FetchDeAjustes = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ readonly ok: boolean }>;

export async function cancelarObjetivo(o: {
  readonly projectId: string;
  readonly fetchImpl?: FetchDeAjustes;
}): Promise<ResultadoCancelar> {
  const pedir = o.fetchImpl ?? (globalThis.fetch as unknown as FetchDeAjustes);
  let res: { readonly ok: boolean };
  try {
    res = await pedir(`/api/projects/${o.projectId}/settings`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      // 🔴 `null` LITERAL, y no es un detalle de estilo. El servidor borra con
      // `if ("objetivo" in body)` y luego `=== null`. Un `undefined` se lo come
      // `JSON.stringify`, así que llegaría `{}`: la clave no estaría en el
      // cuerpo, no se borraría nada, y la respuesta seguiría siendo 200 — un
      // no-op que reporta éxito. Lo sujeta una prueba que mira el JSON crudo.
      body: JSON.stringify({ objetivo: null }),
    });
  } catch {
    // 🔴 SÓLO la red cae aquí. Un 401/404/500 resuelve el `fetch` con
    // normalidad y NO lanza — por eso el veredicto se lee de `res.ok` abajo y
    // no de la ausencia de excepción.
    return { ok: false, motivo: "red" };
  }
  return res.ok ? { ok: true } : { ok: false, motivo: "servidor" };
}
