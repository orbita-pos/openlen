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
    if (overrides.mode !== undefined && !new Set(["light", "dark", "cream"]).has(String(overrides.mode))) return false;
    for (const key of ["radiusScale", "spacingScale", "textScale"]) {
      if (overrides[key] !== undefined && (typeof overrides[key] !== "number" || !Number.isFinite(overrides[key]))) return false;
    }
    for (const key of keys.filter((key) => !["mode", "radiusScale", "spacingScale", "textScale"].includes(key))) {
      if (overrides[key] !== undefined && typeof overrides[key] !== "string") return false;
    }
  }
  return true;
}

function elementLooksLikeLogo(element: HTMLElement): boolean {
  for (let current: HTMLElement | null = element; current; current = current.parentNode) {
    const identity = [current.getAttribute("id"), current.getAttribute("class"), current.getAttribute("aria-label"), current.getAttribute("alt"), current.getAttribute("src")].filter(Boolean).join(" ");
    if (/logo/i.test(identity)) return true;
  }
  return false;
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
    background: "--ol-bg", fondo: "--ol-bg", surface: "--ol-surface", superficie: "--ol-surface",
    foreground: "--ol-fg", texto: "--ol-fg", border: "--ol-border", borde: "--ol-border",
    accent: "--ol-accent", acento: "--ol-accent", "accent ink": "--ol-accent-ink",
  };
  for (const raw of constraints ?? []) {
    const constraint = raw.trim();
    if (/^(?:dark mode|modo oscuro)$/i.test(constraint)) {
      mode = "dark";
      claims.push({ raw, mode: "dark" });
      continue;
    }
    const color = /^(background|fondo|surface|superficie|foreground|texto|border|borde|accent|acento|accent ink)\s*:\s*(#[0-9a-f]{6})$/i.exec(constraint);
    if (color) {
      const token = roles[color[1].toLowerCase()];
      const value = color[2].toUpperCase();
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

function isSpacing(value: string): boolean {
  const trimmed = value.trim();
  if (/^-?\d+(?:\.\d+)?(?:px|rem|em)$/.test(trimmed) || trimmed === "0") return true;
  if (!/^(?:calc|clamp)\(/.test(trimmed) || !balancedFunctions(trimmed)) return false;
  if (/var\((?!--ol-)/i.test(trimmed)) return false;
  const withoutVars = trimmed.replace(/var\(--ol-[a-z0-9-]+\)/gi, "0px");
  return /^(?:calc|clamp)\([\d\s.,+*/()%-]*(?:px|rem|em)[\d\s.,+*/()%-]*\)$/.test(withoutVars);
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
  if (SPACE_PROPERTIES.has(property) && !isSpacing(trimmed)) return failure("css_policy_violation", `${property} requires a bounded length expression`, { hookId, property });
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
  if (!/<\/head>/i.test(themedHtml)) return failure("invalid_input", "Creative compilation requires a document head");
  const html = themedHtml.replace(/<\/head>/i, `${styleBlock}</head>`);
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
