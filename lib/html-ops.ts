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
  buildScopedView as rustBuildScopedView,
  parseOps as rustParseOps,
  resolveOpIdByPath as rustResolveOpIdByPath,
  stripOpIds as rustStripOpIds,
  tagWithOpIds as rustTagWithOpIds,
  type ScopedView as RustScopedView,
} from "@/lib/html-engine";

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

/** Strip `data-op-id` attributes from the HTML. Always called before
 *  persisting / publishing so the IDs never leak to disk or to the user's
 *  subdomain. */
export function stripOpIds(html: string): string {
  return rustStripOpIds(html);
}

export type OpType =
  | "replace"
  | "insert_before"
  | "insert_after"
  | "delete";

export interface Op {
  type: OpType;
  target: string;
  /** New HTML for replace / insert_*; ignored for delete. */
  newHtml?: string;
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
 * modelo las escribió. Antes las auto-cerradas salían TODAS primero —el propio
 * comentario del crate lo dice— mientras el prompt promete «applied in emission
 * order». La raíz está en `crates/html-engine/src/ops/parse.rs:15`; arreglarla
 * ahí pide recompilar el binding nativo, y esto no espera a eso.
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
 *  descartó — perderlo en silencio es la degradación que este repo prohíbe. */
export function rejectDocumentWideOps(
  taggedHtml: string,
  ops: readonly Op[],
): { ops: Op[]; rejected: Op[] } {
  const roots = new Set<string>();
  for (const match of taggedHtml.matchAll(/<(?:html|body)\b[^>]*\sdata-op-id="([^"]+)"/gi)) {
    roots.add(match[1]!);
  }
  if (roots.size === 0) return { ops: [...ops], rejected: [] };
  const kept: Op[] = [];
  const rejected: Op[] = [];
  for (const op of ops) (roots.has(op.target) ? rejected : kept).push(op);
  return { ops: kept, rejected };
}

export function applyOps(taggedHtml: string, ops: Op[]): OpApplyResult {
  const r = rustApplyOps(taggedHtml, ops);
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
