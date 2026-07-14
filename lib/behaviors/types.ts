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
     *  vive en lib/publish/carousel.ts y ya está desplegada).
     *
     *  INVARIANTE (fijado en el Task 11, autoplay): `requiresHost` significa
     *  que el marcador, o uno de sus ANCESTROS, matchea el selector —
     *  validate.ts camina ancestro-o-sí-mismo (estilo `closest()`), no exige
     *  que coexistan en el mismo elemento. El runtime de la receta DEBE
     *  resolver su host con `closest()` para ser coherente con esta
     *  validación: si el runtime asumiera "mismo elemento" (ej. leyendo un
     *  atributo hermano en vez de subir el árbol), un marcador válido según
     *  el validador podría no encontrar su host en tiempo de ejecución. */
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
    /** Referencia cruzada a OTRA parte del documento (hallazgo Fable,
     *  2026-07-13): el valor del atributo `via` — leído del propio elemento
     *  raíz o de su ancestro más cercano que lo tenga, el mismo caminado
     *  ancestro-o-sí-mismo de `requiresHost` — debe existir como valor EXACTO
     *  del atributo `target` en algún elemento del documento. Es la mitad que
     *  a `requiresHost` le faltaba: aquel garantiza que el botón vive en su
     *  grupo; este, que el grupo apunta a algo que existe. Sin él, un
     *  [data-ol-filter-group="menu"] sin su [data-ol-filter-target="menu"]
     *  pasaba el validador y el grupo entero de botones nacía muerto — el
     *  ejemplo LITERAL de la cabecera de validate.ts, que no se cazaba.
     *  Si el `via` no aparece en la caminata, este check se calla:
     *  `requiresHost` ya reporta la falta del host, y un segundo issue por el
     *  mismo hueco sería ruido. tabs (#8) lo necesitará igual. */
    crossRefs?: { via: string; target: string; why: string }[];
    /** El documento DEBE contener CSS que reaccione al efecto del runtime
     *  (hallazgo del eval conducta-theme, 2026-07-14: Gemini escribió el
     *  marcador de theme sin ningún `.dark` que lo escuchara — la advertencia
     *  en prosa del doc no bastó, y el eval era "la ÚNICA red"). `pattern` es
     *  un regex (fuente, se compila case-insensitive) que se prueba contra el
     *  HTML COMPLETO cuando al menos un marcador de la receta existe; si no
     *  matchea, UN issue por receta viaja por el canal aviso y el agente lo
     *  arregla en el mismo turno. Es la clase de conducta cuyo runtime solo
     *  conmuta una clase/atributo A PROPÓSITO (theme, sticky — el LOOK lo
     *  decide la página): este campo convierte "ojalá el modelo escriba el
     *  CSS" en una garantía mecánica, verificable sin gastar un token. */
    requiresCss?: { pattern: string; why: string };
  };

  js: string;
  css?: string;
  /** Pre-paint, va al <head>. SOLO `theme` lo usa (evitar el fogonazo blanco). */
  headJs?: string;
  /** Atributos que el RUNTIME de esta receta escribe en el DOM vivo y que el
   *  funnel de guardado (components/workspace-v2/strip-editor-instrumentation.ts)
   *  tiene licencia para borrar incondicionalmente. NINGÚN otro subsistema del
   *  producto puede escribirlos: si colisionan, el strip destruiría trabajo
   *  del creador (esto pasó de verdad — filter.ts reclamaba `data-ol-hidden`,
   *  ya dueño de la acción "Ocultar elemento" del inspector). Enumerar aquí
   *  NO deriva mecánicamente la lista del strip (esa sigue escrita a mano,
   *  a propósito — "enumerar no es interpretar"): este campo existe para que
   *  el test de colisión de namespace (lib/behaviors/conformance.test.ts)
   *  pueda auditar, receta por receta, que el nombre sigue siendo suyo en
   *  TODO el repo. Solo para atributos SIEMPRE removibles sin preguntar
   *  (categoría A del strip) — un mutation ambiguo como el `dark` de theme
   *  (que SÍ puede ser un valor autorado legítimo) no pertenece aquí. */
  runtimeAttrs?: string[];
  budgetBytes: number;

  degradation: Degradation;
  a11y: AriaRequirement[];

  /** De aquí se GENERA la documentación que lee la IA. No se escribe aparte.
   *  `label` es la glosa en ESPAÑOL de una a pocas palabras (p. ej. "contador
   *  en vivo" para countdown, "tema claro/oscuro" para theme) — el puente
   *  semántico que un modelo en español necesita para mapear "quiero un
   *  contador" al marcador `countdown`. Se usa SOLO en la cabecera de la
   *  sección CONDUCTAS (buildBehaviorsDoc, en doc.ts, que la deriva de
   *  BEHAVIOR_ORDER — nunca escrita a mano ahí); `name`/`marker` (arriba) son
   *  los identificadores de MÁQUINA, un concepto distinto que design-
   *  guidance.ts usa por su cuenta y que nunca debe fusionarse con este.
   *  Obligatorio: el arnés de conformidad (conformance.test.ts) exige que
   *  toda receta lo declare — una receta sin glosa es CI rojo. */
  doc: { label: string; when: string; whenNot: string; example: string };

  /** Techo de caracteres para `doc.label + doc.when + doc.whenNot +
   *  doc.example` juntos, el mismo mecanismo que `budgetBytes` pero para la
   *  sección CONDUCTAS de DESIGN_GUIDANCE en vez del runtime — es la razón
   *  por la que los runtimes miden 640-700B y no 3KB: un techo real, exigido
   *  por conformance.test.ts, no una convención de estilo. 1200 es el valor
   *  de las 7 recetas actuales (theme, la más verbosa, está en ~1136 sin
   *  contar `label` — pasa raspando a propósito: es el techo real que la
   *  próxima receta también tiene que respetar). */
  docBudgetChars: number;

  status: "stable" | "experimental" | "deprecated";
}

export interface BehaviorIssue {
  behavior: BehaviorName;
  /** Mensaje en español, accionable, dirigido al modelo que escribió el HTML. */
  message: string;
}
