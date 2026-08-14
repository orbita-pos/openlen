import postcss from "postcss";
import { parse, type HTMLElement } from "node-html-parser";

import { renderVisualQualityViewports, type VisualQualityViewports } from "../ai/visual-quality-renderer";
import { sanitizeForPublish, sealRelease, type SanitizeResult } from "../html-engine";
import { validateUrl } from "../style-match/scrape/validate-url";
import type { SafeCreativeCandidate } from "./ai-creation-contracts";
import {
  CreativePatchSchema,
  type CreativeCanvasInspection,
  type CreativePatchInput,
  type CreativeSandbox,
  type CreativeToolFailureCode,
  type CreativeToolResult,
} from "./creative-sandbox-contracts";

const EDIT_ID = "data-openlen-edit-id";
const RESERVED_MARKER = /\b(?:data-openlen-edit-id|data-op-id|data-slot-path)\s*=/i;
const EVENT_HANDLER = /\s(on[a-z0-9_-]+)\s*=/i;
const VOID_ELEMENTS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const URL_ATTRIBUTES = ["href", "src", "action", "formaction", "poster", "xlink:href"] as const;

type UrlValidation = typeof validateUrl;

export interface CreativeSandboxDeps {
  readonly sanitize?: (html: string) => SanitizeResult;
  readonly seal?: (html: string) => { readonly html: string; readonly sealed: boolean };
  readonly render?: (html: string) => Promise<VisualQualityViewports | null>;
  readonly validateFetchedImage?: UrlValidation;
}

