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
//
// 🔴 EL DOCUMENTO NO VIAJA EN LA PETICIÓN — 2026-09-04.
//
// Hasta hoy esto mandaba el documento entero por `PATCH /api/projects/[id]/html`.
// Esa ruta SANEA el cuerpo —borra los `<script>` del modelo, porque viene del
// navegador y es entrada no fiable— y luego los repone con
// `conservarScripts(guardado, saneado)`, es decir DESDE EL DOCUMENTO GUARDADO.
//
// Para una EDICIÓN eso es correcto: el cuerpo sale del DOM del navegador y la
// verdad está en la base. Para un DESHACER está justo al revés —el cuerpo ES la
// verdad— así que reponía exactamente lo que había que tirar. MEDIDO: si el
// turno AÑADIÓ JavaScript, volvía el marcado y el script del turno se quedaba,
// cableado a elementos que ya no existen; si el turno lo QUITÓ, volvía el
// marcado y el JavaScript de antes NO volvía. El segundo destruye trabajo del
// usuario, y era el que se veía.
//
// Reponer los scripts del propio cuerpo parecía el parche corto y es un
// agujero: deja que el cliente inyecte JavaScript arbitrario, que es por lo que
// ese saneo está ahí. Así que Deshacer deja de mandar documento: llama a
// `POST /api/projects/[id]/versions/[vid]/restore`, que lee el HTML de
// `projectVersions.html` —verdad del servidor— y lo escribe sin pasar por el
// saneador. Se va la clase entera de fallo, no sólo esos dos casos. Y como
// `restoreVersion` archiva el estado previo, el propio Deshacer es deshacible.
//
// De ahí la regla 3: sin id de versión no hay Deshacer. Un turno enviado antes
// de este cambio no lo trae, y el único camino que le quedaba es el que
// rompía el JavaScript. Sus revisiones siguen en la pestaña Versiones.
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
  /** HTML de ANTES del turno. Vacío = turno restaurado de otra sesión.
   *  YA NO ES LO QUE SE RESTAURA —eso lo lee el servidor de su propia base—
   *  sino lo que el panel usa para contar qué cambió (`seccionesCambiadas`). */
  preEditHtml: string;
  /** Id de la versión que guarda el documento de ANTES del turno. La archiva
   *  `persistPage` con la etiqueta «Before AI edit», ANTES de escribir, y viaja
   *  hasta aquí por el evento `html` del Agente / el `done` del Chat clásico.
   *
   *  Ausente o `null` = turno anterior al 2026-09-04, o un turno cuyo snapshot
   *  no llegó a escribirse. En los dos casos NO hay Deshacer: ver la regla 3. */
  versionPrevia?: string | null;
  /** Página en la que empezó el turno — de donde viene `preEditHtml`.
   *  `undefined` = turno anterior al multipágina. */
  page?: string | null;
  /** Páginas que el turno escribió de verdad (una por evento `html`).
   *  Ausente en los turnos de ai-design, que son de una sola página. */
  paginasTocadas?: ReadonlyArray<string | null>;
}

export type MotivoSinUndo =
  | "no-aplicado"
  | "sin-preimagen"
  | "sin-version"
  | "otra-pagina";

export type PlanDeUndo =
  | { kind: "restaurar"; page: string | null; versionId: string }
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
  // SIN VERSIÓN NO HAY DESHACER (regla 3). No es una limitación técnica que se
  // pueda esquivar: el único camino alternativo —mandar el documento— es el que
  // le rompía el JavaScript a la página. Ofrecer un botón que hace eso sería
  // mentir mejor, no arreglar.
  if (!turn.versionPrevia) {
    return { kind: "imposible", motivo: "sin-version" };
  }
  // La preimagen pertenece a la página en la que empezó el turno, no a la que
  // el lienzo esté mostrando ahora. Los turnos pre-multipágina no traen `page`
  // y su única página posible es la actual.
  const anclaje = turn.page === undefined ? paginaActual : turn.page;
  const tocadas = turn.paginasTocadas ?? [];
  if (tocadas.some((p) => !mismaPagina(p, anclaje))) {
    return { kind: "imposible", motivo: "otra-pagina" };
  }
  return { kind: "restaurar", page: anclaje, versionId: turn.versionPrevia };
}

export type FalloDeUndo =
  | { motivo: "http"; status: number }
  | { motivo: "red" }
  /** 200, pero sin documento con el que refrescar el lienzo. No es la red ni un
   *  código HTTP, y callarlo sería decir «Revertido» sobre algo que nadie miró. */
  | { motivo: "respuesta" };

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
 * El orden importa y es la mitad del arreglo: el servidor primero, pintar
 * después. Pintar antes daría una reversión visual que la recarga desmiente.
 *
 * SIN CUERPO. La petición no lleva documento —sólo el id de la versión en la
 * URL— y ésa es la otra mitad: lo que no viaja no se sanea, y lo que no se
 * sanea no pierde el JavaScript del modelo. Ver la cabecera.
 *
 * Y se pinta LO QUE DEVUELVE EL SERVIDOR, no la copia del cliente. Es la misma
 * regla de arriba llevada hasta el final: si la base es la verdad para
 * restaurar, también lo es para enseñar el resultado. Dos fuentes para el mismo
 * píxel es como se separan.
 */
export async function ejecutarUndo(
  plan: PlanDeUndo,
  deps: DepsDeUndo,
): Promise<boolean> {
  if (plan.kind !== "restaurar") return false;

  let res: Response;
  try {
    res = await deps.fetchImpl(
      `/api/projects/${deps.projectId}/versions/${plan.versionId}/restore`,
      { method: "POST" },
    );
  } catch {
    deps.marcarFallo({ motivo: "red" });
    return false;
  }

  if (!res.ok) {
    deps.marcarFallo({ motivo: "http", status: res.status });
    return false;
  }

  // `restoreVersion` contesta con el documento restaurado y el ámbito en el que
  // aterrizó. Un 200 sin eso no es un éxito a medias: es un éxito que no se
  // puede comprobar, y ya hubo un Deshacer que cantaba victoria sin mirar.
  let cuerpo: { html?: unknown; page?: unknown };
  try {
    cuerpo = (await res.json()) as { html?: unknown; page?: unknown };
  } catch {
    deps.marcarFallo({ motivo: "respuesta" });
    return false;
  }
  if (typeof cuerpo?.html !== "string" || cuerpo.html.length === 0) {
    deps.marcarFallo({ motivo: "respuesta" });
    return false;
  }

  // El ámbito lo dice la FILA de la versión, que es quien sabe de qué documento
  // salió. `plan.page` sólo servía para decidir si se ofrecía el botón.
  const page = typeof cuerpo.page === "string" ? cuerpo.page : null;
  deps.pintar(cuerpo.html, page);
  deps.marcarRevertido();
  return true;
}
