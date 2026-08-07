import { parse, valid, type HTMLElement } from "node-html-parser";
import { SkeletonInventorySchema, type SkeletonInventory } from "@/lib/generation/creative-contracts";
import { CREATIVE_TOKEN_ALLOWLIST, HOOK_PROPERTY_POLICY } from "@/lib/generation/creative-registry";
import { fingerprintStructure, replaceableContentImages } from "@/lib/generation/structural-fingerprint";

type SkeletonInventoryErrorCode = "insufficient_style_hooks" | "invalid_html" | "invalid_inventory";
type HookRole = keyof typeof HOOK_PROPERTY_POLICY;

const MAX_STYLE_HOOKS = 12;
const MAX_ASSET_SLOTS = 12;
const SAFE_CLASS_NAME = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;

export class SkeletonInventoryError extends Error {
  constructor(
    public readonly code: SkeletonInventoryErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "SkeletonInventoryError";
  }
}

interface RepeatedCardGroup {
  className: string;
  owner: HTMLElement;
  elements: HTMLElement[];
}

function tagName(element: HTMLElement): string {
  return element.rawTagName?.toLowerCase() ?? "";
}

function hook(id: string, selector: string, role: HookRole): SkeletonInventory["styleHooks"][number] {
  return { id, selector, allowedProperties: [...HOOK_PROPERTY_POLICY[role]] };
}

function nthOfTypeSegment(element: HTMLElement): string {
  const parent = element.parentNode;
  if (!parent) throw new SkeletonInventoryError("invalid_inventory", "Unable to derive a deterministic DOM path");
  const sameTagSiblings = parent.children.filter((sibling) => tagName(sibling) === tagName(element));
  const position = sameTagSiblings.indexOf(element) + 1;
  if (position < 1) throw new SkeletonInventoryError("invalid_inventory", "Unable to derive a deterministic DOM path");
  return `${tagName(element)}:nth-of-type(${position})`;
}

function domPath(element: HTMLElement, body: HTMLElement): string {
  if (element === body) return "body";
  const segments: string[] = [];
  for (let current: HTMLElement | null = element; current && current !== body; current = current.parentNode) {
    segments.unshift(nthOfTypeSegment(current));
  }
  if (segments.length === 0 || element.closest("body") !== body) {
    throw new SkeletonInventoryError("invalid_inventory", "Unable to scope selector to the document body");
  }
  return `body > ${segments.join(" > ")}`;
}

function largestRepeatedSafeClass(root: HTMLElement): RepeatedCardGroup | null {
  const groups = new Map<string, RepeatedCardGroup>();
  for (const element of root.querySelectorAll("[class]")) {
    const owner = element.closest("section");
    if (!owner || owner.closest("body") !== root) continue;
    for (const className of new Set((element.getAttribute("class") ?? "").split(/\s+/).filter((value) => SAFE_CLASS_NAME.test(value)))) {
      const key = `${className}\u0000${domPath(owner, root)}`;
      const group = groups.get(key) ?? { className, owner, elements: [] };
      group.elements.push(element);
      groups.set(key, group);
    }
  }
  return [...groups.values()]
    .filter((group) => group.elements.length >= 2)
    .sort((left, right) => right.elements.length - left.elements.length || left.className.localeCompare(right.className) || domPath(left.owner, root).localeCompare(domPath(right.owner, root)))[0] ?? null;
}

function buttonSelector(root: HTMLElement): string | null {
  const selectors: string[] = [];
  if (root.querySelector("button")) selectors.push("button");
  const anchorClasses = new Set<string>();
  for (const anchor of root.querySelectorAll("a[class]")) {
    for (const className of (anchor.getAttribute("class") ?? "").split(/\s+/)) {
      if (SAFE_CLASS_NAME.test(className)) anchorClasses.add(className);
    }
  }
  for (const className of [...anchorClasses].sort((left, right) => left.localeCompare(right))) selectors.push(`a.${className}`);
  return selectors.length > 0 ? selectors.join(", ") : null;
}

function iconSelector(root: HTMLElement): string | null {
  const selectors: string[] = [];
  if (root.querySelector("svg[data-lucide]")) selectors.push("svg[data-lucide]");
  if (root.querySelector(".icon svg")) selectors.push(".icon svg");
  if (root.querySelectorAll("svg").some((icon) => icon.getAttribute("aria-hidden") === "true")) selectors.push('svg[aria-hidden="true"]');
  return selectors.length > 0 ? selectors.join(", ") : null;
}

function imageRole(image: HTMLElement, sections: readonly HTMLElement[], cardGroup: RepeatedCardGroup | null): "hero" | "section" | "card" {
  if (image.closest("section") === sections[0]) return "hero";
  if (cardGroup && cardGroup.elements.some((card) => image.closest(`.${cardGroup.className}`) === card)) return "card";
  return "section";
}

export function buildSkeletonInventory(html: string, templateId: string): SkeletonInventory {
  try {
    const root = parse(html);
    const body = root.querySelector("body");
    const sections = body?.querySelectorAll("section") ?? [];
    if (!body || sections.length === 0) {
      throw new SkeletonInventoryError("insufficient_style_hooks", "A body and at least one section are required for a safe skeleton inventory");
    }
    if (!valid(html)) {
      throw new SkeletonInventoryError("invalid_html", "Template HTML must be well formed before building a skeleton inventory");
    }

    const styleHooks: SkeletonInventory["styleHooks"] = [];
    const addHook = (id: string, selector: string, role: HookRole) => {
      if (styleHooks.length < MAX_STYLE_HOOKS) styleHooks.push(hook(id, selector, role));
    };
    addHook("page", "body", "page");
    const navigation = body.querySelector("nav") ?? body.querySelector("header");
    if (navigation) addHook("navigation", domPath(navigation, body), "navigation");
    addHook("hero", domPath(sections[0], body), "hero");
    for (const [index, section] of sections.slice(1).entries()) addHook(`section-${index + 1}`, domPath(section, body), "section");

    const cardGroup = largestRepeatedSafeClass(body);
    if (cardGroup) addHook(`cards-${cardGroup.className.toLowerCase()}`, `${domPath(cardGroup.owner, body)} .${cardGroup.className}`, "cards");
    const buttons = buttonSelector(body);
    if (buttons) addHook("buttons", buttons, "buttons");
    const icons = iconSelector(body);
    if (icons) addHook("icons", icons, "icons");
    if (styleHooks.length === 1) {
      throw new SkeletonInventoryError("insufficient_style_hooks", "No safe style hooks beyond the page root were found");
    }

    const assetSlots = replaceableContentImages(body).slice(0, MAX_ASSET_SLOTS).map((image, slotIndex) => ({
      slotIndex,
      kind: "image" as const,
      role: imageRole(image, sections, cardGroup),
      currentAlt: image.getAttribute("alt")!.trim(),
      replaceable: true,
    }));
    const inventory = {
      schemaVersion: "skeleton-inventory/1.0" as const,
      templateId,
      availableTokens: [...CREATIVE_TOKEN_ALLOWLIST].sort((left, right) => left.localeCompare(right)),
      styleHooks,
      assetSlots,
      structuralFingerprint: fingerprintStructure(html, { allowedAssetSlots: assetSlots.map((asset) => asset.slotIndex) }),
    };
    return SkeletonInventorySchema.parse(inventory);
  } catch (error) {
    if (error instanceof SkeletonInventoryError) throw error;
    throw new SkeletonInventoryError("invalid_inventory", "Unable to build a safe skeleton inventory", { cause: error });
  }
}
