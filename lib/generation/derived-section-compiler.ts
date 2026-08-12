import { createHash } from "node:crypto";
import postcss from "postcss";

import {
  DerivedSectionProvenanceSchema,
  DerivedSectionSemanticsSchema,
  type DerivedSectionProvenance,
  type DerivedSectionSemantics,
  type DerivedSectionRejectionCodeSchema,
} from "./derived-section-contracts";
import type { ExtractedTemplateBand } from "./template-section-extractor";
import { fingerprintStructure } from "./structural-fingerprint";
import { sanitizeForPublish } from "@/lib/html-engine";
import { scopeSectionDocument } from "@/lib/sections/scope";
import type { SectionMode, SectionType } from "@/lib/sections/types";
import type { TemplateVisualMetadata } from "@/lib/templates/visual-metadata";
import type { z } from "zod";

export interface RenderValidationInput {
  id: string;
  html: string;
}

export type RenderValidationResult =
  | { ok: false; code: "render_failed" }
  | { ok: true; desktopVisible: boolean; mobileVisible: boolean; mobileOverflow: boolean; score: number };

export interface CompiledDerivedSection {
  id: string;
  html: string;
  type: SectionType;
  mode: SectionMode;
  provenance: DerivedSectionProvenance;
  semantics: DerivedSectionSemantics;
  designTokens: Record<string, string>;
  fonts: string[];
  needsJs: boolean;
  hasPlaceholders: boolean;
  contentHash: string;
  renderScore: number;
  sourceExactHash: string;
}

export type CompileDerivedSectionResult =
  | { ok: true; section: CompiledDerivedSection }
  | { ok: false; code: z.infer<typeof DerivedSectionRejectionCodeSchema> };

interface CompileContext {
  templateHead: string;
  metadata: TemplateVisualMetadata | null;
  mode?: SectionMode;
}

interface CompileDeps {
  validateRender(input: RenderValidationInput): Promise<RenderValidationResult>;
  validateAssets(html: string): Promise<boolean>;
  sanitize?: (html: string) => { html: string | null };
}

const ROLE_TOKENS: readonly [SectionType, RegExp][] = [
  ["navbar", /\b(nav|navbar|navigation|menu)\b/],
  ["hero", /\b(hero|top|inicio|masthead|portada)\b/],
  ["gallery", /\b(gallery|galeria|portfolio|capturas|trabajos)\b/],
  ["features", /\b(features|benefits|servicios|programas|activities|actividades)\b/],
  ["how-it-works", /\b(how[-_ ]?it[-_ ]?works|steps|proceso|ritual)\b/],
  ["testimonials", /\b(testimonials|reviews|resenas|alumni)\b/],
  ["pricing", /\b(pricing|precios|precio|planes|entradas)\b/],
  ["faq", /\b(faq|preguntas)\b/],
  ["about", /\b(about|acerca|historia|universo|experiencia)\b/],
  ["team", /\b(team|equipo|instructor|ponentes|voces)\b/],
  ["contact", /\b(contact|contacto|lugar)\b/],
  ["cta", /\b(cta|wishlist|comprar|enroll|suscrib)\b/],
  ["stats", /\b(stats|metrics|metricas|impacto)\b/],
  ["integrations", /\b(integrations|integraciones|plataformas)\b/],
  ["logos", /\b(logos|partners|clientes|marcas)\b/],
];

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function hash12(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 12);
}

function completeDocument(fragment: string): string {
  return `<!doctype html><html><head></head><body>${fragment}</body></html>`;
}

function roleFor(band: ExtractedTemplateBand): SectionType | null {
  if (band.rootTag === "nav") return "navbar";
  if (band.rootTag === "footer") return "footer";
  const tokens = band.sourceIds.join(" ").toLowerCase();
  for (const [role, pattern] of ROLE_TOKENS) if (pattern.test(tokens)) return role;
  if (band.rootTag === "header") return "hero";
  return null;
}

