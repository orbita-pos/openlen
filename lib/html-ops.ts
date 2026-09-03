// HTML editing operations — ID-tagged DOM addressing for the Chat tab's
// patch protocol. Server-side we inject a `data-op-id` attribute on every
// element of the project HTML before sending it to the chat model. The
// model emits ops keyed on those IDs (e.g. `target="a4"`); the applier
// looks them up and mutates the DOM. After applying, we strip the IDs so
// persisted / published HTML stays clean.
//
// Why IDs and not exact-string-match (SEARCH/REPLACE) anchors:
//   - Anchor by attribute = ~10 tokens; anchor by outerHTML = 200-1000+
//   - Zero ambiguity — every element has a unique ID, lookup is O(1)
//   - The model addresses "this h1" by id, no risk of editing the wrong
//     duplicate (HTML has many repeated structures like <li>, <div.card>)
//
// Backed by the Rust `@openlen/html-engine` ID-tag ops engine since F1 S9.
//
// Known carry-over: `applyOps` may under-report `appliedCount` when an
// op deletes an ancestor of a later op's target — the visible HTML is
// correct (the contract callers depend on), only the count drifts. Soak
// data showed zero actionable apply-ops divergences across 70 records.

import {
  applyOps as rustApplyOps,
  rejectDocumentWideOps as rustRejectDocumentWideOps,
  buildScopedView as rustBuildScopedView,
  parseOps as rustParseOps,
  outerHtmlByOpId as rustOuterHtmlByOpId,
  resolveOpIdByPath as rustResolveOpIdByPath,
  stripOpIds as rustStripOpIds,
  tagWithOpIds as rustTagWithOpIds,
  type Op as EngineOp,
  type OpAttr,
  type ScopedView as RustScopedView,
} from "@/lib/html-engine";

export type { OpAttr };

export interface TaggedHtmlResult {
  taggedHtml: string;
  /** How many elements got an ID. Used to enforce a sanity cap in
   *  oversized docs. */
  taggedCount: number;
}

/** Inject `data-op-id` on every "addressable" element. IDs are base36
 *  monotonic strings (a, b, c, ..., z, 10, 11, ...) to keep them as short
 *  as possible in the prompt. */
export function tagWithOpIds(html: string): TaggedHtmlResult {
  return rustTagWithOpIds(html);
}

export interface ScopedView {
  /** The enclosing semantic container's outerHtml, still carrying op-ids
   *  so the model can address its descendants. */
  scopedHtml: string;
  /** The container's own op-id — the model uses this to delete/replace
   *  the whole scoped block, or insert siblings before/after it. */
  containerOpId: string;
  /** One-line-per-top-level-section summary of the whole document so the
   *  model knows what else lives on the page even though we didn't ship
   *  the full HTML. Each line: `- [opId] <tag> "first-heading-or-hint"`. */
  outline: string;
  /** True when the pin already addresses a body-level container (no
   *  walking needed). Cosmetic — useful when wording the prompt. */
  pinIsContainer: boolean;
}

/** Resolve a CSS-selector breadcrumb (from the iframe's section-select
 *  script) against an already-tagged document, returning the matched
 *  element's `data-op-id`. Used by the Chat AI route to turn a click
 *  gesture into a hard pin for the model.
 *
 *  Returns null when the path is empty, the document doesn't parse, or
 *  the selector doesn't match anything. The caller falls back to the
 *  textual hint in that case — so a miss never breaks the request. */
export function resolveOpIdByPath(
  taggedHtml: string,
  path: string,
): string | null {
  return rustResolveOpIdByPath(taggedHtml, path);
}

/** Given a tagged document and a pin (an op-id known to exist), return a
 *  scoped view: the pin's enclosing semantic container + an outline of all
 *  other top-level sections. Lets the route send the model a tiny payload
 *  instead of the entire taggedHtml.
 *
 *  Returns null when:
 *    - the document doesn't parse,
 *    - the pin isn't found,
 *    - there's no <body> (malformed doc). */
export function buildScopedView(
  taggedHtml: string,
  pinnedOpId: string,
): ScopedView | null {
  const r = rustBuildScopedView(taggedHtml, pinnedOpId) as RustScopedView | null;
  if (!r) return null;
  return {
    scopedHtml: r.scopedHtml,
    containerOpId: r.containerOpId,
    outline: r.outline,
    pinIsContainer: r.pinIsContainer,
  };
}

