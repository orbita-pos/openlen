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

/** Dos slugs apuntan al mismo documento; null/undefined = la Home. Vive con
 *  el historial del Agente, que la necesita para etiquetar los turnos de otra
 *  página: una sola definición para las dos decisiones. */
import { mismaPagina } from "@/lib/chat/historial-del-agente";
export { mismaPagina };

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
  /** LA CARPETA (pieza 9 de Len 2.5): los ficheros que el turno cambió, en
   *  orden, cada uno con la versión que archivó su «antes» (evento
   *  `ficheros` del Agente). Una ruta puede venir varias veces: la PRIMERA es
   *  su estado de antes del turno. `versionPrevia: null` = archivar falló. */
  ficherosTocados?: ReadonlyArray<{ readonly ruta: string; readonly versionPrevia: string | null }>;
  /** F2 DE LAS APPS WEB: el id con el que el SERVIDOR guardó lo que cambió el
   *  turno (evento `deshacible`). Con él, Deshacer lo hace el servidor entero
   *  —páginas y ficheros a la vez, o nada— y se niega si alguien cambió
   *  después lo mismo (`lib/projects/deshacer-turno.ts`). Ausente: turno
   *  anterior, o el servidor no pudo guardarlo; queda el Deshacer de siempre. */
  deshacerEnServidor?: string | null;
}

export type MotivoSinUndo =
  | "no-aplicado"
  | "sin-preimagen"
  | "sin-version"
  | "otra-pagina"
  /** Algún fichero que tocó el turno no tiene versión de antes: deshacer
   *  dejaría ese fichero cambiado y diría «Revertido». */
  | "fichero-sin-version";

export type PlanDeUndo =
  /** El servidor lo deshace entero (F2). `respaldo` es el plan de siempre, por
   *  si el servidor ya no tiene el registro (404 `sin_registro`). */
  | { kind: "servidor"; turnId: string; respaldo: PlanDeUndo }
  | {
      kind: "restaurar";
      page: string | null;
      /** La versión de la página. `null` = el turno sólo tocó ficheros. */
      versionId: string | null;
      /** Los ficheros a devolver a su estado de antes del turno (pieza 9).
       *  Ausente si el turno no tocó ninguno. */
      files?: ReadonlyArray<{ ruta: string; versionId: string }>;
    }
  | { kind: "imposible"; motivo: MotivoSinUndo };

/**
 * Qué se puede hacer con este turno. Puro: la misma llamada decide si el botón
 * se pinta y qué hace al pulsarlo, para que no puedan discrepar.
 */
export function planDeUndo(
  turn: TurnoParaUndo,
  paginaActual: string | null,
): PlanDeUndo {
  const local = planDeUndoLocal(turn, paginaActual);
  // F2: con registro en el servidor, Deshacer es suyo — también para un turno
  // que tocó otra página o que no tiene preimagen, que aquí no se podían.
  if (turn.status === "applied" && turn.deshacerEnServidor) {
    return { kind: "servidor", turnId: turn.deshacerEnServidor, respaldo: local };
  }
  return local;
}

/** ¿Se pinta el botón? Una sola respuesta para los dos pies de turno. */
export function ofreceDeshacer(plan: PlanDeUndo | null | undefined): boolean {
  return plan?.kind === "restaurar" || plan?.kind === "servidor";
}

/** El plan de siempre: la página y los ficheros, uno a uno, desde aquí. */
function planDeUndoLocal(
  turn: TurnoParaUndo,
  paginaActual: string | null,
): PlanDeUndo {
  if (turn.status !== "applied") {
    return { kind: "imposible", motivo: "no-aplicado" };
  }
  // LA CARPETA (pieza 9 de Len 2.5): todos los ficheros del turno vuelven, o
  // no se ofrece. Un fichero sin versión de antes quedaría cambiado bajo un
  // «Revertido» — la mentira de la regla 2, con otro disfraz.
  const ficheros = turn.ficherosTocados ?? [];
  if (ficheros.some((f) => !f.versionPrevia)) {
    return { kind: "imposible", motivo: "fichero-sin-version" };
  }
  const vistas = new Set<string>();
  const files: Array<{ ruta: string; versionId: string }> = [];
  for (const f of ficheros) {
    if (vistas.has(f.ruta)) continue;
    vistas.add(f.ruta);
    files.push({ ruta: f.ruta, versionId: f.versionPrevia as string });
  }
  // Un turno que SÓLO tocó ficheros (ninguna página escrita) se deshace sin
  // página: no hay preimagen que restaurar ni que exigir.
  if (files.length > 0 && turn.paginasTocadas !== undefined && turn.paginasTocadas.length === 0) {
    return { kind: "restaurar", page: null, versionId: null, files };
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
  return {
    kind: "restaurar",
    page: anclaje,
    versionId: turn.versionPrevia,
    ...(files.length > 0 ? { files } : {}),
  };
}

/**
 * Lo que trae el evento `ficheros` del Agente (pieza 9 de Len 2.5): los
 * ficheros que cambió una herramienta, cada uno con la versión de su «antes».
 * Llega por el SSE, así que se lee entrada a entrada y lo que no tiene forma se
 * cae — nunca un `as` sobre lo que mande el servidor.
 */
export function ficherosDelEvento(
  payload: unknown,
): Array<{ ruta: string; versionPrevia: string | null }> {
  const lista = (payload as { ficherosTocados?: unknown } | null)?.ficherosTocados;
  if (!Array.isArray(lista)) return [];
  return lista.flatMap((f) => {
    const { ruta, versionPrevia } = (f ?? {}) as { ruta?: unknown; versionPrevia?: unknown };
    if (typeof ruta !== "string" || !(typeof versionPrevia === "string" || versionPrevia === null)) return [];
    return [{ ruta, versionPrevia }];
  });
}

export type FalloDeUndo =
  | { motivo: "http"; status: number }
  | { motivo: "red" }
  /** F2: alguien cambió DESPUÉS del turno algo que el turno tocó. El servidor
   *  no deshizo nada, y éstas son las rutas. */
  | { motivo: "se_solapan"; rutas: readonly string[] }
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
  /** LA CARPETA (pieza 9): los ficheros ya volvieron. No cambian el documento,
   *  así que quien enseña la página tiene que enterarse por aquí. */
  ficherosRestaurados?(): void;
  /** F2: deshecho, pero esto que cambió el turno NO volvió (la base de datos
   *  de /supabase, la memoria, los ajustes). Se dice, no se calla. */
  noSeDeshizo?(rutas: readonly string[]): void;
}

