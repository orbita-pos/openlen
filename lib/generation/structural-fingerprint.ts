import { createHash } from "node:crypto";
import { parse, type HTMLElement, NodeType, type Node } from "node-html-parser";
import { CREATIVE_TOKEN_ALLOWLIST } from "@/lib/generation/creative-registry";

export interface StructuralFingerprintOptions {
  allowedAssetSlots?: readonly number[];
}

const ROOT_TAGS = new Set(["html", "body"]);

function tagName(element: HTMLElement): string {
  return element.rawTagName?.toLowerCase() ?? "";
}

function hasDataOlAttribute(element: HTMLElement): boolean {
  return Object.keys(element.attributes).some((name) => name.toLowerCase().startsWith("data-ol-"));
}

function isLogoElement(element: HTMLElement): boolean {
  for (let current: HTMLElement | null = element; current; current = current.parentNode) {
    const identity = `${current.getAttribute("id") ?? ""} ${current.getAttribute("class") ?? ""}`;
    if (/(?:^|[\s_-])logo(?:[\s_-]|$)/i.test(identity)) return true;
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
    const alt = image.getAttribute("alt")?.trim();
    return Boolean(source)
      && !source!.toLowerCase().startsWith("data:")
      && Boolean(alt)
      && !hasDataOlAttribute(image)
      && !isWithinExcludedRegion(image)
      && !isLogoElement(image);
  });
}

function stripApprovedRootTokens(style: string): string {
  return style
    .split(";")
    .filter((declaration) => {
      const property = declaration.slice(0, declaration.indexOf(":")).trim();
      return !CREATIVE_TOKEN_ALLOWLIST.has(property);
    })
    .join(";");
}

function canonicalAttributes(element: HTMLElement, exemptAssetSlots: ReadonlySet<number>, assetSlots: Map<HTMLElement, number>): Array<[string, string]> {
  const slotIndex = assetSlots.get(element);
  return Object.entries(element.attributes)
    .map(([name, value]) => [name.toLowerCase(), value] as [string, string])
    .filter(([name]) => !(slotIndex !== undefined && exemptAssetSlots.has(slotIndex) && ["src", "srcset", "alt"].includes(name)))
    .map(([name, value]) => [name, name === "style" && ROOT_TAGS.has(tagName(element)) ? stripApprovedRootTokens(value) : value] as [string, string])
    .sort(([left], [right]) => left.localeCompare(right));
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
  return canonical;
}

export function fingerprintStructure(
  html: string,
  options: StructuralFingerprintOptions = {},
): string {
  const root = parse(html);
  const assetSlots = new Map(replaceableContentImages(root).map((image, slotIndex) => [image, slotIndex]));
  const visualEngineStyles = root.querySelectorAll("style[data-openlen-visual-engine]");
  const ignoredVisualEngineStyle = visualEngineStyles.length === 1 ? visualEngineStyles[0] : null;
  const tree = root.childNodes
    .map((child) => canonicalNode(child, new Set(options.allowedAssetSlots), assetSlots, ignoredVisualEngineStyle))
    .filter((child): child is NonNullable<typeof child> => child !== null);
  const canonicalTree = JSON.stringify(tree);

  return `sha256:${createHash("sha256").update(canonicalTree).digest("hex")}`;
}

export function structureIsPreserved(
  before: string,
  after: string,
  options: StructuralFingerprintOptions = {},
): boolean {
  return fingerprintStructure(before, options) === fingerprintStructure(after, options);
}
