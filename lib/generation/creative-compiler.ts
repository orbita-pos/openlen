import { wcagContrast } from "culori";
import { parse as parseHtml, type HTMLElement } from "node-html-parser";
import { parse as parseCss, type Declaration, type Rule } from "postcss";
import { applyThemeTokensToHtml, readThemeTokenFromHtml } from "@/lib/agent/theme-apply";
import {
  CreativeDirectionSchema,
  SkeletonAdaptationPlanSchema,
  SkeletonInventorySchema,
  type CreativeDirection,
  type SkeletonAdaptationPlan,
  type SkeletonInventory,
} from "@/lib/generation/creative-contracts";
import {
  CREATIVE_FONT_MOODS,
  CREATIVE_TOKEN_ALLOWLIST,
} from "@/lib/generation/creative-registry";
import { buildSkeletonInventory } from "@/lib/generation/skeleton-inventory";
import { structureIsPreserved } from "@/lib/generation/structural-fingerprint";
import { deriveContractColors } from "@/lib/theme-derive";

const VISUAL_ENGINE_VERSION = "creative-direction/1.0";
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const RGBA_COLOR = /^rgba\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d*\.?\d+)\s*\)$/i;
const DANGEROUS_CSS = /url\s*\(|@import|expression\s*\(|\bbehavior\b|-moz-binding|\b(?:display\s*:|position\b|z-index\b|overflow\b|pointer-events\b|content\b)/i;
const COLOR_TOKENS = new Set([
  "--ol-bg", "--ol-surface", "--ol-surface-2", "--ol-fg", "--ol-fg-muted",
  "--ol-fg-faint", "--ol-border", "--ol-border-strong", "--ol-accent", "--ol-accent-ink",
]);
const COLOR_PROPERTIES = new Set(["background-color", "color", "border-color"]);
const SPACE_PROPERTIES = new Set(["border-radius", "padding", "gap"]);
const FONT_TOKENS = new Set(["--ol-font-display", "--ol-font-body", "--ol-font-mono"]);
const MONO_FONT = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
const REGISTERED_FONTS = new Set<string>([
  ...Object.values(CREATIVE_FONT_MOODS).flatMap((mood) => [mood.display, mood.body]),
  MONO_FONT,
]);
const FONT_BY_ROLE = {
  display: new Map<string, string>(),
  body: new Map<string, string>(),
};

for (const mood of Object.values(CREATIVE_FONT_MOODS)) {
  FONT_BY_ROLE.display.set(fontFamilyName(mood.display).toLowerCase(), mood.display);
  FONT_BY_ROLE.body.set(fontFamilyName(mood.body).toLowerCase(), mood.body);
}

const ICON_VALUES: Readonly<Record<string, ReadonlySet<string>>> = {
  fill: new Set(["none", "currentColor"]),
  stroke: new Set(["none", "currentColor"]),
  "stroke-width": new Set(["1.5", "2", "2.5"]),
  "stroke-linecap": new Set(["round", "butt", "square"]),
  "stroke-linejoin": new Set(["round", "bevel", "miter"]),
};

export type CreativeCompileFailureCode =
  | "invalid_input"
  | "invalid_inventory"
  | "token_not_allowed"
  | "unknown_hook"
  | "property_not_allowed"
  | "css_policy_violation"
  | "contrast_violation"
  | "font_not_registered"
  | "icon_policy_violation"
  | "structural_violation";

export interface ExplicitCreativeOverrides {
  mode?: CreativeDirection["mode"];
  background?: string;
  surface?: string;
  surfaceAlt?: string;
  foreground?: string;
  foregroundMuted?: string;
  border?: string;
  accent?: string;
  accentInk?: string;
  displayFont?: string;
  bodyFont?: string;
  monoFont?: string;
  radius?: string;
  radiusScale?: number;
  spacingScale?: number;
  textScale?: number;
}

export interface CreativeCompileInput {
  html: string;
  inventory: SkeletonInventory;
  direction: CreativeDirection;
  plan: SkeletonAdaptationPlan;
  brand?: { accent?: string };
  explicitOverrides?: ExplicitCreativeOverrides;
  explicitConstraints?: readonly string[];
}

export type CreativeCompileResult =
  | {
      ok: true;
      html: string;
      tokens: Record<string, string>;
      mode: CreativeDirection["mode"];
      enforcedConstraints: string[];
    }
  | {
      ok: false;
      code: CreativeCompileFailureCode;
      message: string;
      hookId?: string;
      property?: string;
      token?: string;
    };

type CompileFailure = Extract<CreativeCompileResult, { ok: false }>;
type ConstraintClaim = { raw: string; token?: string; value?: string; mode?: CreativeDirection["mode"] };

function failure(code: CreativeCompileFailureCode, message: string, details: Omit<CompileFailure, "ok" | "code" | "message"> = {}): CompileFailure {
  return { ok: false, code, message, ...details };
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every((entry) => typeof entry === "string");
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function hasCompilerPlanShape(value: unknown): value is SkeletonAdaptationPlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const plan = value as Record<string, unknown>;
  if (!hasOnlyKeys(plan, ["schemaVersion", "tokens", "cssOverride", "assets"])
      || plan.schemaVersion !== "skeleton-adaptation-plan/1.0"
      || !isStringRecord(plan.tokens)
      || !Array.isArray(plan.cssOverride)
      || plan.cssOverride.length > 12
      || !Array.isArray(plan.assets)) return false;
  const hookIds = new Set<string>();
  for (const candidate of plan.cssOverride) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
    const override = candidate as Record<string, unknown>;
    if (!hasOnlyKeys(override, ["hookId", "declarations"])
        || typeof override.hookId !== "string"
        || !isStringRecord(override.declarations)
        || hookIds.has(override.hookId)) return false;
    hookIds.add(override.hookId);
  }
  return SkeletonAdaptationPlanSchema.safeParse({
    schemaVersion: plan.schemaVersion,
    tokens: {},
    cssOverride: [],
    assets: plan.assets,
  }).success;
}

function hasOptionalInputShape(input: CreativeCompileInput): boolean {
  if (typeof input.html !== "string") return false;
  if (input.explicitConstraints !== undefined
      && (!Array.isArray(input.explicitConstraints) || input.explicitConstraints.length > 12 || !input.explicitConstraints.every((value) => typeof value === "string"))) return false;
  if (input.brand !== undefined) {
    if (!input.brand || typeof input.brand !== "object" || Array.isArray(input.brand) || !hasOnlyKeys(input.brand as unknown as Record<string, unknown>, ["accent"])) return false;
    if (input.brand.accent !== undefined && typeof input.brand.accent !== "string") return false;
  }
  if (input.explicitOverrides !== undefined) {
    if (!input.explicitOverrides || typeof input.explicitOverrides !== "object" || Array.isArray(input.explicitOverrides)) return false;
    const overrides = input.explicitOverrides as unknown as Record<string, unknown>;
    const keys = ["mode", "background", "surface", "surfaceAlt", "foreground", "foregroundMuted", "border", "accent", "accentInk", "displayFont", "bodyFont", "monoFont", "radius", "radiusScale", "spacingScale", "textScale"];
    if (!hasOnlyKeys(overrides, keys)) return false;
    if (overrides.mode !== undefined && (typeof overrides.mode !== "string" || !new Set(["light", "dark", "cream"]).has(overrides.mode))) return false;
    for (const key of ["radiusScale", "spacingScale", "textScale"]) {
      if (overrides[key] !== undefined && (typeof overrides[key] !== "number" || !Number.isFinite(overrides[key]))) return false;
    }
    for (const key of keys.filter((key) => !["mode", "radiusScale", "spacingScale", "textScale"].includes(key))) {
      if (overrides[key] !== undefined && typeof overrides[key] !== "string") return false;
    }
  }
  return true;
}

function hasBrandIdentityToken(value: string): boolean {
  const tokens = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return tokens.some((token) => ["logo", "brand", "wordmark", "identity"].includes(token));
}

function elementLooksLikeLogo(element: HTMLElement): boolean {
  for (let current: HTMLElement | null = element; current; current = current.parentNode) {
    const tag = current.rawTagName?.toLowerCase() ?? "";
    if (current !== element && ["nav", "header", "body", "html", "main", "section"].includes(tag)) break;
    const identity = [current.getAttribute("id"), current.getAttribute("class"), current.getAttribute("aria-label"), current.getAttribute("title"), current.getAttribute("role"), current.getAttribute("alt"), current.getAttribute("src")].filter(Boolean).join(" ");
    if (hasBrandIdentityToken(identity)) return true;
  }
  const anchor = element.closest("a");
  if (!anchor) return false;
  const href = anchor.getAttribute("href")?.trim() ?? "";
  const semanticLabel = [anchor.getAttribute("aria-label"), anchor.getAttribute("title"), anchor.getAttribute("role")].filter(Boolean).join(" ");
  if (/\b(?:home|inicio|start|brand)\b/i.test(semanticLabel)) return true;
  const homeHref = /^(?:\/|\/home\/?|\/inicio\/?)(?:[?#].*)?$/i.test(href);
  return homeHref;
}

function iconHookTargetsLogo(html: string, inventory: SkeletonInventory): boolean {
  const iconHook = inventory.styleHooks.find((hook) => hook.id === "icons");
  if (!iconHook) return false;
  try {
    return parseHtml(html).querySelectorAll(iconHook.selector).some(elementLooksLikeLogo);
  } catch {
    return true;
  }
}

function stripVisualEngineStyles(html: string): string {
  const ranges = parseHtml(html).querySelectorAll("style")
    .filter((style) => style.hasAttribute("data-openlen-visual-engine"))
    .map((style) => style.range)
    .sort((left, right) => right[0] - left[0]);
  return ranges.reduce((source, [start, end]) => source.slice(0, start) + source.slice(end), html);
}

function insertVisualEngineStyle(html: string, styleBlock: string): string | null {
  const root = parseHtml(html);
  const head = root.querySelector("head");
  if (!head) return null;
  const [start, end] = head.range;
  const source = html.slice(start, end);
  const close = /<\/head\s*>$/i.exec(source);
  if (!close) return null;
  const insertion = start + close.index;
  const output = html.slice(0, insertion) + styleBlock + html.slice(insertion);
  const parsed = parseHtml(output);
  const allOwned = parsed.querySelectorAll("style").filter((style) => style.hasAttribute("data-openlen-visual-engine"));
  const headOwned = parsed.querySelector("head")?.querySelectorAll("style").filter((style) => style.hasAttribute("data-openlen-visual-engine")) ?? [];
  return allOwned.length === 1 && headOwned.length === 1 ? output : null;
}

function fontFamilyName(value: string): string {
  return value.split(",", 1)[0].trim().replace(/^['"]|['"]$/g, "");
}

function sameInventory(left: SkeletonInventory, right: SkeletonInventory): boolean {
  return left.structuralFingerprint === right.structuralFingerprint
    && JSON.stringify(left.availableTokens) === JSON.stringify(right.availableTokens)
    && JSON.stringify(left.styleHooks) === JSON.stringify(right.styleHooks)
    && JSON.stringify(left.assetSlots) === JSON.stringify(right.assetSlots);
}

function directionTokens(direction: CreativeDirection): Record<string, string> {
  const derived = deriveContractColors({
    bg: direction.palette.background,
    surface: direction.palette.surface,
    fg: direction.palette.foreground,
    border: direction.palette.border,
    accent: direction.palette.accent,
  });
  const displayMood = CREATIVE_FONT_MOODS[direction.typography.display];
  const bodyMood = CREATIVE_FONT_MOODS[direction.typography.body];
  const radius = { square: "0px", soft: "8px", round: "14px", extra_round: "20px" }[direction.geometry.radius];
  const textScale = { compact: "0.94", balanced: "1", expressive: "1.08" }[direction.typography.scale];
  return {
    "--ol-bg": direction.palette.background,
    "--ol-surface": direction.palette.surface,
    "--ol-surface-2": direction.palette.surfaceAlt || derived["surface-2"],
    "--ol-fg": direction.palette.foreground,
    "--ol-fg-muted": direction.palette.foregroundMuted || derived["fg-muted"],
    "--ol-fg-faint": derived["fg-faint"],
    "--ol-border": direction.palette.border,
    "--ol-border-strong": derived["border-strong"],
    "--ol-accent": direction.palette.accent,
    "--ol-accent-ink": direction.palette.accentInk || derived["accent-ink"],
    "--ol-radius": radius,
    "--ol-r-scale": String(direction.geometry.radiusScale),
    "--ol-space-scale": String(direction.geometry.spacingScale),
    "--ol-text-scale": textScale,
    "--ol-font-display": displayMood.display,
    "--ol-font-body": bodyMood.body,
    ...(direction.typography.mono ? { "--ol-font-mono": MONO_FONT } : {}),
  };
}

function explicitTokens(overrides: ExplicitCreativeOverrides | undefined): Record<string, string> {
  if (!overrides) return {};
  const values: Array<[string, string | number | undefined]> = [
    ["--ol-bg", overrides.background],
    ["--ol-surface", overrides.surface],
    ["--ol-surface-2", overrides.surfaceAlt],
    ["--ol-fg", overrides.foreground],
    ["--ol-fg-muted", overrides.foregroundMuted],
    ["--ol-border", overrides.border],
    ["--ol-accent", overrides.accent],
    ["--ol-accent-ink", overrides.accentInk],
    ["--ol-font-display", overrides.displayFont],
    ["--ol-font-body", overrides.bodyFont],
    ["--ol-font-mono", overrides.monoFont],
    ["--ol-radius", overrides.radius],
    ["--ol-r-scale", overrides.radiusScale],
    ["--ol-space-scale", overrides.spacingScale],
    ["--ol-text-scale", overrides.textScale],
  ];
  return Object.fromEntries(values.filter((entry): entry is [string, string | number] => entry[1] !== undefined).map(([key, value]) => [key, String(value)]));
}

function mergeTokenTier(base: Record<string, string>, overrides: Record<string, string>): Record<string, string> {
  const merged = { ...base, ...overrides };
  const requiredBaseTokens = ["--ol-bg", "--ol-surface", "--ol-fg", "--ol-border", "--ol-accent"] as const;
  if (!requiredBaseTokens.every((token) => HEX_COLOR.test(merged[token] ?? ""))) return merged;
  const derived = deriveContractColors({
    bg: merged["--ol-bg"],
    surface: merged["--ol-surface"],
    fg: merged["--ol-fg"],
    border: merged["--ol-border"],
    accent: merged["--ol-accent"],
  });
  const changed = new Set(Object.keys(overrides));
  const setDerived = (token: string, value: string, dependencies: readonly string[]) => {
    if (dependencies.some((dependency) => changed.has(dependency)) && !(token in overrides)) merged[token] = value;
  };
  setDerived("--ol-surface-2", derived["surface-2"], ["--ol-surface", "--ol-fg"]);
  setDerived("--ol-fg-muted", derived["fg-muted"], ["--ol-fg", "--ol-bg"]);
  setDerived("--ol-fg-faint", derived["fg-faint"], ["--ol-fg", "--ol-bg"]);
  setDerived("--ol-border-strong", derived["border-strong"], ["--ol-border", "--ol-fg"]);
  setDerived("--ol-accent-ink", derived["accent-ink"], ["--ol-accent"]);
  return merged;
}

function registeredFont(role: "display" | "body", requested: string): string | null {
  const normalized = requested.trim().replace(/^['"]|['"]$/g, "").toLowerCase();
  return FONT_BY_ROLE[role].get(normalized) ?? null;
}

function parseExplicitConstraints(constraints: readonly string[] | undefined):
  | { ok: true; tokens: Record<string, string>; mode?: CreativeDirection["mode"]; claims: ConstraintClaim[] }
  | CompileFailure {
  const tokens: Record<string, string> = {};
  const claims: ConstraintClaim[] = [];
  let mode: CreativeDirection["mode"] | undefined;
  const roles: Record<string, string> = {
    background: "--ol-bg", fondo: "--ol-bg",
    surface: "--ol-surface", superficie: "--ol-surface",
    surfacealt: "--ol-surface-2", superficiealternativa: "--ol-surface-2",
    foreground: "--ol-fg", text: "--ol-fg", texto: "--ol-fg",
    foregroundmuted: "--ol-fg-muted", textomuted: "--ol-fg-muted", textoatenuado: "--ol-fg-muted",
    border: "--ol-border", borde: "--ol-border",
    accent: "--ol-accent", acento: "--ol-accent",
    accentink: "--ol-accent-ink", tintadeacento: "--ol-accent-ink",
  };
  for (const raw of constraints ?? []) {
    const constraint = raw.trim();
    if (/^(?:dark mode|modo oscuro)$/i.test(constraint)) {
      mode = "dark";
      claims.push({ raw, mode: "dark" });
      continue;
    }
    const structuredColor = /^([^:]+)\s*:\s*([\s\S]*)$/.exec(constraint);
    const normalizedRole = structuredColor?.[1].trim().toLowerCase().replace(/[\s_-]+/g, "") ?? "";
    if (structuredColor && roles[normalizedRole]) {
      if (/[\r\n]/.test(raw)) return failure("invalid_input", `Explicit ${structuredColor[1].trim()} color must be single-line`);
      if (!HEX_COLOR.test(structuredColor[2].trim())) return failure("invalid_input", `Explicit ${structuredColor[1].trim()} color must be a six-digit hex value`);
      const token = roles[normalizedRole];
      const value = structuredColor[2].trim().toUpperCase();
      tokens[token] = value;
      claims.push({ raw, token, value });
      continue;
    }
    const font = /^(display|body) font\s*:\s*(.+)$/i.exec(constraint);
    if (font) {
      const role = font[1].toLowerCase() as "display" | "body";
      const value = registeredFont(role, font[2]);
      if (!value) return failure("font_not_registered", `Explicit ${role} font is not registered`, { token: `--ol-font-${role}` });
      tokens[`--ol-font-${role}`] = value;
      claims.push({ raw, token: `--ol-font-${role}`, value });
    }
  }
  return { ok: true, tokens, mode, claims };
}

function clampNumber(value: string, minimum: number, maximum: number): string | null {
  if (!/^-?\d+(?:\.\d+)?$/.test(value.trim())) return null;
  return String(Math.min(maximum, Math.max(minimum, Number(value))));
}

function clampRadius(value: string): string | null {
  const match = /^(-?\d+(?:\.\d+)?)(px|rem|em)$/.exec(value.trim());
  if (!match) return null;
  const maximum = match[2] === "px" ? 32 : 2;
  return `${Math.min(maximum, Math.max(0, Number(match[1])))}${match[2]}`;
}

function normalizeToken(token: string, value: string): string | CompileFailure {
  if (!CREATIVE_TOKEN_ALLOWLIST.has(token)) return failure("token_not_allowed", `Token ${token} is not allowlisted`, { token });
  if (COLOR_TOKENS.has(token)) {
    return HEX_COLOR.test(value.trim()) ? value.trim().toUpperCase() : failure("css_policy_violation", `Token ${token} requires a six-digit hex color`, { token });
  }
  if (FONT_TOKENS.has(token)) {
    return REGISTERED_FONTS.has(value.trim()) ? value.trim() : failure("font_not_registered", `Token ${token} requires a registered font value`, { token });
  }
  if (token === "--ol-radius") return clampRadius(value) ?? failure("css_policy_violation", "Radius token requires px, rem, or em", { token });
  if (token === "--ol-r-scale") return clampNumber(value, 0, 1.75) ?? failure("css_policy_violation", "Radius scale must be numeric", { token });
  if (token === "--ol-space-scale") return clampNumber(value, 0.85, 1.15) ?? failure("css_policy_violation", "Spacing scale must be numeric", { token });
  if (token === "--ol-text-scale") return clampNumber(value, 0.9, 1.15) ?? failure("css_policy_violation", "Text scale must be numeric", { token });
  return failure("token_not_allowed", `Token ${token} has no compiler policy`, { token });
}

function isColor(value: string): boolean {
  if (HEX_COLOR.test(value)) return true;
  const rgba = RGBA_COLOR.exec(value);
  if (!rgba) return false;
  return rgba.slice(1, 4).every((component) => Number(component) <= 255)
    && Number(rgba[4]) >= 0 && Number(rgba[4]) <= 1;
}

function balancedFunctions(value: string): boolean {
  let depth = 0;
  for (const character of value) {
    if (character === "(") depth += 1;
    if (character === ")" && --depth < 0) return false;
  }
  return depth === 0;
}

function splitSpacingComponents(value: string): string[] | null {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "(") depth += 1;
    else if (character === ")" && --depth < 0) return null;
    else if (/\s/.test(character) && depth === 0) {
      if (value.slice(start, index).trim()) parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  if (depth !== 0) return null;
  if (value.slice(start).trim()) parts.push(value.slice(start).trim());
  return parts;
}

function splitCalcExpression(value: string): { operands: string[]; operators: string[] } | null {
  const operands: string[] = [];
  const operators: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "(") depth += 1;
    else if (character === ")" && --depth < 0) return null;
    else if (depth === 0 && "+-*/".includes(character)) {
      if ("+-".includes(character) && (!/\s/.test(value[index - 1] ?? "") || !/\s/.test(value[index + 1] ?? ""))) return null;
      const operand = value.slice(start, index).trim();
      if (!operand) return null;
      operands.push(operand);
      operators.push(character);
      start = index + 1;
    }
  }
  const finalOperand = value.slice(start).trim();
  if (depth !== 0 || !finalOperand) return null;
  operands.push(finalOperand);
  return { operands, operators };
}

type SpacingDimension = "length" | "number";
type SpacingMetric = { dimension: SpacingDimension; numericValue?: number };

function addDimensions(left: SpacingMetric, right: SpacingMetric): SpacingMetric | null {
  return left.dimension === right.dimension ? { dimension: left.dimension } : null;
}

function multiplyDimensions(left: SpacingMetric, right: SpacingMetric): SpacingMetric | null {
  if (left.dimension === "length" && right.dimension === "length") return null;
  if (left.dimension === "length" || right.dimension === "length") return { dimension: "length" };
  return { dimension: "number" };
}

function spacingMetric(value: string, depth = 0): SpacingMetric | null {
  if (depth > 2) return null;
  const trimmed = value.trim();
  if (trimmed === "0") return { dimension: "number", numericValue: 0 };
  if (/^(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em)$/.test(trimmed)) return { dimension: "length" };
  if (/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(trimmed)) return { dimension: "number", numericValue: Number(trimmed) };
  const variable = /^var\((--ol-[a-z0-9-]+)\)$/.exec(trimmed);
  if (variable) {
    const token = variable[1];
    if (token === "--ol-radius") return { dimension: "length" };
    if (["--ol-r-scale", "--ol-space-scale", "--ol-text-scale"].includes(token)) return { dimension: "number" };
    return null;
  }
  const fn = /^(calc|clamp)\(([\s\S]*)\)$/i.exec(trimmed);
  if (!fn || !balancedFunctions(trimmed)) return null;
  if (fn[1].toLowerCase() === "clamp") {
    const args = splitTopLevelCommas(fn[2]);
    if (!args || args.length !== 3) return null;
    const metrics = args.map((argument) => spacingMetric(argument, depth + 1));
    if (metrics.some((metric) => !metric || metric.dimension === "number")) return null;
    return { dimension: "length" };
  }
  const expression = splitCalcExpression(fn[2]);
  if (!expression) return null;
  const metrics = expression.operands.map((operand) => spacingMetric(operand, depth + 1));
  if (metrics.some((metric) => !metric)) return null;
  const reducedMetrics = metrics as SpacingMetric[];
  const reducedOperators = [...expression.operators];
  for (let index = 0; index < reducedOperators.length;) {
    const operator = reducedOperators[index];
    if (operator !== "*" && operator !== "/") {
      index += 1;
      continue;
    }
    const left = reducedMetrics[index];
    const right = reducedMetrics[index + 1];
    let combined: SpacingMetric | null;
    if (operator === "*") combined = multiplyDimensions(left, right);
    else combined = right.dimension === "number" && right.numericValue !== undefined && right.numericValue > 0 ? left : null;
    if (!combined) return null;
    reducedMetrics.splice(index, 2, combined);
    reducedOperators.splice(index, 1);
  }
  let result = reducedMetrics[0];
  for (let index = 0; index < reducedOperators.length; index += 1) {
    if (reducedOperators[index] !== "+") return null;
    result = addDimensions(result, reducedMetrics[index + 1])!;
    if (!result) return null;
  }
  return result;
}

function isSpacing(value: string, property: string): boolean {
  const components = splitSpacingComponents(value.trim());
  const maximumComponents = property === "gap" ? 2 : 4;
  return Boolean(components && components.length >= 1 && components.length <= maximumComponents && components.every((component) => {
    if (component === "0") return true;
    const metric = spacingMetric(component);
    return metric?.dimension === "length";
  }));
}

function splitTopLevelCommas(value: string): string[] | null {
  if (!balancedFunctions(value)) return null;
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "(") depth += 1;
    else if (value[index] === ")") depth -= 1;
    else if (value[index] === "," && depth === 0) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

function parsesAsOneDeclaration(property: string, value: string): boolean {
  try {
    const root = parseCss(`a{${property}:${value}}`);
    if (root.nodes.length !== 1 || root.nodes[0].type !== "rule") return false;
    const rule = root.nodes[0] as Rule;
    if (rule.selector !== "a" || rule.nodes?.length !== 1 || rule.nodes[0].type !== "decl") return false;
    const declaration = rule.nodes[0] as Declaration;
    return declaration.prop === property && declaration.value.trim() === value.trim() && !declaration.important;
  } catch {
    return false;
  }
}

function validateDeclaration(hookId: string, property: string, value: string): CompileFailure | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 180 || DANGEROUS_CSS.test(trimmed) || /var\((?!--ol-)/i.test(trimmed) || !parsesAsOneDeclaration(property, trimmed)) {
    return failure("css_policy_violation", `Unsafe CSS value for ${property}`, { hookId, property });
  }
  if (hookId === "icons" && ICON_VALUES[property] && !ICON_VALUES[property].has(trimmed)) {
    return failure("icon_policy_violation", `Icon ${property} must use a registry-derived value`, { hookId, property });
  }
  if (COLOR_PROPERTIES.has(property) && !isColor(trimmed)) return failure("css_policy_violation", `${property} requires a hex or rgba color`, { hookId, property });
  if ((property === "fill" || property === "stroke") && !ICON_VALUES[property].has(trimmed)) return failure("icon_policy_violation", `Icon ${property} is not registered`, { hookId, property });
  if (SPACE_PROPERTIES.has(property) && !isSpacing(trimmed, property)) return failure("css_policy_violation", `${property} requires a bounded length expression`, { hookId, property });
  if (property === "box-shadow") {
    const shadows = trimmed.length <= 240 ? splitTopLevelCommas(trimmed) : null;
    if (!shadows || shadows.length > 4 || shadows.some((shadow) => !shadow.trim())) return failure("css_policy_violation", "Box shadow exceeds compiler bounds", { hookId, property });
  }
  if (property === "text-align" && !new Set(["left", "center", "right", "start", "end"]).has(trimmed)) return failure("css_policy_violation", "Text alignment is not allowlisted", { hookId, property });
  if (property === "font-family" && !REGISTERED_FONTS.has(trimmed)) return failure("font_not_registered", "Font family is not registered", { hookId, property });
  return null;
}

function iconDeclarations(direction: CreativeDirection): Record<string, string> {
  const round = direction.iconography.cornerStyle === "round" || direction.iconography.style.startsWith("rounded_");
  const filled = direction.iconography.style === "rounded_filled";
  return {
    fill: filled ? "currentColor" : "none",
    stroke: "currentColor",
    "stroke-linecap": round ? "round" : direction.iconography.cornerStyle === "soft" ? "butt" : "square",
    "stroke-linejoin": round ? "round" : direction.iconography.cornerStyle === "soft" ? "bevel" : "miter",
    "stroke-width": { light: "1.5", medium: "2", bold: "2.5" }[direction.iconography.strokeWeight],
  };
}

function compileStyleBlock(inventory: SkeletonInventory, direction: CreativeDirection, plan: SkeletonAdaptationPlan): string | CompileFailure {
  const hooks = new Map(inventory.styleHooks.map((hook) => [hook.id, hook]));
  const overrides = new Map<string, Record<string, string>>();
  if (hooks.has("icons")) overrides.set("icons", iconDeclarations(direction));
  for (const override of plan.cssOverride) {
    const hook = hooks.get(override.hookId);
    if (!hook) return failure("unknown_hook", `Unknown style hook ${override.hookId}`, { hookId: override.hookId });
    const declarations = { ...(overrides.get(override.hookId) ?? {}) };
    for (const [property, value] of Object.entries(override.declarations)) {
      if (!hook.allowedProperties.includes(property as never)) return failure("property_not_allowed", `${property} is not allowed for ${override.hookId}`, { hookId: override.hookId, property });
      const violation = validateDeclaration(override.hookId, property, value);
      if (violation) return violation;
      declarations[property] = value.trim();
    }
    overrides.set(override.hookId, declarations);
  }
  const rules: string[] = [];
  for (const hook of inventory.styleHooks) {
    const declarations = overrides.get(hook.id);
    if (!declarations || Object.keys(declarations).length === 0) continue;
    const serialized = Object.entries(declarations).sort(([left], [right]) => left.localeCompare(right)).map(([property, value]) => `${property}:${value}`).join(";");
    rules.push(`${hook.selector}{${serialized}}`);
  }
  return `<style data-openlen-visual-engine="${VISUAL_ENGINE_VERSION}">${rules.join("")}</style>`;
}

function validateContrast(tokens: Readonly<Record<string, string>>): CompileFailure | null {
  const pairs = [
    ["--ol-fg", "--ol-bg", "foreground/background"],
    ["--ol-fg", "--ol-surface", "foreground/surface"],
    ["--ol-accent", "--ol-accent-ink", "accent/accentInk"],
  ] as const;
  for (const [foreground, background, label] of pairs) {
    if (!tokens[foreground] || !tokens[background] || wcagContrast(tokens[foreground], tokens[background]) < 4.5) {
      return failure("contrast_violation", `${label} contrast must be at least 4.5`);
    }
  }
  return null;
}

export function compileSkeletonIdentity(input: CreativeCompileInput): CreativeCompileResult {
  if (!input || typeof input !== "object" || !hasOptionalInputShape(input)) return failure("invalid_input", "Creative compiler optional input is structurally invalid");
  const parsedInventory = SkeletonInventorySchema.safeParse(input.inventory);
  const parsedDirection = CreativeDirectionSchema.safeParse(input.direction);
  const parsedPlan = SkeletonAdaptationPlanSchema.safeParse(input.plan);
  if (!parsedInventory.success || !parsedDirection.success) return failure("invalid_input", "Creative compiler input does not match its bounded contract");
  if (!parsedPlan.success && !hasCompilerPlanShape(input.plan)) return failure("invalid_input", "Creative adaptation plan is structurally invalid");
  const inventory = parsedInventory.data;
  const direction = parsedDirection.data;
  const plan = parsedPlan.success ? parsedPlan.data : input.plan;
  try {
    const rebuilt = buildSkeletonInventory(input.html, inventory.templateId);
    if (!sameInventory(inventory, rebuilt)) return failure("invalid_inventory", "Inventory does not describe the supplied HTML");
    if (iconHookTargetsLogo(input.html, inventory)) return failure("invalid_inventory", "Inventory icon hook overlaps protected logo markup");
  } catch {
    return failure("invalid_inventory", "Inventory could not be validated against the supplied HTML");
  }

  const parsedConstraints = parseExplicitConstraints(input.explicitConstraints);
  if (!parsedConstraints.ok) return parsedConstraints;
  const originalTokens: Record<string, string> = {};
  for (const token of inventory.availableTokens) {
    const value = readThemeTokenFromHtml(input.html, token);
    if (value !== null) originalTokens[token] = value;
  }
  let rawTokens: Record<string, string> = { ...originalTokens, ...directionTokens(direction) };
  rawTokens = mergeTokenTier(rawTokens, plan.tokens);
  rawTokens = mergeTokenTier(rawTokens, input.brand?.accent ? { "--ol-accent": input.brand.accent } : {});
  rawTokens = mergeTokenTier(rawTokens, parsedConstraints.tokens);
  rawTokens = mergeTokenTier(rawTokens, explicitTokens(input.explicitOverrides));
  const availableTokens = new Set(inventory.availableTokens);
  const tokens: Record<string, string> = {};
  for (const [token, rawValue] of Object.entries(rawTokens)) {
    if (!availableTokens.has(token) || !CREATIVE_TOKEN_ALLOWLIST.has(token)) return failure("token_not_allowed", `Token ${token} is not available in this skeleton`, { token });
    const normalized = normalizeToken(token, rawValue);
    if (typeof normalized !== "string") return normalized;
    tokens[token] = normalized;
  }
  const contrastFailure = validateContrast(tokens);
  if (contrastFailure) return contrastFailure;

  const styleBlock = compileStyleBlock(inventory, direction, plan);
  if (typeof styleBlock !== "string") return styleBlock;
  const withoutPreviousBlock = stripVisualEngineStyles(input.html);
  const themedHtml = applyThemeTokensToHtml(withoutPreviousBlock, tokens);
  const html = insertVisualEngineStyle(themedHtml, styleBlock);
  if (!html) return failure("invalid_input", "Creative compilation requires one parseable document head");
  if (!structureIsPreserved(themedHtml, html, { allowedAssetSlots: inventory.assetSlots.map((asset) => asset.slotIndex) })) {
    return failure("structural_violation", "Creative compilation changed protected document structure");
  }
  const mode = input.explicitOverrides?.mode ?? parsedConstraints.mode ?? direction.mode;
  const enforcedConstraints = parsedConstraints.claims.filter((claim) => claim.mode ? claim.mode === mode : Boolean(claim.token && tokens[claim.token] === claim.value)).map((claim) => claim.raw);
  return {
    ok: true,
    html,
    tokens,
    mode,
    enforcedConstraints,
  };
}
