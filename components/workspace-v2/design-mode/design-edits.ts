// LOS CAMBIOS PENDIENTES DEL MODO DISEÑO: lo que el dueño tocó en el panel y
// todavía no mandó a Len. Puro: el taller lo guarda con useReducer, y de aquí
// salen la vista previa del lienzo y el `design` del turno.
import {
  DESIGN_LIMITS,
  type DesignChange,
  type DesignRequest,
  type DesignSelection,
  type EditableField,
} from "@/lib/apps/design/types";

export interface PendingElement {
  readonly selection: DesignSelection;
  readonly values: Readonly<Partial<Record<EditableField, string>>>;
  readonly photo: { readonly url: string; readonly alt?: string } | null;
  readonly note: string;
}
type Snapshot = { readonly elements: Readonly<Record<string, PendingElement>>; readonly order: readonly string[] };
export interface DesignEditsState extends Snapshot {
  readonly past: readonly Snapshot[];
  readonly future: readonly Snapshot[];
}
export type DesignEditsAction =
  | { type: "select"; selection: DesignSelection }
  | { type: "set"; key: string; field: EditableField; value: string }
  | { type: "photo"; key: string; photo: { url: string; alt?: string } | null }
  | { type: "note"; key: string; note: string }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "resetElement"; key: string }
  | { type: "resetAll" }
  /** Otro proyecto: todo fuera, también el historial (deshacer no puede traer cambios de otra app). */
  | { type: "clear" };

export const EMPTY_DESIGN_EDITS: DesignEditsState = { elements: {}, order: [], past: [], future: [] };
const HISTORIA = 100;

function antesDe(sel: DesignSelection, field: EditableField): string {
  if (field === "text") return sel.text;
  if (field === "alt") return sel.image?.alt ?? "";
  return sel.styles[field] ?? "";
}

function conHistoria(s: DesignEditsState, next: Snapshot): DesignEditsState {
  return { ...next, past: [...s.past, { elements: s.elements, order: s.order }].slice(-HISTORIA), future: [] };
}

export function designEditsReducer(s: DesignEditsState, a: DesignEditsAction): DesignEditsState {
  switch (a.type) {
    case "select": {
      if (s.elements[a.selection.key]) return s;
      const el: PendingElement = { selection: a.selection, values: {}, photo: null, note: "" };
      return { ...s, elements: { ...s.elements, [a.selection.key]: el }, order: [...s.order, a.selection.key] };
    }
    case "set":
    case "photo":
    case "note": {
      const el = s.elements[a.key];
      if (!el) return s;
      const nuevo: PendingElement =
        a.type === "set"
          ? { ...el, values: { ...el.values, [a.field]: a.value } }
          : a.type === "photo"
            ? { ...el, photo: a.photo }
            : { ...el, note: a.note };
      return conHistoria(s, { elements: { ...s.elements, [a.key]: nuevo }, order: s.order });
    }
    case "undo": {
      const prev = s.past[s.past.length - 1];
      if (!prev) return s;
      return { ...prev, past: s.past.slice(0, -1), future: [{ elements: s.elements, order: s.order }, ...s.future] };
    }
    case "redo": {
      const [next, ...rest] = s.future;
      if (!next) return s;
      return { ...next, past: [...s.past, { elements: s.elements, order: s.order }], future: rest };
    }
    case "resetElement": {
      const el = s.elements[a.key];
      if (!el) return s;
      return conHistoria(s, { elements: { ...s.elements, [a.key]: { ...el, values: {}, photo: null, note: "" } }, order: s.order });
    }
    case "resetAll":
      return s.order.length === 0 ? s : conHistoria(s, { elements: {}, order: [] });
    case "clear":
      return EMPTY_DESIGN_EDITS;
  }
}

export function changesOf(el: PendingElement): DesignChange[] {
  const out: DesignChange[] = [];
  for (const [field, after] of Object.entries(el.values) as [EditableField, string][]) {
    const before = antesDe(el.selection, field);
    if (after !== before) out.push({ property: field, before, after });
  }
  return out;
}

