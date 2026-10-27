// The «@» entries of one page, from its SOURCE (spec local 2026-10-27, §6.2).
//
// The input is the page file tagged by `etiquetarConPosiciones` (every element
// carries `data-op-id="L<line>C<col>"`), parsed by the browser's own parser —
// the one the canvas uses — so `buildEditPath` gives the same path the canvas
// gives when the user clicks that element. Client-safe.

import { buildEditPath } from "@/components/workspace-v2/edit-path";
import { posicionDeId } from "@/lib/agent/ficheros/posiciones";

import { humanNameOf, kindOf } from "./naming";
import type { MentionAttrs, MentionEntry } from "./types";

const SKIPPED = new Set(["script", "style", "template", "noscript", "link", "meta"]);
const TEXT_MAX = 120;
const TARGET_TEXT_MAX = 40;

function ownTextOf(el: Element): string {
  let out = "";
  for (const n of Array.from(el.childNodes)) if (n.nodeType === 3) out += ` ${n.textContent ?? ""}`;
  return out.replace(/\s+/g, " ").trim();
}

function attrsOf(el: Element): MentionAttrs {
  const pick = (name: string) => el.getAttribute(name) ?? undefined;
  const attrs: MentionAttrs = {};
  const id = pick("id");
  const className = pick("class");
  const alt = pick("alt");
  const ariaLabel = pick("aria-label");
  const title = pick("title");
  const placeholder = pick("placeholder");
  if (id) attrs.id = id;
  if (className) attrs.className = className;
  if (alt) attrs.alt = alt;
  if (ariaLabel) attrs.ariaLabel = ariaLabel;
  if (title) attrs.title = title;
  if (placeholder) attrs.placeholder = placeholder;
  return attrs;
}

function firstHeadingOf(el: Element): string | undefined {
  const h = el.querySelector("h1, h2, h3, h4, h5, h6");
  return h?.textContent?.replace(/\s+/g, " ").trim() || undefined;
}

export function buildPageEntries(
  tagged: string,
  page: string | null,
  ruta: string,
  parse: (html: string) => Document,
): MentionEntry[] {
  const doc = parse(tagged);
  const entries: MentionEntry[] = [];

  const visit = (el: Element, parentKey: string | null) => {
    const tag = el.tagName.toLowerCase();
    if (SKIPPED.has(tag)) return;
    const pos = posicionDeId(el.getAttribute("data-op-id") ?? "");
    let ownKey = parentKey;
    if (pos) {
      const key = `${ruta}:${pos.linea}:${pos.columna}`;
      const ownText = ownTextOf(el);
      const attrs = attrsOf(el);
      const elementChildren = Array.from(el.children).filter((c) => !SKIPPED.has(c.tagName.toLowerCase()));
      const target = {
        type: "page" as const,
        page,
        path: buildEditPath(el),
        tag,
        ...(ownText ? { text: ownText.slice(0, TARGET_TEXT_MAX) } : {}),
      };
      entries.push({
        key,
        ruta,
        line: pos.linea,
        tag,
        kind: kindOf(tag, attrs, el.getAttribute("role")),
        name: humanNameOf({
          tag,
          ownText,
          attrs,
          ...(kindOf(tag, attrs) === "section" ? { firstHeadingText: firstHeadingOf(el) } : {}),
        }),
        text: ownText.slice(0, TEXT_MAX),
        attrs,
        component: null,
        parent: parentKey,
        collapsed: (tag === "div" || tag === "span") && !ownText && !attrs.id && elementChildren.length === 1,
        target,
      });
      ownKey = key;
    }
    // An svg is one thing to point at: its paths are not listed.
    if (tag === "svg") return;
    for (const child of Array.from(el.children)) visit(child, ownKey);
  };

  for (const child of Array.from(doc.body?.children ?? [])) visit(child, null);
  return entries;
}
