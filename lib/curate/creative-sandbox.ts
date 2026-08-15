import { parse, type HTMLElement } from "node-html-parser";
import postcss from "postcss";

import { sha256 } from "@/lib/generation/content-hash";

import type { SafeCreativeCandidate } from "./creative-baseline";
import {
  parseCreativePatch,
  type CreativeCanvasInspection,
  type CreativeOperation,
  type CreativeToolFailureCode,
  type CreativeToolResult,
} from "./creative-sandbox-contracts";

const EDIT_ID = "data-openlen-edit-id";
const RESERVED_MARKER = "data-slot-path=";
const SAFE_PROTOCOLS = new Set(["https:", "http:", "mailto:", "tel:"]);
const PRIVATE_HOST = /^(?:localhost|0\.0\.0\.0|\[?::1\]?|10\.\d+\.\d+\.\d+|127\.\d+\.\d+\.\d+|169\.254\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+)$/i;
const CSS_FORBIDDEN = /(?:expression\s*\(|behavior\s*:|-moz-binding|javascript:|vbscript:)/i;

export interface CreativeSandboxDeps {
  readonly sanitize: (html: string) => { html: string | null; errors: string[]; removed: { scripts: number; eventHandlers: number; dangerousUrls: number; iframes: number; metaRefresh: number } };
  readonly seal: (html: string) => { html: string; sealed: boolean };
  readonly render: (html: string) => Promise<{ mobileOverflow: boolean; invalidGeometry: boolean } | null>;
}

export interface CreativeSandbox {
  current(): SafeCreativeCandidate;
  inspect(): CreativeCanvasInspection;
  applyPatch(input: unknown): Promise<CreativeToolResult>;
  renderPreview(): Promise<CreativeToolResult>;
}

/** Ordinary user links survive; only executable schemes, embedded credentials
 * and private-network targets are refused. No domain allowlist. */
export function safeCreativeUrl(raw: string): boolean {
  const value = raw.trim();
  if (value === "") return false;
  if (value.startsWith("//")) return false;
  if (/^(?:#|\/|\.\/|\.\.\/)/.test(value)) return true;
  let parsed: URL;
  try { parsed = new URL(value); } catch { return false; }
  if (!SAFE_PROTOCOLS.has(parsed.protocol)) return false;
  if (parsed.username !== "" || parsed.password !== "") return false;
  if ((parsed.protocol === "https:" || parsed.protocol === "http:") && PRIVATE_HOST.test(parsed.hostname)) return false;
  return true;
}

function cssUrlAllowed(rawUrl: string, allowedAssetUrls: readonly string[]): boolean {
  const value = rawUrl.trim().replace(/^["']|["']$/g, "");
  if (value === "") return false;
  if (value.startsWith("#") || value.startsWith("/") || value.startsWith("./") || value.startsWith("../")) return !value.startsWith("//");
  if (value.startsWith("data:")) return /^data:image\/(?:png|jpeg|gif|webp|avif|svg\+xml);/i.test(value);
  return allowedAssetUrls.includes(value);
}

/** Broad creative CSS is allowed; only execution primitives, unsafe imports and
 * unvalidated network fetches are refused. */
export function safeCreativeCss(css: string, allowedAssetUrls: readonly string[] = []): { ok: true } | { ok: false; detail: string } {
  if (CSS_FORBIDDEN.test(css)) return { ok: false, detail: "css_execution_primitive" };
  let root: postcss.Root;
  try { root = postcss.parse(css); } catch { return { ok: false, detail: "css_unparseable" }; }
  let failure: string | null = null;
  root.walkAtRules((rule) => {
    if (rule.name.toLowerCase() === "import") failure ??= "css_import";
  });
  root.walkDecls((decl) => {
    for (const match of decl.value.matchAll(/url\(([^)]*)\)/gi)) {
      if (!cssUrlAllowed(match[1] ?? "", allowedAssetUrls)) failure ??= "css_external_fetch";
    }
  });
  return failure ? { ok: false, detail: failure } : { ok: true };
}

function targets(document: HTMLElement): Map<string, HTMLElement> {
  const found = new Map<string, HTMLElement>();
  for (const node of document.querySelectorAll(`[${EDIT_ID}]`)) {
    const id = node.getAttribute(EDIT_ID);
    if (id) found.set(id, node);
  }
  return found;
}

function warningsFor(removed: { scripts: number; eventHandlers: number; iframes: number; dangerousUrls: number }): string[] {
  const warnings: string[] = [];
  if (removed.scripts > 0) warnings.push(`${removed.scripts} script element(s) were removed; use CSS or an OpenLen module instead.`);
  if (removed.eventHandlers > 0) warnings.push(`${removed.eventHandlers} inline event handler(s) were removed; use CSS transitions or animations instead.`);
  if (removed.iframes > 0) warnings.push(`${removed.iframes} iframe(s) were removed; use an OpenLen embed instead.`);
  if (removed.dangerousUrls > 0) warnings.push(`${removed.dangerousUrls} unsafe URL(s) were removed.`);
  return warnings;
}

function preflight(operations: readonly CreativeOperation[]): CreativeToolFailureCode | null {
  for (const operation of operations) {
    if ("html" in operation && operation.html.includes(RESERVED_MARKER)) return "invalid_patch";
    if ("css" in operation && operation.css !== undefined && !safeCreativeCss(operation.css).ok) return "unsafe_css";
    if (operation.op === "set_page_css" && !safeCreativeCss(operation.css).ok) return "unsafe_css";
    if (operation.op === "set_link" && !safeCreativeUrl(operation.url)) return "unsafe_url";
  }
  return null;
}

function applyOperation(
  document: HTMLElement,
  operation: CreativeOperation,
  nextId: () => string,
): CreativeToolFailureCode | null {
  const found = targets(document);
  const target = "targetId" in operation ? found.get(operation.targetId) : undefined;
  if ("targetId" in operation && !target) return "unknown_target";

  if (operation.op === "replace_section") {
    const replacement = parse(operation.html).firstChild as HTMLElement | null;
    if (!replacement || typeof replacement.setAttribute !== "function") return "invalid_patch";
    replacement.setAttribute(EDIT_ID, operation.targetId);
    target!.replaceWith(replacement);
    return null;
  }
  if (operation.op === "remove_section") {
    target!.remove();
    return null;
  }
  if (operation.op === "insert_section" || operation.op === "move_section") {
    const anchor = operation.afterTargetId === null ? null : found.get(operation.afterTargetId);
    if (operation.afterTargetId !== null && !anchor) return "unknown_target";
    let node: HTMLElement;
    if (operation.op === "insert_section") {
      const created = parse(operation.html).firstChild as HTMLElement | null;
      if (!created || typeof created.setAttribute !== "function") return "invalid_patch";
      created.setAttribute(EDIT_ID, nextId());
      created.setAttribute("data-openlen-role", operation.role);
      node = created;
    } else {
      node = target!;
      node.remove();
    }
    if (anchor) anchor.insertAdjacentHTML("afterend", node.toString());
    else {
      const body = document.querySelector("body") ?? document;
      body.insertAdjacentHTML("afterbegin", node.toString());
    }
    return null;
  }
  if (operation.op === "set_page_css") {
    const head = document.querySelector("head") ?? document;
    head.insertAdjacentHTML("beforeend", `<style data-openlen-creative>${operation.css}</style>`);
    return null;
  }
  // set_link
  const anchor = target!.tagName?.toLowerCase() === "a" ? target! : target!.querySelector("a");
  if (!anchor) return "unknown_target";
  anchor.setAttribute("href", operation.url);
  if (operation.label !== undefined) anchor.set_content(operation.label);
  return null;
}

export function createCreativeSandbox(baseline: SafeCreativeCandidate, deps: CreativeSandboxDeps): CreativeSandbox {
  let state: SafeCreativeCandidate = baseline;
  let inserted = 0;

  const failure = (code: CreativeToolFailureCode, detail?: string): CreativeToolResult =>
    ({ ok: false, code, ...(detail ? { detail } : {}) });

  const gate = async (html: string): Promise<{ ok: true; html: string; warnings: string[] } | CreativeToolResult> => {
    const sanitized = deps.sanitize(html);
    if (sanitized.html === null) return failure("sanitization_failed");
    const sealed = deps.seal(sanitized.html);
    if (!sealed.sealed) return failure("seal_failed");
    const rendered = await deps.render(sealed.html);
    if (!rendered || rendered.mobileOverflow || rendered.invalidGeometry) return failure("render_failed");
    return { ok: true, html: sealed.html, warnings: warningsFor(sanitized.removed) };
  };

  return {
    current: () => state,

    inspect: () => {
      const document = parse(state.html);
      const outline = [...targets(document).entries()].map(([targetId, node]) => ({
        targetId,
        role: node.getAttribute("data-openlen-role") ?? "",
        tag: node.tagName?.toLowerCase() ?? "",
        textPreview: node.text.replace(/\s+/g, " ").trim().slice(0, 160),
      }));
      return {
        outline,
        imageSlots: document.querySelectorAll("[data-openlen-asset-slot]").map((node) => ({
          targetId: node.getAttribute(EDIT_ID) ?? "",
          filled: (node.getAttribute("style") ?? "").includes("background-image"),
        })),
        pageCssBytes: document.querySelectorAll("style").reduce((total, node) => total + node.text.length, 0),
        diagnostics: null,
      };
    },

    async applyPatch(input) {
      const parsed = parseCreativePatch(input);
      if (!parsed.ok) return failure("invalid_patch");
      const blocked = preflight(parsed.patch.operations);
      if (blocked) return failure(blocked);

      // Every operation lands on an isolated clone. `state` is replaced only
      // after sanitize, seal and render all pass — a failed batch changes nothing.
      const draft = parse(state.html);
      for (const operation of parsed.patch.operations) {
        const problem = applyOperation(draft, operation, () => `ol-inserted-${(inserted += 1)}`);
        if (problem) return failure(problem);
      }

      const gated = await gate(draft.toString());
      if (!("html" in gated)) return gated;
      // Every accepted mutation re-stamps the manifest hash; otherwise the
      // delivery gate rejects the improved page for not matching its own bytes.
      const manifest = (state.visualEngine as { compositionManifest?: Record<string, unknown> }).compositionManifest;
      state = {
        ...state,
        html: gated.html,
        source: "deepseek",
        appliedOps: state.appliedOps + parsed.patch.operations.length,
        visualEngine: {
          ...state.visualEngine,
          ...(manifest ? { compositionManifest: { ...manifest, outputHash: sha256(gated.html) } } : {}),
        } as SafeCreativeCandidate["visualEngine"],
      };
      return { ok: true, warnings: gated.warnings };
    },

    async renderPreview() {
      const rendered = await deps.render(state.html);
      if (!rendered) return failure("render_failed");
      return {
        ok: true,
        warnings: [
          `mobileOverflow=${rendered.mobileOverflow}`,
          `invalidGeometry=${rendered.invalidGeometry}`,
        ],
      };
    },
  };
}