/**
 * EL ÍNDICE DEL DOCUMENTO ENTERO, sin abrir ninguna sección.
 *
 * `buildScopedView` ya calcula este índice, pero exige un pin — y el caso que
 * lo necesita es justo el contrario: una página que no cabe en un turno y un
 * usuario que no señaló nada («pon los botones en azul»). Hasta que existió
 * esto, ese turno era un 413 y el Agente quedaba inutilizable en esa página.
 *
 * Ancla en el PRIMER op-id del documento y se queda sólo con el `outline`. El
 * `scopedHtml` que viene de propina se descarta a propósito: quien llama ya
 * decidió que no cabe nada más que el índice.
 *
 * 🔴 Y SE QUITA EL MARCADOR `(SCOPED)`. El índice lista las mismas secciones
 * se ancle donde se ancle, pero marca así la que CONTIENE el ancla — porque en
 * el camino normal esa sección viaja abierta al lado. Aquí no viaja nada: el
 * ancla es un detalle de implementación para poder llamar al motor, no algo
 * que el usuario señaló. Dejar el marcador le diría al modelo que tiene
 * delante un HTML que nadie le mandó, y describir la página peor de lo que es
 * se arregla; mentirle sobre lo que tiene delante, no.
 *
 * `null` cuando el documento no tiene op-ids o el motor no puede construir la
 * vista — quien llama vuelve a su camino de siempre (que hoy es el 413).
 */
export function buildOutline(taggedHtml: string): string | null {
  // 🔴 NO SIRVE ANCLAR EN EL PRIMERO. Anclar a ciegas devolvía null en todas
  // las páginas de verdad, así
  // que el plano B habría quedado APAGADO en silencio: código nuevo, camino
  // muerto, y el 413 igual que antes. Lo cazó una prueba de comportamiento —
  // las guardas que sólo miran el cableado lo daban por bueno.
  //
  // ⚠️ Y LA RAZÓN QUE SE ESCRIBIÓ AQUÍ ERA FALSA, las dos mitades (auditado el
  // 2026-09-01). El primer op-id NO es el del <html>: <html> está en SKIP_TAGS
  // del etiquetador, así que nunca lleva id — el primero es el del <body>. Y el
  // motor Rust NO rechaza ninguno de los dos como objetivo: los reemplazaría
  // encantado. Quien los rechaza es `rejectDocumentWideOps`, aquí en TypeScript,
  // y sólo cuando su regex casa. El comportamiento observado era correcto; la
  // explicación, inventada.
  //
  // Se prueban los primeros ids hasta que uno sirva. El tope evita recorrer un
  // documento entero cuando ninguno vale (documento sin secciones, marcado
  // roto): en ese caso quien llama vuelve a su camino de siempre.
  const marcas = taggedHtml.match(/\sdata-op-id="([^"]+)"/g);
  if (!marcas) return null;
  for (const marca of marcas.slice(0, 50)) {
    const id = /"([^"]+)"/.exec(marca)?.[1];
    if (!id) continue;
    const view = buildScopedView(taggedHtml, id);
    if (view) return view.outline.replace(/ \(SCOPED\)/g, "");
  }
  return null;
}

/** Strip `data-op-id` attributes from the HTML. Always called before
 *  persisting / publishing so the IDs never leak to disk or to the user's
 *  subdomain. */
export function stripOpIds(html: string): string {
  return rustStripOpIds(html);
}

/**
 * El outerHTML EXACTO del elemento con esa op-id, byte a byte.
 *
 * Lo resuelve el motor marcando los BORDES con el parser y recortando entre
 * ellos, no serializando el arbol: el recorte se vuelve a meter en el documento
 * cuando el taller mueve una seccion, y normalizarlo seria reescribir la pagina
 * del usuario para cambiarla de sitio.
 */
export function outerHtmlByOpId(
  taggedHtml: string,
  opId: string,
): string | null {
  return rustOuterHtmlByOpId(taggedHtml, opId);
}

export type OpType =
  | "replace"
  | "insert_before"
  | "insert_after"
  | "delete"
  /** Reescribe la ETIQUETA DE APERTURA y nada más — «cómo se ve». La usa el
   *  taller (`lib/page-engine/aplicar-ediciones.ts`) para que una tanda entera
   *  de re-tinta viaje en una sola pasada, y desde el 2026-09-01 también la
   *  emite el modelo: es la forma correcta de cambiar una clase, un `src` o un
   *  `href` sin tocar el subárbol. */
  | "attrs"
  /** Cambia el TEXTO de un nodo y nada más — «qué dice». La hermana de
   *  `attrs`. Entre las dos quitan los dos motivos por los que se acababa
   *  tocando `replace` sobre un contenedor, que es por donde se han perdido
   *  secciones enteras. El motor la RECHAZA sobre un nodo con hijos elemento
   *  (sería un borrado encubierto) y le dice al modelo a qué id apuntar. */
  | "text";

