// El contrato ejecutable de una conducta. TODO lo demás (runtime, validador,
// documentación de la IA, tests) se DERIVA de aquí — nada se escribe dos veces.
// Mismo patrón que lib/agent/catalog.ts ("LA fuente única… de aquí salen las
// DOS mitades"). Un Record<nombre, {marcador, js}> obligaría a escribir el
// contrato en cuatro sitios y a sincronizarlos a mano; eso ya divergió una vez
// en este repo (DESIGN_GUIDANCE prometía <script> mientras el sanitizer lo
// borraba), y no se repite.

/** Cómo se valida el VALOR del atributo raíz. */
export type AttrSpec =
  /** ISO 8601. Rechaza "15 de agosto". Sin offset ⇒ hora local del visitante. */
  | { kind: "isoDate" }
  /** Entero de milisegundos, con mínimo. */
  | { kind: "ms"; min: number }
  /** El valor es el `id` de un elemento que DEBE existir en el documento. */
  | { kind: "idRef" }
  /** Lista de etiquetas separadas por espacio; `*` = todas. */
  | { kind: "tagList" }
  /** URL http(s) — nada más. Usado por atributos `untrusted`. */
  | { kind: "httpUrl" }
  /** El atributo existe y su valor da igual (booleano). */
  | { kind: "flag" };

/** Un descendiente obligatorio del elemento raíz. */
export interface PartSpec {
  /** Selector CSS relativo a la raíz. */
  selector: string;
  /** Cardinalidad mínima. 1 = obligatorio. */
  min: number;
  /** Por qué hace falta — el texto se lo llevará el mensaje del validador. */
  why: string;
}

export interface AriaRequirement {
  /** Selector CSS (relativo a la raíz) del elemento que debe llevar el atributo. */
  selector: string;
  attr: string;
}

/** Qué se ve cuando el runtime NO corre (kill-switch, error, JS bloqueado). */
export type Degradation =
  /** El contenido sigue entero y usable. La receta solo lo mejoraba. */
  | "content-intact"
  /** Un control queda inerte. SOLO aceptable si es un control, nunca contenido. */
  | "control-inert";

export type BehaviorName =
  | "countdown" | "filter" | "lightbox" | "copy" | "autoplay" | "theme" | "sticky";

export interface Behavior {
  name: BehaviorName;
  /** Atributo raíz. Su sola presencia en el HTML mete el trozo en el runtime. */
  marker: string;

  schema: {
    root: AttrSpec;
    parts?: PartSpec[];
    /** Selector CSS que el marcador DEBE habitar. autoplay ⇒ "[data-ol-row]"
     *  (la estructura del carrusel, que NO es una conducta de este registro:
     *  vive en lib/publish/carousel.ts y ya está desplegada). */
    requiresHost?: string;
    /** Atributos que DEBEN existir en el elemento raíz. `untrusted` solo
     *  revalida el valor cuando el atributo está presente; esto exige que esté.
     *  Sin él, un <a data-ol-lightbox> sin href pasaría el validador y nacería
     *  muerto — justo lo que este sistema existe para impedir. */
    requiredAttrs?: string[];
    /** Atributos cuyo valor acaba en un sink del DOM (href → img.src). El
     *  runtime DEBE revalidarlos en el punto de uso: el sanitizer es una capa,
     *  no la única. */
    untrusted?: string[];
  };

  js: string;
  css?: string;
  /** Pre-paint, va al <head>. SOLO `theme` lo usa (evitar el fogonazo blanco). */
  headJs?: string;
  budgetBytes: number;

  degradation: Degradation;
  a11y: AriaRequirement[];

  /** De aquí se GENERA la documentación que lee la IA. No se escribe aparte. */
  doc: { when: string; whenNot: string; example: string };

  status: "stable" | "experimental" | "deprecated";
}

export interface BehaviorIssue {
  behavior: BehaviorName;
  /** Mensaje en español, accionable, dirigido al modelo que escribió el HTML. */
  message: string;
}
