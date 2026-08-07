import { parse, valid, type HTMLElement } from "node-html-parser";
import type { SkeletonInventory } from "@/lib/generation/creative-contracts";
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

function tagName(element: HTMLElement): string {
  return element.rawTagName?.toLowerCase() ?? "";
}

function hook(id: string, selector: string, role: HookRole): SkeletonInventory["styleHooks"][number] {
  return { id, selector, allowedProperties: [...HOOK_PROPERTY_POLICY[role]] };
}

function largestRepeatedSafeClass(root: HTMLElement): string | null {
  const counts = new Map<string, number>();
  for (const element of root.querySelectorAll("[class]")) {
    for (const className of new Set((element.getAttribute("class") ?? "").split(/\s+/).filter((value) => SAFE_CLASS_NAME.test(value)))) {
      counts.set(className, (counts.get(className) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort(([leftClass, leftCount], [rightClass, rightCount]) => rightCount - leftCount || leftClass.localeCompare(rightClass))[0]?.[0] ?? null;
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

function sectionSelector(section: HTMLElement): string {
  let position = 0;
  for (const sibling of section.parentNode?.children ?? []) {
    if (tagName(sibling) === "section") position += 1;
    if (sibling === section) return `section:nth-of-type(${position})`;
  }
  throw new SkeletonInventoryError("invalid_inventory", "Unable to derive a deterministic section selector");
}

function imageRole(image: HTMLElement, sections: readonly HTMLElement[], cardClass: string | null): "hero" | "section" | "card" {
  if (image.closest("section") === sections[0]) return "hero";
  if (cardClass && image.closest(`.${cardClass}`)) return "card";
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
    if (navigation) addHook("navigation", tagName(navigation), "navigation");
    addHook("hero", sectionSelector(sections[0]), "hero");
    for (const [index, section] of sections.slice(1).entries()) addHook(`section-${index + 1}`, sectionSelector(section), "section");

    const cardClass = largestRepeatedSafeClass(body);
    if (cardClass) addHook(`cards-${cardClass.toLowerCase()}`, `.${cardClass}`, "cards");
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
      role: imageRole(image, sections, cardClass),
      currentAlt: image.getAttribute("alt")!.trim(),
      replaceable: true,
    }));
    return {
      schemaVersion: "skeleton-inventory/1.0",
      templateId,
      availableTokens: [...CREATIVE_TOKEN_ALLOWLIST].sort((left, right) => left.localeCompare(right)),
      styleHooks,
      assetSlots,
      structuralFingerprint: fingerprintStructure(html, { allowedAssetSlots: assetSlots.map((asset) => asset.slotIndex) }),
    };
  } catch (error) {
    if (error instanceof SkeletonInventoryError) throw error;
    throw new SkeletonInventoryError("invalid_inventory", "Unable to build a safe skeleton inventory", { cause: error });
  }
}
