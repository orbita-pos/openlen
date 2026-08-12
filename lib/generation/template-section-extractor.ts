import { createHash } from "node:crypto";

import type { TemplateCorpusRow } from "./template-section-corpus";

export interface ExtractedTemplateBand {
  templateId: string;
  templateContentHash: string;
  ordinal: number;
  rootTag: "nav" | "header" | "section" | "footer";
  sourceHtml: string;
  sourceHash: string;
  sourceIds: readonly string[];
}

export type ExtractTemplateBandsResult =
  | { ok: true; bands: readonly ExtractedTemplateBand[] }
  | { ok: false; code: "invalid_template_document" | "no_extractable_bands" };

type Namespace = "html" | "svg" | "math";

interface OpenElement {
  name: string;
  namespace: Namespace;
}

interface PendingBand {
  start: number;
  depthBefore: number;
  rootTag: ExtractedTemplateBand["rootTag"];
  sourceIds: string[];
}

const BAND_TAGS = new Set<ExtractedTemplateBand["rootTag"]>([
  "nav", "header", "section", "footer",
]);
const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr",
]);
const RAW_TEXT_TAGS = new Set([
  "script", "style", "textarea", "title", "iframe", "xmp", "noembed", "noframes", "plaintext",
]);
const SVG_HTML_INTEGRATION_POINTS = new Set(["foreignobject", "desc", "title"]);
const MATH_HTML_INTEGRATION_POINTS = new Set(["mi", "mo", "mn", "ms", "mtext"]);

function asciiLower(value: string): string {
  let out = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    out += code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : value[index];
  }
  return out;
}

function asciiIndexOf(source: string, needle: string, from: number): number {
  const loweredNeedle = asciiLower(needle);
  const limit = source.length - needle.length;
  for (let index = from; index <= limit; index += 1) {
    let matches = true;
    for (let offset = 0; offset < needle.length; offset += 1) {
      const code = source.charCodeAt(index + offset);
      const lowered = code >= 65 && code <= 90 ? code + 32 : code;
      if (lowered !== loweredNeedle.charCodeAt(offset)) {
        matches = false;
        break;
      }
    }
    if (matches) return index;
  }
  return -1;
}

function tagEnd(html: string, start: number): number {
  let quote = "";
  for (let index = start; index < html.length; index += 1) {
    const character = html[index];
    if (quote) {
      if (character === quote) quote = "";
    } else if (character === "\"" || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index;
    }
  }
  return -1;
}

function attributeValue(tag: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`\\s${escaped}\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s\"'=<>]+))`, "i").exec(tag);
  return match ? match[1] ?? match[2] ?? match[3] ?? "" : null;
}

function childNamespace(stack: readonly OpenElement[]): Namespace {
  const parent = stack.at(-1);
  if (!parent) return "html";
  if (parent.namespace === "svg" && SVG_HTML_INTEGRATION_POINTS.has(parent.name)) return "html";
  if (parent.namespace === "math" && MATH_HTML_INTEGRATION_POINTS.has(parent.name)) return "html";
  return parent.namespace;
}