function failure(code: CreativeToolFailureCode, warnings: readonly string[] = []): CreativeToolResult {
  return { ok: false, code, warnings };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

export function safeCreativeUrl(raw: string): boolean {
  if (/^(?:#|\/|\.\/|\.\.\/)/.test(raw)) return !raw.startsWith("//");
  try {
    const parsed = new URL(raw);
    return ["https:", "http:", "mailto:", "tel:"].includes(parsed.protocol)
      && parsed.username === ""
      && parsed.password === "";
  } catch {
    return false;
  }
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function decodeCssEscapes(value: string): string {
  return value.replace(/\\([0-9a-f]{1,6})\s?|\\(.)/gi, (_match, hex: string | undefined, character: string | undefined) => (
    hex ? String.fromCodePoint(Number.parseInt(hex, 16)) : character ?? ""
  ));
}

function cssUrls(value: string): string[] {
  return [...value.matchAll(/url\(\s*((?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^)])*)\s*\)/gi)]
    .map((match) => unquote(match[1] ?? ""));
}

function executableDataUrl(value: string): boolean {
  if (!/^data:/i.test(value)) return false;
  const mediaType = value.slice(5, value.indexOf(",") < 0 ? undefined : value.indexOf(",")).toLowerCase();
  return /(?:text\/html|image\/svg\+xml|application\/(?:xhtml\+xml|xml)|text\/xml|javascript)/.test(mediaType);
}

export function safeCreativeCss(css: string, validatedAssetUrls: ReadonlySet<string> = new Set()): boolean {
  let root: postcss.Root;
  try { root = postcss.parse(css); } catch { return false; }
  let safe = true;
  root.walkAtRules((rule) => {
    if (decodeCssEscapes(rule.name).toLowerCase() === "import") safe = false;
  });
  root.walkDecls((declaration) => {
    const property = decodeCssEscapes(declaration.prop).toLowerCase();
    const value = decodeCssEscapes(declaration.value).replace(/\/\*[\s\S]*?\*\//g, "");
    const normalized = value.replace(/[\s\0-\x1f]+/g, "").toLowerCase();
    if (property === "behavior" || property === "-moz-binding" || normalized.includes("expression(") || normalized.includes("javascript:")) {
      safe = false;
      return;
    }
    for (const rawUrl of cssUrls(value)) {
      if (!rawUrl || executableDataUrl(rawUrl)) {
        safe = false;
        continue;
      }
      if (/^data:/i.test(rawUrl)) continue;
      if (!safeCreativeUrl(rawUrl)) {
        safe = false;
        continue;
      }
      try {
        const parsed = new URL(rawUrl);
        if ((parsed.protocol === "http:" || parsed.protocol === "https:") && !validatedAssetUrls.has(rawUrl)) safe = false;
      } catch {
        // Relative and anchor URLs are local canvas references.
      }
    }
  });
  return safe;
}

function wellFormedHtml(html: string): boolean {
  const stack: string[] = [];
  const tokens = html.match(/<!--[\s\S]*?-->|<![^>]*>|<\/?[A-Za-z][^>]*>/g) ?? [];
  if (tokens.length === 0) return false;
  for (const token of tokens) {
    if (token.startsWith("<!")) continue;
    const match = /^<\s*(\/?)\s*([A-Za-z][A-Za-z0-9:-]*)/.exec(token);
    if (!match) return false;
    const tag = match[2]!.toLowerCase();
    if (match[1] === "/") {
      if (stack.pop() !== tag) return false;
    } else if (!VOID_ELEMENTS.has(tag) && !/\/\s*>$/.test(token)) {
      stack.push(tag);
    }
  }
  return stack.length === 0;
}

function fragmentRoot(html: string): HTMLElement | null {
  if (!wellFormedHtml(html)) return null;
  const root = parse(html);
  const elements = root.childNodes.filter((node) => node.nodeType === 1) as HTMLElement[];
  return elements.length === 1 ? elements[0]! : null;
}

function duplicatedIdentity(document: HTMLElement): boolean {
  for (const attribute of ["id", EDIT_ID]) {
    const seen = new Set<string>();
    for (const element of document.querySelectorAll(`[${attribute}]`)) {
      const value = element.getAttribute(attribute);
      if (!value || seen.has(value)) return true;
      seen.add(value);
    }
  }
  return false;
}

function assignTargets(document: HTMLElement): void {
  const used = new Set(document.querySelectorAll(`[${EDIT_ID}]`).map((element) => element.getAttribute(EDIT_ID) ?? ""));
  let next = 1;
  for (const element of document.querySelectorAll("[data-openlen-role],a")) {
    if (element.hasAttribute(EDIT_ID)) continue;
    while (used.has(`ol-edit-${next}`)) next += 1;
    const id = `ol-edit-${next++}`;
    used.add(id);
    element.setAttribute(EDIT_ID, id);
  }
}

function target(document: HTMLElement, id: string): HTMLElement | null {
  return document.querySelector(`[${EDIT_ID}="${id}"]`);
}

function warningsForMarkup(html: string): string[] {
  const warnings: string[] = [];
  if (/<script\b/i.test(html)) warnings.push("scripts");
  if (/<(?:iframe|object|embed)\b/i.test(html)) warnings.push("iframes");
  if (EVENT_HANDLER.test(html)) warnings.push("event_handlers");
  return warnings;
}

function sanitizedWarnings(removed: SanitizeResult["removed"]): string[] {
  const warnings: string[] = [];
  if (removed.scripts > 0 || removed.metaRefresh > 0) warnings.push("scripts");
  if (removed.eventHandlers > 0) warnings.push("event_handlers");
  if (removed.iframes > 0) warnings.push("iframes");
  if (removed.dangerousUrls > 0) warnings.push("unsafe_urls");
  return warnings;
}

function introducedFragments(input: CreativePatchInput): string[] {
  return input.operations.flatMap((operation) => (
    operation.op === "replace_section" || operation.op === "insert_section" ? [operation.html] : []
  ));
}

async function validateFragmentUrls(
  html: string,
  validateFetchedImage: UrlValidation,
  assets: Set<string>,
): Promise<boolean> {
  const document = parse(html);
  const validateAsset = async (value: string): Promise<boolean> => {
    if (assets.has(value)) return true;
    let parsed: URL;
    try { parsed = new URL(value); } catch { return true; }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    const result = await validateFetchedImage(value);
    if (!result.ok) return false;
    assets.add(value);
    return true;
  };
  for (const element of document.querySelectorAll("*")) {
    for (const attribute of URL_ATTRIBUTES) {
      const value = element.getAttribute(attribute);
      if (value !== undefined && !safeCreativeUrl(value)) return false;
    }
    const srcset = element.getAttribute("srcset");
    if (srcset !== undefined) {
      for (const candidate of srcset.split(",").map((part) => part.trim().split(/\s+/)[0]).filter(Boolean) as string[]) {
        if (!safeCreativeUrl(candidate)) return false;
        if (!await validateAsset(candidate)) return false;
      }
    }
  }
  for (const image of document.querySelectorAll("img[src],source[src]")) {
    const value = image.getAttribute("src")!;
    if (!await validateAsset(value)) return false;
  }
  for (const element of document.querySelectorAll("*")) {
    const inlineStyle = element.getAttribute("style");
    if (inlineStyle !== undefined && !safeCreativeCss(`x{${inlineStyle}}`, assets)) return false;
    if (element.tagName.toLowerCase() === "style" && !safeCreativeCss(element.textContent, assets)) return false;
  }
  return true;
}

function appendCss(document: HTMLElement, css: string): boolean {
  const head = document.querySelector("head");
  if (!head) return false;
  let style = head.querySelector('style[data-openlen-creative="true"]');
  if (!style) {
    head.insertAdjacentHTML("beforeend", '<style data-openlen-creative="true"></style>');
    style = head.querySelector('style[data-openlen-creative="true"]');
  }
  if (!style) return false;
  style.set_content(`${style.textContent}\n${css}`);
  return true;
}

function applyOperations(document: HTMLElement, input: CreativePatchInput): CreativeToolFailureCode | null {
  for (const operation of input.operations) {
    if (operation.op === "replace_section") {
      const existing = target(document, operation.targetId);
      const replacement = fragmentRoot(operation.html);
      if (!existing) return "target_not_found";
      if (!replacement) return "invalid_patch";
      const role = existing.getAttribute("data-openlen-role");
      replacement.setAttribute(EDIT_ID, operation.targetId);
      if (role) replacement.setAttribute("data-openlen-role", role);
      existing.replaceWith(replacement);
      if (operation.css && !appendCss(document, operation.css)) return "invalid_patch";
      continue;
    }
    if (operation.op === "insert_section") {
      const replacement = fragmentRoot(operation.html);
      if (!replacement) return "invalid_patch";
      replacement.setAttribute("data-openlen-role", operation.role);
      if (operation.afterTargetId === null) {
        const container = document.querySelector("main") ?? document.querySelector("body");
        if (!container) return "invalid_patch";
        container.insertAdjacentHTML("afterbegin", replacement.toString());
      } else {
        const after = target(document, operation.afterTargetId);
        if (!after) return "target_not_found";
        after.insertAdjacentHTML("afterend", replacement.toString());
      }
      if (operation.css && !appendCss(document, operation.css)) return "invalid_patch";
      assignTargets(document);
      continue;
    }
    if (operation.op === "remove_section") {
      const existing = target(document, operation.targetId);
      if (!existing) return "target_not_found";
      existing.remove();
      continue;
    }
    if (operation.op === "move_section") {
      const existing = target(document, operation.targetId);
      if (!existing) return "target_not_found";
      const serialized = existing.toString();
      existing.remove();
      if (operation.afterTargetId === null) {
        const container = document.querySelector("main") ?? document.querySelector("body");
        if (!container) return "invalid_patch";
        container.insertAdjacentHTML("afterbegin", serialized);
      } else {
        const after = target(document, operation.afterTargetId);
        if (!after) return "target_not_found";
        after.insertAdjacentHTML("afterend", serialized);
      }
      continue;
    }
    if (operation.op === "set_page_css") {
      if (!appendCss(document, operation.css)) return "invalid_patch";
      continue;
    }
    const link = target(document, operation.targetId);
    if (!link || link.tagName.toLowerCase() !== "a") return "target_not_found";
    link.setAttribute("href", operation.url);
    if (operation.label !== undefined) link.set_content(escapeHtml(operation.label));
  }
  return null;
}

export function createCreativeSandbox(initial: SafeCreativeCandidate, deps: CreativeSandboxDeps = {}): CreativeSandbox {
  const sanitize = deps.sanitize ?? sanitizeForPublish;
  const seal = deps.seal ?? sealRelease;
  const render = deps.render ?? renderVisualQualityViewports;
  const validateFetchedImage = deps.validateFetchedImage ?? validateUrl;
  let state: SafeCreativeCandidate = { ...initial };
  let validatedAssets = new Set<string>();

  return {
    current() {
      return { ...state };
    },
    inspect(): CreativeCanvasInspection {
      const document = parse(state.html);
      assignTargets(document);
      return {
        title: state.title,
        targets: document.querySelectorAll(`[${EDIT_ID}]`).map((element) => ({
          targetId: element.getAttribute(EDIT_ID)!,
          role: element.getAttribute("data-openlen-role") ?? (element.tagName.toLowerCase() === "a" ? "link" : "element"),
          tagName: element.tagName.toLowerCase(),
        })),
      };
    },
    async applyPatch(rawInput): Promise<CreativeToolResult> {
      const parsed = CreativePatchSchema.safeParse(rawInput);
      if (!parsed.success) return failure("invalid_patch");
      const input = parsed.data;
      const fragments = introducedFragments(input);
      if (fragments.some((html) => RESERVED_MARKER.test(html))) return failure("reserved_marker");
      const markupWarnings = [...new Set(fragments.flatMap(warningsForMarkup))];
      if (markupWarnings.length > 0) return failure("sanitization_failed", markupWarnings);

      const tentativeAssets = new Set(validatedAssets);
      for (const fragment of fragments) {
        if (!wellFormedHtml(fragment)) return failure("invalid_patch");
        if (!await validateFragmentUrls(fragment, validateFetchedImage, tentativeAssets)) return failure("unsafe_url");
      }
      for (const operation of input.operations) {
        if (operation.op === "set_link" && !safeCreativeUrl(operation.url)) return failure("unsafe_url");
        const css = "css" in operation ? operation.css : undefined;
        if (css !== undefined && !safeCreativeCss(css, tentativeAssets)) return failure("unsafe_css");
      }

      const document = parse(state.html);
      if (duplicatedIdentity(document)) return failure("duplicate_target");
      assignTargets(document);
      const operationFailure = applyOperations(document, input);
      if (operationFailure) return failure(operationFailure);
      if (duplicatedIdentity(document)) return failure("duplicate_target");

      const sanitized = sanitize(document.toString());
      const warnings = sanitizedWarnings(sanitized.removed);
      if (sanitized.html === null || warnings.length > 0) return failure("sanitization_failed", warnings);
      const sealed = seal(sanitized.html);
      if (!sealed.sealed) return failure("seal_failed");
      const rendered = await render(sealed.html);
      if (!rendered || rendered.mobileOverflow || rendered.invalidGeometry) return failure("render_failed");

      state = {
        ...state,
        html: sealed.html,
        appliedOps: state.appliedOps + input.operations.length,
        source: "deepseek",
      };
      validatedAssets = tentativeAssets;
      return { ok: true, candidate: { ...state }, warnings };
    },
    async renderPreview(): Promise<CreativeToolResult> {
      const rendered = await render(state.html);
      if (!rendered || rendered.mobileOverflow || rendered.invalidGeometry) return failure("render_failed");
      return { ok: true, candidate: { ...state }, warnings: [] };
    },
  };
}

export type {
  CreativeCanvasInspection,
  CreativePatchInput,
  CreativeSandbox,
  CreativeToolResult,
} from "./creative-sandbox-contracts";