export interface Op {
  type: OpType;
  target: string;
  /** New HTML for replace / insert_*; ignored for delete. */
  newHtml?: string;
  /** Sólo para `attrs`. `value: null` QUITA el atributo. */
  attrs?: OpAttr[];
  /** Sólo para `text`. La cadena vacía es legítima («déjalo sin texto»). */
  text?: string;
}

export interface OpParseResult {
  ops: Op[];
  /** Parser-level problems (malformed XML, unknown op types, missing
   *  attributes). These short-circuit applyOps. */
  errors: string[];
}

/**
 * `<edit .../>` → `<edit ...></edit>`, ANTES de que el parser lo vea.
 *
 * MEDIDO el 2026-08-25 con el parser real. El crate hace DOS pasadas con dos
 * expresiones regulares, y la de la forma abierta —`<edit\b([^>]*)>(.*?)</edit>`—
 * casa también la auto-cerrada, porque `/` no es `>` y entra en `[^>]*`. Con
 * esta entrada:
 *
 *     <edit op="delete" target="a"/><edit op="replace" target="b"><p>x</p></edit>
 *
 * salen DOS `delete:a` y el `replace:b` DESAPARECE — se lo traga como si fuera
 * el contenido del primero. Y `errors` vuelve VACÍO, así que nadie se entera:
 * «quítame el carrito y pon el título en rojo» borra el carrito dos veces y el
 * título se queda como estaba, sin un solo aviso.
 *
 * Se volvió alcanzable el 25/08 al aceptar `op="delete"` sobre `runtime`
 * (hallazgo 3): el prompt enseña la forma auto-cerrada y el modelo la usa.
 *
 * Normalizar aquí lo arregla ENTERO y de paso arregla el ORDEN: con una sola
 * forma, el crate hace una sola pasada y las ops salen en el orden en que el
 * modelo las escribió. Antes las auto-cerradas salían TODAS primero, mientras el
 * prompt promete «applied in emission order».
 *
 * LA RAÍZ YA ESTÁ ARREGLADA (2026-08-25): `crates/html-engine/src/ops/parse.rs`
 * pasó de dos expresiones que se solapaban a UNA con alternancia, y lo sujetan
 * cuatro pruebas en `crates/html-engine/tests/ops_parse.rs`. **Esto no sobra
 * todavía**: el binding `.node` que corre hoy se compiló ANTES de ese arreglo, y
 * seguirá corriendo hasta el siguiente despliegue que reconstruya los crates. La
 * línea que borre esta normalización tiene que venir DESPUÉS de comprobar que el
 * binario en producción es el nuevo — quitarla antes reabre el defecto y la
 * consola sigue limpia, que es lo que lo hizo invisible la primera vez.
 */
export function normalizarEditsAutoCerrados(rawHtml: string): string {
  return rawHtml.replace(/<edit\b([^>]*?)\s*\/>/gi, "<edit$1></edit>");
}

/** Parse the `<edits>...</edits>` envelope the model emits in ops mode.
 *  Tolerant to surrounding whitespace + markdown fences (already stripped
 *  by caller). Returns ops in emission order. */
export function parseOps(rawHtml: string): OpParseResult {
  const r = rustParseOps(normalizarEditsAutoCerrados(rawHtml));
  return {
    // Rust's `Op.type` is `string`; the parser only emits validated
    // op types, so the cast is safe.
    ops: r.ops.map((op) => ({
      type: op.type as OpType,
      target: op.target,
      newHtml: op.newHtml,
    })),
    errors: r.errors,
  };
}

export interface OpApplyError {
  opIndex: number;
  op: OpType;
  target: string;
  reason: string;
}

export interface OpApplyResult {
  /** Final HTML after all ops applied + IDs stripped. Null on any failure. */
  html: string | null;
  errors: OpApplyError[];
  appliedCount: number;
}

/** Apply ops in emission order against a tagged HTML document. Validate all
 *  target IDs against the ORIGINAL document first (no partial-apply) — if
 *  any target is missing, bail. Successful run returns the spliced doc with
 *  IDs stripped. */