function semanticsFor(role: SectionType, metadata: TemplateVisualMetadata | null): DerivedSectionSemantics {
  const values = new Set([
    ...(metadata?.domains ?? []),
    ...(metadata?.visualArchetypes ?? []),
    ...(metadata?.visualSignals ?? []),
    ...(metadata?.emotionalRegisters ?? []),
  ]);
  const domains: DerivedSectionSemantics["domains"] = [];
  if ([...values].some((value) => /child|creative|color|play/i.test(value))) domains.push("children_creativity");
  if ([...values].some((value) => /horror|terror/i.test(value))) domains.push("entertainment_horror");
  if ([...values].some((value) => /school|education/i.test(value))) domains.push("education");
  if ([...values].some((value) => /cook|food|recipe/i.test(value))) domains.push("cooking");
  if ([...values].some((value) => /hotel|hospitality|travel/i.test(value))) domains.push("hospitality");
  if ([...values].some((value) => /product|commerce|shop/i.test(value))) domains.push("physical_product");
  if ([...values].some((value) => /saas|dashboard|software/i.test(value))) domains.push("saas");

  const layouts: DerivedSectionSemantics["layoutArchetypes"] = [];
  if ([...values].some((value) => /editorial/i.test(value))) layouts.push("editorial");
  if ([...values].some((value) => /gallery|grid/i.test(value))) layouts.push("grid");
  if ([...values].some((value) => /split|media/i.test(value))) layouts.push("media_split");
  if (layouts.length === 0) layouts.push(role === "gallery" ? "gallery" : "centered");

  const audiences = (metadata?.audiences ?? []).flatMap((value): DerivedSectionSemantics["audiences"] => {
    if (/child/i.test(value)) return ["children"];
    if (/famil/i.test(value)) return ["families"];
    if (/student/i.test(value)) return ["students"];
    if (/travel/i.test(value)) return ["travelers"];
    if (/shop/i.test(value)) return ["shoppers"];
    return [];
  });
  const moods = (metadata?.emotionalRegisters ?? []).flatMap((value): DerivedSectionSemantics["moods"] => {
    if (/play/i.test(value)) return ["playful"];
    if (/warm/i.test(value)) return ["warm"];
    if (/cinematic/i.test(value)) return ["cinematic"];
    if (/elegant/i.test(value)) return ["elegant"];
    return [];
  });
  const negativeSignals = (metadata?.negativeTags ?? []).filter((value) => [
    "dashboard", "analytics", "software_mockup", "course_ui", "corporate", "developer_tool", "documentation", "game_ui", "terminal",
  ].includes(value)) as DerivedSectionSemantics["negativeSignals"];
  return DerivedSectionSemanticsSchema.parse({
    schemaVersion: "derived-section-semantics/1.0",
    role,
    layoutArchetypes: [...new Set(layouts)],
    domains: [...new Set(domains)],
    audiences: [...new Set(audiences)],
    moods: [...new Set(moods)],
    negativeSignals: [...new Set(negativeSignals)],
  });
}

