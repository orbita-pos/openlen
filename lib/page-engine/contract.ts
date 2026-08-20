import type { BusinessProfileData } from "@/lib/business-profiles/types";

/**
 * Crear vs editar. La diferencia NO es cosmética y se conserva a propósito:
 *
 * - `create` — no hay página que perder. Una conducta mal cableada se anota
 *   como degradación y el documento se entrega igual (`behaviors: "warn"`).
 * - `edit` — la página del usuario ya existe. Romperla es peor que perder la
 *   edición, así que la puerta falla CERRADA (`behaviors: "block"`) y no se
 *   guarda nada.
 */
export type PageMode = "create" | "edit";

/** Cada etapa dice qué hizo, o por qué no pudo. Ninguna puede tirar la página. */
export interface StageOutcome {
  readonly stage:
    | "imagery"
    | "legibility"
    | "measure"
    | "invariants"
    | "gate"
    | "modules";
  /** `changed` cambió el documento · `skipped` no había nada que hacer o está
   *  apagada · `unavailable` lo intentó y no pudo (el motivo va en `detail`). */
  readonly status: "changed" | "skipped" | "unavailable";
  readonly detail?: string;
}

export interface PrepareReport {
  readonly stages: readonly StageOutcome[];
  /** Roturas MEDIDAS en el render. Vacío no prueba que no haya: si el render
   *  falló, la etapa `measure` lo dice como `unavailable`. */
  readonly breakage: readonly string[];
  /** Lo que el saneador quitó y las conductas que la puerta objetó — el
   *  material del que la ruta arma su aviso al usuario o al modelo. */
  readonly removed?: {
    scripts: number;
    eventHandlers: number;
    dangerousUrls: number;
    iframes: number;
    metaRefresh: number;
  };
  readonly behaviorIssues?: readonly unknown[];
  /** Módulos que el documento pidió (huecos `data-openlen-*`). */
  readonly modules: readonly string[];
  readonly moduleSettings?: unknown;
}

export type PrepareResult =
  | { readonly ok: true; readonly html: string; readonly report: PrepareReport }
  /** Sólo la puerta puede refusar. Las demás etapas son fail-soft por contrato. */
  | {
      readonly ok: false;
      readonly code: string;
      readonly detail?: string;
      readonly report: PrepareReport;
    };

export interface PreparePageOptions {
  readonly mode: PageMode;
  /** Guía la búsqueda de fotos. Sin él la etapa de imágenes se salta. */
  readonly brief?: string;
  /** Sembrado de marca + metadatos. Ausente = ninguno de los dos. */
  readonly profile?: BusinessProfileData;
  readonly title?: string;
  /** Ajustes actuales del proyecto, para que el puente de módulos no los pise. */
  readonly settings?: unknown;
}
