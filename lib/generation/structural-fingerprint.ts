import { createHash } from "node:crypto";
import { parse, valid, type HTMLElement, NodeType, type Node } from "node-html-parser";
import { CREATIVE_TOKEN_ALLOWLIST } from "@/lib/generation/creative-registry";

export interface StructuralFingerprintOptions {
  allowedAssetSlots?: readonly number[];
}

export class StructuralFingerprintError extends Error {
  constructor(
    public readonly code: "invalid_html" | "incomplete_structure",
    message: string,
  ) {
    super(message);
    this.name = "StructuralFingerprintError";
  }
}

const ROOT_TAGS = new Set(["html", "body"]);
// theme-apply deterministically derives this visual-only carrier whenever the
// approved accent token changes. It is not model-addressable and therefore
// intentionally remains outside CREATIVE_TOKEN_ALLOWLIST.
const INTERNAL_DERIVED_ROOT_TOKENS = new Set(["--ol-accent-r"]);
const MAX_ROOT_STYLE_LENGTH = 4_096;
const MAX_ROOT_STYLE_DECLARATIONS = 64;

function tagName(element: HTMLElement): string {
  return element.rawTagName?.toLowerCase() ?? "";
}

function hasDataOlAttribute(element: HTMLElement): boolean {
  return Object.keys(element.attributes).some((name) => name.toLowerCase().startsWith("data-ol-"));
}

function hasDataUri(value: string | undefined): boolean {
  return /data\s*:/i.test(value ?? "");
}

function isLogoElement(element: HTMLElement): boolean {
  for (let current: HTMLElement | null = element; current; current = current.parentNode) {
    const identity = [
      current.getAttribute("id"),
      current.getAttribute("class"),
      current.getAttribute("alt"),
      current.getAttribute("src"),
    ].filter(Boolean).join(" ");
    if (/logo/i.test(identity)) return true;
  }
  return false;
}

function isWithinExcludedRegion(element: HTMLElement): boolean {
  for (let current: HTMLElement | null = element; current; current = current.parentNode) {
    if (["nav", "header", "footer"].includes(tagName(current))) return true;
  }
  return false;
}

/** Content image candidates are shared by inventory creation and asset-slot fingerprinting. */
export function replaceableContentImages(root: HTMLElement): HTMLElement[] {
  return root.querySelectorAll("img").filter((image) => {
    const source = image.getAttribute("src")?.trim();
    const srcset = image.getAttribute("srcset");
    const alt = image.getAttribute("alt")?.trim();
    return Boolean(source)
      && !hasDataUri(source)
      && !hasDataUri(srcset)
      && Boolean(alt)
      && !hasDataOlAttribute(image)
      && !isWithinExcludedRegion(image)
      && !isLogoElement(image);
  });
}

function splitCssDeclarations(style: string): string[] | null {
  if (style.length > MAX_ROOT_STYLE_LENGTH) return null;
  const declarations: string[] = [];
  let start = 0;
  let quote = "";
  let parenDepth = 0;
  let escaped = false;
  for (let index = 0; index < style.length; index += 1) {
    const character = style[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = "";
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === "(") parenDepth += 1;
    if (character === ")") {
      parenDepth -= 1;
      if (parenDepth < 0) return null;
    }
    if (character === ";" && parenDepth === 0) {
      declarations.push(style.slice(start, index));
      start = index + 1;
      if (declarations.length > MAX_ROOT_STYLE_DECLARATIONS) return null;
    }
  }
  if (quote || parenDepth !== 0) return null;
  declarations.push(style.slice(start));
  return declarations.length <= MAX_ROOT_STYLE_DECLARATIONS ? declarations : null;
}

function declarationColon(declaration: string): number | null {
  let quote = "";
  let parenDepth = 0;
  let escaped = false;
  for (let index = 0; index < declaration.length; index += 1) {
    const character = declaration[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = "";
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === "(") parenDepth += 1;
    if (character === ")") parenDepth -= 1;
    if (character === ":" && parenDepth === 0) return index;
  }
  return null;
}

function normalizeCssValue(value: string): string {
  let normalized = "";
  let quote = "";
  let escaped = false;
  let previousWhitespace = false;
  for (const character of value.trim()) {
    if (escaped) {
      normalized += character;
      escaped = false;
      previousWhitespace = false;
      continue;
    }
    if (character === "\\") {
      normalized += character;
      escaped = true;
      previousWhitespace = false;
      continue;
    }
    if (quote) {
      normalized += character;
      if (character === quote) quote = "";
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      normalized += character;
      previousWhitespace = false;
      continue;
    }
    if (/\s/.test(character)) {
      if (!previousWhitespace) normalized += " ";
      previousWhitespace = true;
      continue;
    }
    normalized += character;
    previousWhitespace = false;
  }
  return normalized.trim();
}

