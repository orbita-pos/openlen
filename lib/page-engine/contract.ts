import type { PasoSpec } from "@/lib/agent/behavior-spec";

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
    // "modules" se retiró el 2026-08-29 con el puente IA→módulos.
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
  /**
   * Selectores que NO pueden aplicar nunca sobre este documento — el CSS está
   * escrito, el elemento existe, y no se tocan.
   *
   * Aparte de `breakage` a propósito: aquello son roturas MEDIDAS en el render
   * y esto es determinista, así que llega también cuando no hubo navegador (el
   * turno del Agente). Mismo trato que `calcIssues`: el motor diagnostica, el
   * llamador decide si eso vale una llamada más al modelo.
   */
  readonly deadRules?: readonly {
    selector: string;
    ausentes: readonly string[];
    presentes: readonly string[];
  }[];
  /**
   * Los pasos de la prueba QUE EL MODELO DECLARÓ y que fallaron al ejecutarla
   * en el navegador. Ausente cuando no hubo prueba, no hubo navegador, o pasó.
   *
   * Aparte de `breakage` a propósito, y no por orden: aquello es rotura
   * OBSERVABLE —algo gritó— y esto es una PROMESA INCUMPLIDA, que no grita.
   * También se tratan distinto aguas arriba: la prueba del modelo puede estar
   * mal (medido — Len escribió una que esperaba `49:59` donde reiniciar da
   * `50:00`), así que vale una reparación barata y NUNCA una reescritura.
   */
  readonly specFailures?: readonly { paso: number; mensaje: string }[];
  // ⚰️ `modules` y `moduleSettings` salieron el 2026-08-29 con el puente
  // IA→módulos: la etapa que los llenaba ya no existe (ver prepare.ts).
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
  // `runtime` MURIÓ AQUÍ el 2026-08-26. Era el canal por el que viajaba el
  // código del modelo cuando vivía FUERA del documento (la cápsula): había que
  // injertarlo para poder medirlo y pasárselo aparte a los detectores. Ahora
  // el `<script>` está DENTRO del HTML que llega, así que quien necesite el
  // JavaScript lo lee de ahí (`todoElJsDelDocumento`). Un canal aparte sólo
  // podía volver a desincronizarse del documento, que es de lo que murió la
  // cápsula.
  /**
   * QUÉ DEBE PASAR, según el modelo que escribió el `runtime`.
   *
   * Se ejecuta en el MISMO navegador de la etapa de medición, justo después de
   * las capturas y en el hueco donde si no se pulsan los controles a ciegas.
   * Sin esto la medición sólo responde «¿explotó?»; con esto responde también
   * «¿hizo lo que prometió?», que es donde viven los dos fallos que de verdad
   * ocurren — el botón cableado a nada y el bucle que no para.
   *
   * Ausente ⇒ se pulsa a ciegas, exactamente como antes.
   */
  readonly prueba?: readonly PasoSpec[];
}