function namespaceFor(parent: Namespace, name: string): Namespace {
  if (parent !== "html") return parent;
  if (name === "svg") return "svg";
  if (name === "math") return "math";
  return "html";
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function invalid(): ExtractTemplateBandsResult {
  return { ok: false, code: "invalid_template_document" };
}

export function extractTemplateBands(row: TemplateCorpusRow): ExtractTemplateBandsResult {
  const html = row.html;
  if (!html.trim()) return invalid();

  const stack: OpenElement[] = [];
  const bands: ExtractedTemplateBand[] = [];
  const documentIds = new Set<string>();
  let pending: PendingBand | null = null;
  let index = 0;
  let bodySeen = false;
  let bodyClosed = false;

  while (index < html.length) {
    const raw = stack.at(-1);
    if (raw?.namespace === "html" && RAW_TEXT_TAGS.has(raw.name)) {
      const closingStart = asciiIndexOf(html, `</${raw.name}`, index);
      if (closingStart < 0) return invalid();
      index = closingStart;
    }

    const next = html.indexOf("<", index);
    const textEnd = next < 0 ? html.length : next;
    const text = html.slice(index, textEnd);
    if (bodySeen && !bodyClosed && !pending && stack.at(-1)?.name === "body" && text.trim()) {
      return invalid();
    }
    if (next < 0) break;

    if (html.startsWith("<!--", next)) {
      const end = html.indexOf("-->", next + 4);
      if (end < 0) return invalid();
      index = end + 3;
      continue;
    }
    if (html.startsWith("<!", next) || html.startsWith("<?", next)) {
      const end = tagEnd(html, next + 2);
      if (end < 0 || bodySeen) return invalid();
      index = end + 1;
      continue;
    }

    const end = tagEnd(html, next + 1);
    if (end < 0) return invalid();
    const tag = html.slice(next, end + 1);
    const closing = /^<\/\s*([a-z][a-z0-9:-]*)\s*>$/i.exec(tag);
    if (closing) {
      const name = asciiLower(closing[1]);
      const current = stack.at(-1);
      if (!current || current.name !== name) return invalid();
      stack.pop();
      if (name === "body") bodyClosed = true;
      if (pending && stack.length === pending.depthBefore && name === pending.rootTag) {
        const sourceHtml = html.slice(pending.start, end + 1);
        bands.push(Object.freeze({
          templateId: row.templateId,
          templateContentHash: row.templateContentHash,
          ordinal: bands.length,
          rootTag: pending.rootTag,
          sourceHtml,
          sourceHash: sha256(sourceHtml),
          sourceIds: Object.freeze([...pending.sourceIds]),
        }));
        pending = null;
      }
      index = end + 1;
      continue;
    }

    const opening = /^<\s*([a-z][a-z0-9:-]*)(?:\s|\/?>)/i.exec(tag);
    if (!opening) return invalid();
    const name = asciiLower(opening[1]);
    if (bodySeen && !bodyClosed && (name === "html" || name === "head" || name === "body")) return invalid();
    if (name === "body") {
      if (bodySeen || stack.at(-1)?.name !== "html") return invalid();
      bodySeen = true;
    }

    const id = attributeValue(tag, "id");
    if (bodySeen && id !== null) {
      if (!id || documentIds.has(id)) return invalid();
      documentIds.add(id);
      if (pending) pending.sourceIds.push(id);
    }

    const parentNamespace = childNamespace(stack);
    const namespace = namespaceFor(parentNamespace, name);
    const selfClosing = /\/\s*>$/.test(tag);
    const closesImmediately = VOID_TAGS.has(name) || (namespace !== "html" && selfClosing);
    if (!pending && bodySeen && !bodyClosed && BAND_TAGS.has(name as ExtractedTemplateBand["rootTag"])) {
      pending = {
        start: next,
        depthBefore: stack.length,
        rootTag: name as ExtractedTemplateBand["rootTag"],
        sourceIds: id === null ? [] : [id],
      };
    }
    if (!closesImmediately) stack.push({ name, namespace });
    if (pending && closesImmediately && pending.start === next) {
      const sourceHtml = html.slice(next, end + 1);
      bands.push(Object.freeze({
        templateId: row.templateId,
        templateContentHash: row.templateContentHash,
        ordinal: bands.length,
        rootTag: pending.rootTag,
        sourceHtml,
        sourceHash: sha256(sourceHtml),
        sourceIds: Object.freeze([...pending.sourceIds]),
      }));
      pending = null;
    }
    index = end + 1;
  }

  if (!bodySeen || !bodyClosed || pending || stack.length !== 0) return invalid();
  return bands.length > 0
    ? { ok: true, bands: Object.freeze(bands) }
    : { ok: false, code: "no_extractable_bands" };
}