function canonicalRootStyle(style: string): Array<[string, string]> {
  const declarations = splitCssDeclarations(style);
  if (!declarations) return [["__unparsed_style__", style]];

  const nonApproved: Array<[string, string]> = [];
  for (const declaration of declarations) {
    if (!declaration.trim()) continue;
    const colon = declarationColon(declaration);
    if (colon === null) return [["__unparsed_style__", style]];
    const rawProperty = declaration.slice(0, colon).trim();
    const property = rawProperty.toLowerCase();
    if (!rawProperty) return [["__unparsed_style__", style]];
    if (!CREATIVE_TOKEN_ALLOWLIST.has(property) && !INTERNAL_DERIVED_ROOT_TOKENS.has(rawProperty)) {
      nonApproved.push([property, normalizeCssValue(declaration.slice(colon + 1))]);
    }
  }
  return nonApproved;
}

function canonicalAttributes(element: HTMLElement, exemptAssetSlots: ReadonlySet<number>, assetSlots: Map<HTMLElement, number>): Array<[string, string]> {
  const slotIndex = assetSlots.get(element);
  const attributes: Array<[string, string]> = [];
  for (const [rawName, value] of Object.entries(element.attributes)) {
    const name = rawName.toLowerCase();
    if (slotIndex !== undefined && exemptAssetSlots.has(slotIndex) && ["src", "srcset", "alt"].includes(name)) continue;
    if (name === "style" && ROOT_TAGS.has(tagName(element))) {
      const style = canonicalRootStyle(value);
      if (style.length === 0) continue;
      attributes.push([name, JSON.stringify(style)]);
      continue;
    }
    attributes.push([name, value]);
  }
  return attributes.sort(([left], [right]) => left.localeCompare(right));
}

function canonicalNode(node: Node, exemptAssetSlots: ReadonlySet<number>, assetSlots: Map<HTMLElement, number>, ignoredVisualEngineStyle: HTMLElement | null): unknown | null {
  if (node.nodeType !== NodeType.ELEMENT_NODE) return null;

  const element = node as HTMLElement;
  if (element === ignoredVisualEngineStyle) return null;

  const name = tagName(element);
  const children = element.childNodes
    .map((child) => canonicalNode(child, exemptAssetSlots, assetSlots, ignoredVisualEngineStyle))
    .filter((child): child is NonNullable<typeof child> => child !== null);
  const canonical: Record<string, unknown> = {
    tag: name,
    attributes: canonicalAttributes(element, exemptAssetSlots, assetSlots),
    children,
  };
  if (name === "script") canonical.scriptText = element.rawText;
  if (name === "style") canonical.styleText = element.rawText;
  return canonical;
}

function parseCompleteDocument(html: string): HTMLElement {
  if (!valid(html)) throw new StructuralFingerprintError("invalid_html", "Structural fingerprints require well-formed HTML");
  const root = parse(html);
  if (!root.querySelector("html") || !root.querySelector("body")) {
    throw new StructuralFingerprintError("incomplete_structure", "Structural fingerprints require html and body elements");
  }
  return root;
}

export function fingerprintStructure(
  html: string,
  options: StructuralFingerprintOptions = {},
): string {
  const root = parseCompleteDocument(html);
  const assetSlots = new Map(replaceableContentImages(root).map((image, slotIndex) => [image, slotIndex]));
  const visualEngineStyles = root.querySelectorAll("style[data-openlen-visual-engine]");
  const ignoredVisualEngineStyle = visualEngineStyles.length === 1 ? visualEngineStyles[0] : null;
  const exemptAssetSlots = new Set(options.allowedAssetSlots);
  const tree = root.childNodes
    .map((child) => canonicalNode(child, exemptAssetSlots, assetSlots, ignoredVisualEngineStyle))
    .filter((child): child is NonNullable<typeof child> => child !== null);
  const canonicalTree = JSON.stringify(tree);

  return `sha256:${createHash("sha256").update(canonicalTree).digest("hex")}`;
}

export function structureIsPreserved(
  before: string,
  after: string,
  options: StructuralFingerprintOptions = {},
): boolean {
  try {
    return fingerprintStructure(before, options) === fingerprintStructure(after, options);
  } catch (error) {
    if (error instanceof StructuralFingerprintError) return false;
    throw error;
  }
}
