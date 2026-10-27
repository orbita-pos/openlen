// How an element is called in the «@» list: what it is (its kind, localized by
// the UI) and a human name taken from its own content, so «Ver el mostrador»
// reads before `a.btn`.

import type { MentionAttrs, MentionKind } from "./types";

const KIND_BY_TAG: Readonly<Record<string, MentionKind>> = {
  section: "section",
  header: "section",
  footer: "section",
  nav: "section",
  main: "section",
  article: "section",
  aside: "section",
  h1: "heading",
  h2: "heading",
  h3: "heading",
  h4: "heading",
  h5: "heading",
  h6: "heading",
  p: "text",
  span: "text",
  blockquote: "text",
  label: "text",
  strong: "text",
  em: "text",
  button: "button",
  a: "link",
  img: "image",
  picture: "image",
  figure: "image",
  form: "form",
  input: "input",
  textarea: "input",
  select: "input",
  ul: "list",
  ol: "list",
  li: "list",
  table: "list",
  video: "media",
  audio: "media",
  canvas: "media",
  svg: "media",
  iframe: "embed",
  embed: "embed",
  object: "embed",
};

const NAME_MAX = 60;

export interface NameInput {
  tag: string;
  ownText: string;
  attrs: MentionAttrs;
  firstHeadingText?: string;
  component?: string | null;
}

export function kindOf(tag: string, _attrs: MentionAttrs, role?: string | null): MentionKind {
  if (role === "button") return "button";
  if (role === "link") return "link";
  return KIND_BY_TAG[tag.toLowerCase()] ?? "element";
}

function clean(text: string | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function cut(text: string): string {
  return text.length > NAME_MAX ? `${text.slice(0, NAME_MAX)}…` : text;
}

export function humanNameOf(input: NameInput): string {
  const { attrs } = input;
  const candidates = [
    input.ownText,
    attrs.alt,
    attrs.ariaLabel,
    attrs.title,
    attrs.placeholder,
    input.firstHeadingText,
    input.component ?? undefined,
  ];
  for (const c of candidates) {
    const t = clean(c);
    if (t) return cut(t);
  }
  const firstClass = clean(attrs.className).split(" ")[0];
  return firstClass ? `${input.tag}.${firstClass}` : input.tag;
}