/** El texto de un fallo de Deshacer, para los dos pies de turno: una clave de
 *  `panelsChat` y sus valores. */
export function textoDelFallo(fallo: FalloDeUndo): { clave: string; valores?: Record<string, string | number> } {
  switch (fallo.motivo) {
    case "red":
      return { clave: "undo.failedNetwork" };
    case "respuesta":
      return { clave: "undo.failedResponse" };
    case "se_solapan":
      return { clave: "undo.failedOverlap", valores: { rutas: fallo.rutas.join(", ") } };
    case "http":
      return { clave: "undo.failedHttp", valores: { status: fallo.status } };
  }
}

/** F2: el servidor deshace el turno entero. `null` = no tiene el registro: el
 *  llamador prueba el plan de siempre. */
async function ejecutarEnServidor(
  plan: Extract<PlanDeUndo, { kind: "servidor" }>,
  deps: DepsDeUndo,
): Promise<boolean | null> {
  let res: Response;
  try {
    res = await deps.fetchImpl(
      `/api/projects/${deps.projectId}/turnos/${encodeURIComponent(plan.turnId)}/deshacer`,
      { method: "POST" },
    );
  } catch {
    deps.marcarFallo({ motivo: "red" });
    return false;
  }
  let cuerpo: { error?: unknown; rutas?: unknown; paginas?: unknown; ficheros?: unknown; noSeDeshacen?: unknown } = {};
  try {
    cuerpo = (await res.json()) as typeof cuerpo;
  } catch {
    if (res.ok) {
      deps.marcarFallo({ motivo: "respuesta" });
      return false;
    }
  }
  if (!res.ok) {
    if (res.status === 404 && cuerpo.error === "sin_registro") return null;
    if (res.status === 409 && cuerpo.error === "se_solapan" && Array.isArray(cuerpo.rutas)) {
      deps.marcarFallo({ motivo: "se_solapan", rutas: cuerpo.rutas.filter((r): r is string => typeof r === "string") });
      return false;
    }
    deps.marcarFallo({ motivo: "http", status: res.status });
    return false;
  }
  if (!Array.isArray(cuerpo.paginas) || !Array.isArray(cuerpo.ficheros)) {
    deps.marcarFallo({ motivo: "respuesta" });
    return false;
  }
  // Lo que pinta el lienzo es lo que DEVOLVIÓ el servidor, página a página.
  for (const p of cuerpo.paginas) {
    const { page, html } = (p ?? {}) as { page?: unknown; html?: unknown };
    if (typeof html === "string") deps.pintar(html, typeof page === "string" ? page : null);
  }
  if (cuerpo.ficheros.length > 0) deps.ficherosRestaurados?.();
  const noVuelven = Array.isArray(cuerpo.noSeDeshacen) ? cuerpo.noSeDeshacen.filter((r): r is string => typeof r === "string") : [];
  if (noVuelven.length > 0) deps.noSeDeshizo?.(noVuelven);
  deps.marcarRevertido();
  return true;
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
  if (plan.kind === "servidor") {
    const r = await ejecutarEnServidor(plan, deps);
    if (r !== null) return r;
    // El servidor no tiene el registro: el plan de siempre, si lo hay.
    if (plan.respaldo.kind !== "restaurar") {
      deps.marcarFallo({ motivo: "http", status: 404 });
      return false;
    }
    return ejecutarUndo(plan.respaldo, deps);
  }
  if (plan.kind !== "restaurar") return false;

  // LOS FICHEROS PRIMERO (pieza 9 de Len 2.5), uno a uno, y el primero que
  // falla para todo: ni página, ni pintar, ni «Revertido». Como la página,
  // sin cuerpo: la versión la lee el servidor de su base
  // (`restoreFileVersion`), y restaurar archiva lo de ahora, así que el propio
  // Deshacer se deshace.
  for (const f of plan.files ?? []) {
    let r: Response;
    try {
      r = await deps.fetchImpl(`/api/projects/${deps.projectId}/ficheros/versions/${f.versionId}/restore`, {
        method: "POST",
      });
    } catch {
      deps.marcarFallo({ motivo: "red" });
      return false;
    }
    if (!r.ok) {
      deps.marcarFallo({ motivo: "http", status: r.status });
      return false;
    }
  }
  if ((plan.files ?? []).length > 0) deps.ficherosRestaurados?.();
  // Sólo ficheros: no hay documento que pintar.
  if (plan.versionId === null) {
    deps.marcarRevertido();
    return true;
  }

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
