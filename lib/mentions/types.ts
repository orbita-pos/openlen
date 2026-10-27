// What the chat's «@» points at (spec local 2026-10-27-at-mentions): one index
// of everything that can be mentioned, built from the SOURCE files — page HTML
// or an app's /src — never from what happens to be on screen. Client-safe: no
// node imports.

/** Same cap as the Design mode's elements (`DESIGN_LIMITS.elements`). */
export const MAX_MENTIONS = 20;

export type MentionKind =
  | "section"
  | "heading"
  | "text"
  | "button"
  | "link"
  | "image"
  | "form"
  | "input"
  | "list"
  | "media"
  | "embed"
  | "element";

export interface MentionAttrs {
  id?: string;
  className?: string;
  alt?: string;
  ariaLabel?: string;
  title?: string;
  placeholder?: string;
}

// `text` = the first 40 characters of the element's own text: the canvas checks
// it before outlining, and the server re-anchors by it.
/** A page element, named the way the canvas names it (`buildEditPath`). */
export interface PageTarget {
  type: "page";
  page: string | null;
  path: string;
  tag: string;
  text?: string;
}

/** An app element, by the source line the compiler stamps on it. */
export interface AppTarget {
  type: "app";
  /** "/src/X.tsx" */
  path: string;
  line: number;
  tag: string;
  text?: string;
}

export interface MentionEntry {
  /** Stable within one index. */
  key: string;
  /** The file the element lives in. */
  ruta: string;
  /** 1-based start line, as Read shows it. */
  line: number;
  /** Lowercase HTML tag, or the JSX tag as written ("Button", "motion.div"). */
  tag: string;
  kind: MentionKind;
  name: string;
  /** Own visible text, whitespace collapsed, at most 120 characters. */
  text: string;
  attrs: MentionAttrs;
  /** Apps: the line its JSX element closes on. */
  endLine?: number;
  /** Apps: the component the element is written in. */
  component: string | null;
  parent: string | null;
  /** A wrapper with nothing of its own: hidden in the tree, still searchable. */
  collapsed: boolean;
  target: PageTarget | AppTarget;
}

export type MentionRef =
  | { type: "element"; label: string; target: PageTarget | AppTarget; text: string }
  | { type: "file"; label: string; ruta: string };

export type MentionIndexResponse =
  | { kind: "page"; hash: string; files: string[]; pages: { page: string | null; ruta: string; tagged: string }[] }
  | { kind: "app"; hash: string; files: string[]; entries: MentionEntry[] };

/** A click on the canvas that became a mention, on its way to the chat's draft.
 *  `labelInDraft`: the label is already in a draft the workshop proposes. */
export interface IncomingMention {
  ref: MentionRef;
  id: number;
  labelInDraft?: boolean;
}
