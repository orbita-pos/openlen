import "server-only";

import type { ProjectData } from "@/lib/projects/types";
import { buildCapsule, resealRuntime, type ModelRuntimeCapsule } from "@/lib/projects/model-runtime";

/**
 * Guardar una página editada, en un solo sitio.
 *
 * El Agente ya había inventado este embudo (`persistHtmlChange`, antes en
 * lib/agent/tools.ts) y su comentario decía por qué: *"any tool that hands the
 * model a mutated document funnels its candidate HTML through this so
 * persistence semantics never drift between tools"*. Lo que no decía es que el
 * Chat tenía una copia — el propio código lo admitía, *"cloned from ai-design's
 * own page-branch"* — con los mismos dos snapshots y el mismo spread.
 *
 * Y ESTO es el sandbox que se pidió: mutar → validar → o se guarda entero, o no
 * se toca nada y la página del usuario queda byte-intacta. Aquí sólo vive la
 * mitad de guardar; la de validar es `preparePage`.
 */
export interface PersistPageInput {
  readonly projectId: string;
  readonly userId: string;
  /** Slug de la subpágina, o null para el documento de inicio. */
  readonly page: string | null;
  /** El HTML que ya pasó por `preparePage`. */
  readonly html: string;
  /** Etiqueta de la versión posterior ("Ops (3): …", "Rewrite: …"). */
  readonly label: string;
  /** Ajustes que el motor derivó de los huecos de módulo, si los hubo. */
  readonly settings?: ProjectData["settings"];
  /** Marca la versión como nueva línea base — una reescritura completa lo es. */
  readonly isBaseline?: boolean;
  /** Un `<script>` que el modelo acaba de escribir, sacado de su respuesta CRUDA
   *  (`extractModelRuntime`). Sólo llega desde superficies que producen un
   *  DOCUMENTO completo — una reescritura del Chat, un rediseño del Agente.
   *
   *  `undefined`/`null` NO borra nada: una edición por ops no trae script y lo
   *  que corresponde entonces es RE-SELLAR el que ya había, no tirarlo. Borrar
   *  el trabajo del modelo porque este turno no produjo uno sería el peor
   *  comportamiento posible. */
  readonly modelRuntime?: string | null;
}

export interface PersistPageDeps {
  readonly loadProject: (
    projectId: string,
    userId: string,
  ) => Promise<{ data: ProjectData; generatedRuntime?: unknown } | null>;
  /** `runtime` sólo llega cuando hay que RE-ATAR el JavaScript del modelo al
   *  documento nuevo. Viaja en el mismo UPDATE a propósito: hacerlo aparte
   *  costaría un SELECT en cada edición de cada proyecto, tenga cápsula o no. */
  readonly saveProjectData: (
    projectId: string,
    userId: string,
    data: ProjectData,
    runtime?: ModelRuntimeCapsule | null,
  ) => Promise<void>;
  /** Best-effort por contrato: perder un snapshot no puede costar la edición. */
  readonly snapshotVersion: (input: {
    projectId: string;
    html: string;
    label: string;
    source: "manual" | "chat";
    page: string | null;
    isBaseline?: boolean;
  }) => Promise<void>;
}

export type PersistPageResult =
  | { readonly ok: true; readonly html: string }
  | { readonly ok: false; readonly error: string };

/** El documento activo de esta sesión: inicio o subpágina, nunca los dos. */
export function activeHtml(data: ProjectData, page: string | null): string | null {
  return page ? (data.pages?.[page]?.html ?? null) : (data.html ?? null);
}

export async function persistPage(
  input: PersistPageInput,
  deps: PersistPageDeps,
): Promise<PersistPageResult> {
  const row = await deps.loadProject(input.projectId, input.userId);
  if (!row) return { ok: false, error: "proyecto no encontrado" };

  const withSettings = input.settings !== undefined ? { settings: input.settings } : {};
  // Spread inmutable: escribir una subpágina NUNCA toca `data.html` ni una
  // página hermana, y escribir inicio NUNCA toca `data.pages`.
  const nextData: ProjectData = input.page
    ? {
        ...row.data,
        ...withSettings,
        pages: {
          ...row.data.pages,
          [input.page]: { ...row.data.pages?.[input.page], html: input.html },
        },
      }
    : { ...row.data, html: input.html, ...withSettings };

  // El "antes" se guarda ANTES de escribir: si el guardado falla, la versión
  // previa ya existe y el usuario puede volver.
  const preEditHtml = activeHtml(row.data, input.page);
  if (preEditHtml && preEditHtml !== input.html) {
    await deps.snapshotVersion({
      projectId: input.projectId,
      html: preEditHtml,
      label: "Before AI edit",
      source: "manual",
      page: input.page,
    });
  }

  // El JavaScript del modelo sobrevive a la edición. El hash ata
  // `projectId + html + code`, así que sin esto la primera edición del titular
  // dejaba la página publicada sin su script, avisando sólo por consola.
  //
  // Sólo el documento de inicio: la cápsula ata `data.html` y una subpágina no
  // entra en el piloto. Y el código sale de la cápsula guardada, nunca de aquí
  // — re-sellar puede mover el documento, jamás introducir código nuevo.
  //
  // Si este turno trajo un script NUEVO, manda ése y se sella sobre el documento
  // que se va a guardar. Si no, se re-sella el que ya había.
  const runtime = input.page
    ? null
    : input.modelRuntime
      ? buildCapsule({
          projectId: input.projectId,
          html: input.html,
          code: input.modelRuntime,
        })
      : resealRuntime({
          projectId: input.projectId,
          html: input.html,
          capsule: row.generatedRuntime ?? null,
        });

  await deps.saveProjectData(input.projectId, input.userId, nextData, runtime);

  await deps.snapshotVersion({
    projectId: input.projectId,
    html: input.html,
    label: input.label,
    source: "chat",
    page: input.page,
    ...(input.isBaseline !== undefined ? { isBaseline: input.isBaseline } : {}),
  });

  return { ok: true, html: input.html };
}
