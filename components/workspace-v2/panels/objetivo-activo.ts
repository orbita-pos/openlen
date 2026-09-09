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
) => Promise<{ readonly ok: boolean; readonly json?: () => Promise<unknown> }>;

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

export type ObjetivoPuesto = { readonly condicion: string; readonly creadoEn: string };

export type ResultadoPoner =
  | { readonly ok: true; readonly objetivo: ObjetivoPuesto }
  | { readonly ok: false; readonly motivo: "vacia" | "servidor" | "red" };

/**
 * PONER UN OBJETIVO — la puerta del DUEÑO, y la que no se apaga.
 *
 * 🔴 LA VARA. El esquema de ajustes del binario lo dice entero: «'disabled'
 * turns the tool off. A typed /goal is unaffected.» Lo desactivable es que el
 * MODELO proponga; lo que el usuario teclea, no. Nosotros teníamos justo lo
 * contrario —una sola vía, la del modelo— y está medido que el modelo no la usa
 * (0 propuestas en 11 corridas donde cabía), así que la función no ocurría.
 *
 * No se porta la TECLA, se porta la FORMA: una condición escrita por él, un solo
 * gesto, y CERO llamadas de modelo. `/goal` es una tecla porque su usuario vive
 * en un terminal; el nuestro no.
 *
 * Escribe por la MISMA ruta que la tarjeta de aprobación, así que el reemplazo
 * de un objetivo anterior lo hace el servidor igual que allí.
 */
export async function ponerObjetivo(o: {
  readonly projectId: string;
  readonly condicion: string;
  readonly fetchImpl?: FetchDeAjustes;
}): Promise<ResultadoPoner> {
  // Se recorta ANTES de mandar: el tope de 500 y la ficha cuentan caracteres de
  // verdad, y una condición de sólo espacios no es una condición.
  const condicion = o.condicion.trim();
  if (condicion.length === 0) return { ok: false, motivo: "vacia" };

  const pedir = o.fetchImpl ?? (globalThis.fetch as unknown as FetchDeAjustes);
  let res: { ok: boolean; json?: () => Promise<unknown> };
  try {
    res = await pedir(`/api/projects/${o.projectId}/settings`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ objetivo: { condicion } }),
    });
  } catch {
    return { ok: false, motivo: "red" };
  }
  if (!res.ok) return { ok: false, motivo: "servidor" };

  // 🔴 SE DEVUELVE LO QUE GUARDÓ EL SERVIDOR, no lo que mandamos. Él pone el
  // `creadoEn` —la ficha dice «lo persigue desde…» con esa fecha, y el reloj del
  // navegador no es la verdad— y él aplica el recorte a `MAX_CONDICION`.
  const cuerpo = (await (res.json?.() ?? Promise.resolve(null)).catch(() => null)) as
    | { settings?: { objetivo?: ObjetivoPuesto } }
    | null;
  const guardado = cuerpo?.settings?.objetivo;
  return {
    ok: true,
    objetivo: guardado ?? { condicion, creadoEn: new Date().toISOString() },
  };
}
