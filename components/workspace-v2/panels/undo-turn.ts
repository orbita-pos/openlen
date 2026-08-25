// ─────────────────────────────────────────────────────────────────────────────
// Deshacer un turno del Chat — la decisión y la ejecución, fuera del componente.
//
// Vive aquí y no dentro de chat-panel.tsx por una razón concreta: esto es lo que
// decide si al usuario se le dice «Revertido», y esa frase tiene que ser VERDAD.
// Antes se decía antes de saberlo — la UI marcaba el turno como revertido y el
// PATCH salía sin que nadie mirase la respuesta (`catch {}` con el comentario
// «DB sync failing is soft»). Un 401, 404, 413 o 500 resuelven la promesa de
// `fetch` con normalidad: no hay excepción que capturar. La página volvía a su
// estado anterior sólo en el iframe, y el cambio reaparecía al recargar.
//
// Dos reglas, y ninguna de las dos es opinable:
//   1. No se pinta ni se dice «Revertido» hasta que el servidor lo confirme.
//   2. Un turno que tocó una página distinta de la que ancla su preimagen NO
//      ofrece Deshacer: sólo hay UNA preimagen (la de la página en la que
//      empezó el turno) y el Agente puede cambiar de documento a mitad con
//      `trabajar_en_pagina`. Restaurar la que no cambió y cantar «Revertido»
//      es exactamente la mentira que la doctrina de degradación prohíbe.
// ─────────────────────────────────────────────────────────────────────────────

/** Dos slugs apuntan al mismo documento; null/undefined = la Home. */
export function mismaPagina(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  return (a ?? null) === (b ?? null);
}

/** Lo mínimo de un turno que hace falta para decidir. */
export interface TurnoParaUndo {
  status: string;
  /** HTML de ANTES del turno. Vacío = turno restaurado de otra sesión. */
  preEditHtml: string;
  /** Página en la que empezó el turno — de donde viene `preEditHtml`.
   *  `undefined` = turno anterior al multipágina. */
  page?: string | null;
  /** Páginas que el turno escribió de verdad (una por evento `html`).
   *  Ausente en los turnos de ai-design, que son de una sola página. */
  paginasTocadas?: ReadonlyArray<string | null>;
}

export type MotivoSinUndo = "no-aplicado" | "sin-preimagen" | "otra-pagina";

export type PlanDeUndo =
  | { kind: "restaurar"; page: string | null; html: string }
  | { kind: "imposible"; motivo: MotivoSinUndo };

/**
 * Qué se puede hacer con este turno. Puro: la misma llamada decide si el botón
 * se pinta y qué hace al pulsarlo, para que no puedan discrepar.
 */
export function planDeUndo(
  turn: TurnoParaUndo,
  paginaActual: string | null,
): PlanDeUndo {
  if (turn.status !== "applied") {
    return { kind: "imposible", motivo: "no-aplicado" };
  }
  if (turn.preEditHtml.length === 0) {
    return { kind: "imposible", motivo: "sin-preimagen" };
  }
  // La preimagen pertenece a la página en la que empezó el turno, no a la que
  // el lienzo esté mostrando ahora. Los turnos pre-multipágina no traen `page`
  // y su única página posible es la actual.
  const anclaje = turn.page === undefined ? paginaActual : turn.page;
  const tocadas = turn.paginasTocadas ?? [];
  if (tocadas.some((p) => !mismaPagina(p, anclaje))) {
    return { kind: "imposible", motivo: "otra-pagina" };
  }
  return { kind: "restaurar", page: anclaje, html: turn.preEditHtml };
}

export type FalloDeUndo =
  | { motivo: "http"; status: number }
  | { motivo: "red" };

export interface DepsDeUndo {
  projectId: string;
  fetchImpl: typeof fetch;
  /** Pinta el documento restaurado en el lienzo. Sólo tras el OK del servidor. */
  pintar(html: string, page: string | null): void;
  /** Marca el turno como revertido. Sólo tras el OK del servidor. */
  marcarRevertido(): void;
  /** El servidor no lo aceptó: el turno SIGUE aplicado y hay que decirlo. */
  marcarFallo(fallo: FalloDeUndo): void;
}

/**
 * Ejecuta el plan. Devuelve true sólo si el servidor confirmó la restauración.
 *
 * El orden importa y es la mitad del arreglo: PATCH primero, pintar después.
 * Pintar antes daría una reversión visual que la recarga desmiente.
 */
export async function ejecutarUndo(
  plan: PlanDeUndo,
  deps: DepsDeUndo,
): Promise<boolean> {
  if (plan.kind !== "restaurar") return false;

  let res: Response;
  try {
    res = await deps.fetchImpl(`/api/projects/${deps.projectId}/html`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        html: plan.html,
        ...(plan.page ? { page: plan.page } : {}),
      }),
    });
  } catch {
    deps.marcarFallo({ motivo: "red" });
    return false;
  }

  if (!res.ok) {
    deps.marcarFallo({ motivo: "http", status: res.status });
    return false;
  }

  deps.pintar(plan.html, plan.page);
  deps.marcarRevertido();
  return true;
}