/** Las ops que no pueden aplicarse sin destruir el documento.
 *
 *  Medido: pidiendo "cambia el titular y pon el acento en verde", el modelo
 *  emite el `replace` correcto del <h1> y luego, para tocar `:root`, apunta al
 *  <body> y lo reemplaza por una etiqueta <style>. Dos de cada cinco veces se
 *  llevaba la página entera por delante — 13,788 chars a 9,524 — sin una sola
 *  op `delete` y sin ningún error.
 *
 *  Reescribir el documento entero es el Modo B, no una op. Las demás ops de la
 *  misma tanda sí se aplican: el usuario pidió dos cosas y perder una es mucho
 *  menos malo que perder su página. Quien llama TIENE que avisar de lo que se
 *  descartó — perderlo en silencio es la degradación que este repo prohíbe.
 *
 *  🔴 EL RECHAZO VIVE EN EL CRATE desde el 2026-09-01, y por una razón medida.
 *  Aquí se hacía con este patrón:
 *
 *      /<(?:html|body)\b[^>]*\sdata-op-id="([^"]+)"/gi
 *
 *  y ese `[^>]*` no puede cruzar un `>`. Un `<body class="[&>*]:mt-4">` —una
 *  variante arbitraria de Tailwind, que es lo que escribe un modelo cuando
 *  quiere «los hijos directos»— no casaba: `roots` salía VACÍA, la guarda se
 *  daba por buena y el `replace` contra el documento entero pasaba de largo,
 *  que es exactamente lo que esta función existe para impedir. La pregunta
 *  «¿este op-id es la raíz?» es sobre la ESTRUCTURA, y sólo la contesta bien
 *  un parser.
 *
 *  La forma de la respuesta no cambia: la partición sigue siendo suya y quien
 *  llama sigue teniendo que avisar de lo descartado. */
export function rejectDocumentWideOps(
  taggedHtml: string,
  ops: readonly Op[],
): { ops: Op[]; rejected: Op[] } {
  const r = rustRejectDocumentWideOps(taggedHtml, ops as readonly EngineOp[]);
  return { ops: r.ops as Op[], rejected: r.rejected as Op[] };
}

/** LO QUE NO SE HA VISTO NO SE DESTRUYE.
 *
 *  Cuando la página no cabe en un turno, el modelo entra con SÓLO EL ÍNDICE
 *  (`buildOutline`): una línea por sección, sin un byte de su contenido. El
 *  prompt le decía que esos op-id servían «para insertar antes o después de una
 *  sección, borrarla o reemplazarla entera», y el único freno era una frase
 *  pidiéndole que no inventara.
 *
 *  🔴 POR QUÉ ESO NO BASTA. El índice lista los hijos DIRECTOS de `<body>`, y
 *  el patrón más común de página generada por IA lo envuelve todo en un
 *  `<div id="page">`. En esas páginas el índice entero es UNA LÍNEA — y esa
 *  línea es la página completa. `rejectDocumentWideOps` no la para, porque no
 *  es ni `<html>` ni `<body>`. Un `replace` contra ella sustituye la página del
 *  usuario por lo que el modelo se imagine que había dentro, sin haber leído
 *  nada. Y esta ruta sólo se activa en las páginas MÁS GRANDES, que son justo
 *  las más caras de reconstruir.
 *
 *  Lo que se ejecuta aquí es la MISMA regla que el prompt ya pedía, pero como
 *  invariante en vez de como ruego: `replace` y `delete` sólo valen contra un
 *  op-id que el modelo HAYA VISTO este turno — porque abrió esa sección con
 *  `leer_estado op_id=` o porque pidió el documento entero. `insert_before` e
 *  `insert_after` siguen libres: no destruyen nada, y son lo que hace útil al
 *  índice.
 *
 *  Fuera del plano B no corre: quien tiene el documento delante no edita a
 *  ciegas. Y quien llama TIENE que avisar de lo descartado — perderlo en
 *  silencio es la degradación que este repo prohíbe. */
export function rejectBlindOps(
  ops: readonly Op[],
  idsVistos: ReadonlySet<string>,
): { ops: Op[]; rejected: Op[] } {
  const kept: Op[] = [];
  const rejected: Op[] = [];
  for (const op of ops) {
    const destruye = op.type === "replace" || op.type === "delete";
    (destruye && !idsVistos.has(op.target) ? rejected : kept).push(op);
  }
  return { ops: kept, rejected };
}

/**
 * Aplica la tanda. Por defecto devuelve el documento SIN `data-op-id`.
 *
 * `keepOpIds` los conserva en lo que no se tocó, y es lo que hace que las
 * direcciones que el modelo ya tiene sigan valiendo después de editar — sin
 * eso hay que re-etiquetar desde cero, la numeración se desplaza, y el modelo
 * tiene que pedir el documento otra vez tras CADA edición.
 *
 * ⚠️ Lo que sale con `keepOpIds` NO se persiste: es la copia de trabajo de una
 * sesión. El embudo de escritura (`persistHtmlChange`) limpia los ids, y ahí
 * está la garantía — no aquí.
 */
export function applyOps(taggedHtml: string, ops: Op[], keepOpIds = false): OpApplyResult {
  const r = rustApplyOps(taggedHtml, ops, keepOpIds);
  return {
    html: r.html,
    errors: r.errors.map((e) => ({
      opIndex: e.opIndex,
      op: e.op as OpType,
      target: e.target,
      reason: e.reason,
    })),
    appliedCount: r.appliedCount,
  };
}
