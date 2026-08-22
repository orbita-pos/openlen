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
    | "modules"
    | "form_identity";
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
  /** Las fórmulas que siguen ROTAS después de reparar lo inequívoco.
   *
   *  Antes se perdían: `compileCalcRegions` corre dentro de `beforeMeta` y sólo
   *  su CONTEO llegaba al `detail` de la etapa. Se salvaban por accidente
   *  porque `validateBehaviors` las re-detecta vía `exprAttrs` — salvo la de
   *  "fuera de toda región", que sólo existe en el compilador y se iba en
   *  silencio. Un diagnóstico que nadie recibe no cierra ningún bucle. */
  readonly calcIssues?: readonly { attr: string; formula: string; message: string }[];
  /** Qué arregló el reparador determinista, en códigos de máquina. */
  readonly calcRepairs?: readonly string[];
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
  /**
   * Las etapas que necesitan un navegador — legibilidad y medición.
   *
   * MEDIDO: la puerta sola tarda 7-17 ms; con render, 5.5 s en caliente y 10.7 s
   * con Chrome frío. Eso es aceptable creando una página (ya son ~60 s) y no lo
   * es en una edición quirúrgica de dos operaciones, donde el usuario mira la
   * pantalla. Una reescritura completa SÍ lo vale: es una página nueva con otro
   * nombre.
   *
   * Ausente = true. Apagarlo no salta ninguna comprobación determinista de las
   * que no necesitan navegador: los invariantes y la puerta corren siempre.
   */
  readonly renderChecks?: boolean;
  /**
   * El documento ANTES de esta edición. Sólo en `mode: "edit"`.
   *
   * Sin esto, una conducta rota que YA venía en la página condena todas las
   * ediciones futuras: crear falla abierto y entrega la página con el defecto
   * anotado, editar falla cerrado y la rechaza. Medido en la primera página que
   * generó el motor — el modelo escribió botones de filtro sin la rejilla que
   * filtran — y con esa página el Chat y el Agente rechazaban CUALQUIER cambio,
   * hablándole al usuario de un control que no tocó.
   *
   * Con él, la puerta sólo rechaza lo que ESTA edición rompió.
   */
  readonly priorHtml?: string;
}