function containsUnsafeScript(html: string): boolean {
  return /<script\b(?![^>]*\btype\s*=\s*["']application\/(?:ld\+json|json)["'])/i.test(html);
}

function containsContractViolation(html: string): boolean {
  return /\s(?:on[a-z]+)\s*=/i.test(html)
    || /<form\b[^>]*\baction\s*=\s*(?:"[^"]+"|'[^']+'|[^\s>]+)/i.test(html)
    || /<(?:html|head|body)\b/i.test(html);
}

const HOST_CUSTOM_PROPERTIES = new Set([
  "--accent", "--bg", "--surface", "--ink", "--ink-2", "--muted", "--line",
  "--radius", "--font-display", "--font-body", "--ol-accent-r",
]);

function attributeTokens(html: string, name: "class" | "id"): Set<string> {
  const values = new Set<string>();
  const pattern = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "gi");
  for (const match of html.matchAll(pattern)) {
    for (const token of (match[1] ?? match[2] ?? "").split(/\s+/)) if (token) values.add(token);
  }
  return values;
}

function selectorIsRelevant(selector: string, html: string, classes: Set<string>, ids: Set<string>): boolean {
  if (/(?:^|[\s,>+~])(?::root|html|body|\*)(?:$|[\s,>+~.:#]|\[)/i.test(selector)) return true;
  const selectorClasses = [...selector.matchAll(/\.([a-zA-Z_][\w-]*)/g)].map((match) => match[1]);
  if (selectorClasses.length > 0) return selectorClasses.some((value) => classes.has(value));
  const selectorIds = [...selector.matchAll(/#([a-zA-Z_][\w-]*)/g)].map((match) => match[1]);
  if (selectorIds.length > 0) return selectorIds.some((value) => ids.has(value));
  const tags = [...selector.matchAll(/(?:^|[\s,>+~])([a-z][a-z0-9-]*)/gi)].map((match) => match[1]);
  return tags.some((tag) => new RegExp(`<${tag}\\b`, "i").test(html));
}

function dependencyHead(templateHead: string, fragmentHtml: string): string | null {
  const css = [...templateHead.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((match) => match[1])
    .join("\n");
  let root;
  try {
    root = postcss.parse(css);
  } catch {
    return null;
  }
  const classes = attributeTokens(fragmentHtml, "class");
  const ids = attributeTokens(fragmentHtml, "id");
  root.walkRules((rule) => {
    const parent = rule.parent;
    if (parent?.type === "atrule" && /keyframes$/i.test(parent.name)) return;
    if (!rule.selectors.some((selector) => selectorIsRelevant(selector, fragmentHtml, classes, ids))) rule.remove();
  });
  root.walkAtRules((atRule) => {
    if (!/^(?:-\w+-)?(?:keyframes|font-face)$/i.test(atRule.name) && atRule.nodes?.length === 0) atRule.remove();
  });
  const declared = new Set<string>();
  const used = new Set<string>();
  root.walkDecls((declaration) => {
    if (declaration.prop.startsWith("--")) declared.add(declaration.prop);
    for (const match of declaration.value.matchAll(/var\(\s*(--[a-z0-9-_]+)/gi)) used.add(match[1]);
  });
  if ([...used].some((name) => !declared.has(name) && !HOST_CUSTOM_PROPERTIES.has(name))) return null;
  const fontLinks = [...templateHead.matchAll(/<link\b[^>]*\bhref\s*=\s*(?:"https:\/\/fonts\.(?:googleapis|gstatic)\.com\/[^"]+"|'https:\/\/fonts\.(?:googleapis|gstatic)\.com\/[^']+')[^>]*>/gi)]
    .map((match) => match[0]);
  return `${fontLinks.join("\n")}<style>${root.toString()}</style>`;
}

export async function compileDerivedSection(
  band: ExtractedTemplateBand,
  context: CompileContext,
  deps: CompileDeps,
): Promise<CompileDerivedSectionResult> {
  if (containsUnsafeScript(band.sourceHtml)) return { ok: false, code: "unsafe_script" };
  if (containsContractViolation(band.sourceHtml)) return { ok: false, code: "contract_violation" };
  const role = roleFor(band);
  if (!role) return { ok: false, code: "ambiguous_semantics" };
  const suffix = band.sourceHash.replace(/^sha256:/, "").slice(0, 12);
  const id = `derived-${role}-${band.templateId}-${band.ordinal}-${suffix}`.slice(0, 128);
  const requiredHead = dependencyHead(context.templateHead, band.sourceHtml);
  if (requiredHead === null) return { ok: false, code: "dependency_unavailable" };
  let scoped;
  try {
    scoped = scopeSectionDocument(
      `<!doctype html><html><head>${requiredHead}</head><body>${band.sourceHtml}</body></html>`,
      id,
    );
  } catch {
    return { ok: false, code: "invalid_fragment" };
  }
  if (!(await deps.validateAssets(scoped.html))) return { ok: false, code: "asset_invalid" };
  const before = fingerprintStructure(completeDocument(scoped.html));
  const sanitized = (deps.sanitize ?? sanitizeForPublish)(scoped.html);
  if (!sanitized.html || fingerprintStructure(completeDocument(sanitized.html)) !== before) {
    return { ok: false, code: "sanitize_mismatch" };
  }
  const rendered = await deps.validateRender({ id, html: sanitized.html });
  if (!rendered.ok) return { ok: false, code: "render_failed" };
  if (!rendered.desktopVisible || !rendered.mobileVisible) return { ok: false, code: "empty_geometry" };
  if (rendered.mobileOverflow) return { ok: false, code: "mobile_overflow" };
  const semantics = semanticsFor(role, context.metadata);
  const provenance = DerivedSectionProvenanceSchema.parse({
    schemaVersion: "derived-section-provenance/1.0",
    sourceTemplateId: band.templateId,
    sourceTemplateHash: band.templateContentHash,
    sourceBandOrdinal: band.ordinal,
    extractionVersion: "template-band-extractor/1.0",
    sourceHash: band.sourceHash,
    structuralFingerprint: sha256(fingerprintStructure(completeDocument(band.sourceHtml))),
  });
  return {
    ok: true,
    section: {
      id,
      html: sanitized.html,
      type: role,
      mode: context.mode ?? "light",
      provenance,
      semantics,
      designTokens: scoped.designTokens,
      fonts: scoped.fonts,
      needsJs: false,
      hasPlaceholders: /data-openlen-asset-slot/i.test(sanitized.html),
      contentHash: hash12(sanitized.html),
      renderScore: rendered.score,
      sourceExactHash: band.sourceHash,
    },
  };
}

export function dedupeDerivedSections(rows: readonly CompiledDerivedSection[]): {
  accepted: readonly CompiledDerivedSection[];
  duplicates: readonly { rejectedId: string; representativeId: string; reason: "exact" | "structural" }[];
} {
  const ranked = [...rows].sort((left, right) => right.renderScore - left.renderScore || left.id.localeCompare(right.id));
  const accepted: CompiledDerivedSection[] = [];
  const duplicates: { rejectedId: string; representativeId: string; reason: "exact" | "structural" }[] = [];
  for (const row of ranked) {
    const exact = accepted.find((candidate) => candidate.sourceExactHash === row.sourceExactHash);
    if (exact) {
      duplicates.push({ rejectedId: row.id, representativeId: exact.id, reason: "exact" });
      continue;
    }
    const structural = accepted.find((candidate) =>
      candidate.provenance.structuralFingerprint === row.provenance.structuralFingerprint && candidate.type === row.type);
    if (structural) {
      duplicates.push({ rejectedId: row.id, representativeId: structural.id, reason: "structural" });
      continue;
    }
    accepted.push(row);
  }
  return { accepted: Object.freeze(accepted), duplicates: Object.freeze(duplicates) };
}