function tieneAlgo(el: PendingElement): boolean {
  return changesOf(el).length > 0 || el.photo !== null || el.note.trim() !== "";
}

export function pendingCount(s: DesignEditsState): number {
  return s.order.filter((k) => s.elements[k] && tieneAlgo(s.elements[k]!)).length;
}

export function toDesignRequest(s: DesignEditsState, note: string): { request: DesignRequest | null; tooBig: boolean } {
  const elements = s.order
    .map((k) => s.elements[k])
    .filter((el): el is PendingElement => !!el && tieneAlgo(el))
    .slice(0, DESIGN_LIMITS.elements)
    .map((el) => ({
      chain: el.selection.chain,
      primary: el.selection.primary,
      tag: el.selection.tag,
      text: el.selection.text,
      copies: el.selection.copies,
      screen: el.selection.screen,
      changes: changesOf(el),
      ...(el.photo ? { photo: el.photo } : {}),
      ...(el.note.trim() ? { note: el.note.trim().slice(0, DESIGN_LIMITS.note) } : {}),
    }));
  const nota = note.trim().slice(0, DESIGN_LIMITS.note);
  if (elements.length === 0 && !nota) return { request: null, tooBig: false };
  const request: DesignRequest = { elements, ...(nota ? { note: nota } : {}) };
  return { request, tooBig: JSON.stringify(request).length > DESIGN_LIMITS.bytes };
}

export type PreviewMessage =
  | {
      type: "openlen:design-preview";
      key: string;
      screen: string;
      target: { path: string; line: number; tag: string; site?: string } | { designId: string };
      styles: Record<string, string>;
      text?: string;
      src?: string;
      alt?: string;
    }
  | { type: "openlen:design-clear"; key: string };

function mensajeDe(key: string, el: PendingElement): PreviewMessage | null {
  const sel = el.selection;
  const link = sel.primary >= 0 ? sel.chain[sel.primary] : undefined;
  const target = link
    ? { path: link.path, line: link.line, tag: sel.tag, ...(link.site ? { site: link.site } : {}) }
    : sel.designId
      ? { designId: sel.designId }
      : null;
  if (!target) return null;
  const styles: Record<string, string> = {};
  let text: string | undefined;
  let alt: string | undefined;
  for (const c of changesOf(el)) {
    if (c.property === "text") text = c.after;
    else if (c.property === "alt") alt = c.after;
    else styles[c.property] = c.after;
  }
  return {
    type: "openlen:design-preview",
    key,
    screen: sel.screen,
    target,
    styles,
    ...(text !== undefined ? { text } : {}),
    ...(el.photo ? { src: el.photo.url } : {}),
    ...(alt !== undefined ? { alt } : {}),
  };
}

export function previewMessagesOf(prev: DesignEditsState, next: DesignEditsState): PreviewMessage[] {
  const out: PreviewMessage[] = [];
  const claves = new Set([...prev.order, ...next.order]);
  for (const key of claves) {
    const a = prev.elements[key];
    const b = next.elements[key];
    if (a === b) continue;
    const tenia = !!a && tieneAlgo(a);
    if (!b || !tieneAlgo(b)) {
      if (tenia) out.push({ type: "openlen:design-clear", key });
      continue;
    }
    const m = mensajeDe(key, b);
    if (m) out.push(m);
  }
  return out;
}

/** El mensaje que «Aplicar» deja en el chat (y que es el `prompt` del turno): el
 *  título con su plural y una línea por elemento con sus cambios. */
export function designSummary(
  request: DesignRequest,
  t: (key: string, values?: Record<string, string | number>) => string,
): string {
  const lineas = request.elements.map((el) => {
    const cambios = el.changes.map((c) => `${t(`designMode.prop.${c.property}`)} ${c.before || "—"} → ${c.after}`);
    if (el.photo) cambios.push(t("designMode.photo"));
    return `- <${el.tag}>${el.text ? ` «${el.text}»` : ""}: ${cambios.join("; ")}`;
  });
  return [t("designMode.applyMessage", { n: request.elements.length }), ...lineas, ...(request.note ? [request.note] : [])].join("\n");
}
