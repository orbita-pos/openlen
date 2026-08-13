import { parse, NodeType, type HTMLElement, type Node } from "node-html-parser";
import { z } from "zod";

import type { FireworksJsonClient } from "../ai/fireworks-client";
import type { FireworksJsonResult } from "../ai/fireworks-contracts";
import { sha256 } from "./content-hash";
import { ExpressiveSectionProgramSchema, validateExpressiveSectionProgram, type ExpressiveSectionProgram } from "./expressive-section-contracts";
import { reasoningEffortFor } from "./fable-model-policy";
import { SectionPlanRowSchema } from "./section-composition-contracts";

const PROMPT_VERSION = "glm-section-program-prompt/1.0" as const;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SECTION_ID = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const COPY_KEY = /^[a-z][a-z0-9_.-]{0,79}$/;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const CONTENT_HASH = /^[a-f0-9]{12}$/;
const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const SAFE_TAGS = new Set(["nav", "header", "section", "footer", "main", "aside", "article", "div", "span", "h1", "h2", "h3", "h4", "p", "strong", "em", "small", "blockquote", "ul", "ol", "li", "figure", "figcaption", "picture", "img", "button", "a", "hr"]);

const DirectionSchema = z.object({
  rhythm: z.enum(["editorial", "cinematic", "playful", "immersive", "conversion", "storytelling"]),
  requiredSignals: z.array(z.string().min(1).max(80).regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/)).max(12),
  forbiddenSignals: z.array(z.string().min(1).max(80).regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/)).max(12),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.requiredSignals).size !== value.requiredSignals.length || new Set(value.forbiddenSignals).size !== value.forbiddenSignals.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "signals must be unique" });
  }
  const forbidden = new Set(value.forbiddenSignals);
  if (value.requiredSignals.some((signal) => forbidden.has(signal))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "signals must be disjoint" });
  }
});

const AssetSlotSchema = z.object({
  slotIndex: z.number().int().min(0).max(11),
  mediaType: z.enum(["photo", "illustration", "texture"]),
}).strict();

const BaseRequestShape = {
  requestId: z.string().regex(REQUEST_ID),
  ordinal: z.number().int().min(0).max(31),
  role: SectionPlanRowSchema.shape.requestedRole,
  direction: DirectionSchema,
  copyKeys: z.array(z.string().regex(COPY_KEY)).max(64),
  assetSlots: z.array(AssetSlotSchema).max(12),
} as const;

const InspirationSchema = z.object({
  candidateId: z.string().min(1).max(128).regex(SECTION_ID),
  sourceTemplateId: z.string().min(1).max(128).regex(SECTION_ID).nullable(),
  sourceBandOrdinal: z.number().int().min(0).max(127).nullable(),
  sourceContentHash: z.string().regex(CONTENT_HASH),
  sourceStructuralFingerprint: z.string().regex(SHA256),
  usefulTraits: z.array(z.string().min(1).max(80).regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/)).max(8),
  verifiedFragmentHtml: z.string().min(1).max(128 * 1024),
}).strict().superRefine((value, ctx) => {
  if ((value.sourceTemplateId === null) !== (value.sourceBandOrdinal === null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sourceTemplateId"], message: "template provenance must be paired" });
  }
  if (new Set(value.usefulTraits).size !== value.usefulTraits.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["usefulTraits"], message: "traits must be unique" });
  }
});

const GenerateRequestSchema = z.object({ ...BaseRequestShape, mode: z.literal("generate") }).strict();
const RebuildRequestSchema = z.object({ ...BaseRequestShape, mode: z.literal("rebuild"), inspiration: InspirationSchema }).strict();
export const GlmSectionProgramRequestSchema = z.discriminatedUnion("mode", [GenerateRequestSchema, RebuildRequestSchema]).superRefine((value, ctx) => {
  if (new Set(value.copyKeys).size !== value.copyKeys.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["copyKeys"], message: "copy keys must be unique" });
  if (new Set(value.assetSlots.map((slot) => slot.slotIndex)).size !== value.assetSlots.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["assetSlots"], message: "asset slots must be unique" });
});

export type GlmSectionProgramRequest = z.infer<typeof GlmSectionProgramRequestSchema>;

type GatewayFailure = Extract<FireworksJsonResult<never>, { ok: false }>;
export type GlmSectionProgramProviderResult =
  | { readonly ok: false; readonly code: "invalid_input"; readonly promptVersion: typeof PROMPT_VERSION }
  | (GatewayFailure & { readonly promptVersion: typeof PROMPT_VERSION })
  | {
      readonly ok: true;
      readonly program: ExpressiveSectionProgram;
      readonly modelId: string;
      readonly promptVersion: typeof PROMPT_VERSION;
      readonly usage: Extract<FireworksJsonResult<unknown>, { ok: true }>["usage"];
      readonly durationMs: number;
      readonly attempts: 1 | 2;
    };

export interface GlmSectionProgramProvider {
  generate(request: GlmSectionProgramRequest): Promise<GlmSectionProgramProviderResult>;
}

interface Options {
  readonly client: FireworksJsonClient;
}

interface FragmentStructure {
  readonly fragment: string;
  readonly rootTag: string;
  readonly nodeCount: number;
  readonly maxDepth: number;
}

function contentHash(html: string): string {
  return sha256(html).replace(/^sha256:/, "").slice(0, 12);
}

function elementChildren(node: Node): HTMLElement[] {
  return node.childNodes.filter((child): child is HTMLElement => child.nodeType === NodeType.ELEMENT_NODE);
}

function safeTag(element: HTMLElement): string {
  const tag = element.rawTagName.toLowerCase();
  return SAFE_TAGS.has(tag) ? tag : "div";
}

function serializeStructure(element: HTMLElement, state: { nodeCount: number; maxDepth: number }, depth: number): string {
  state.nodeCount += 1;
  state.maxDepth = Math.max(state.maxDepth, depth);
  const tag = safeTag(element);
  if (VOID_TAGS.has(tag)) return `<${tag}>`;
  return `<${tag}>${elementChildren(element).map((child) => serializeStructure(child, state, depth + 1)).join("")}</${tag}>`;
}

function verifiedStructure(input: z.infer<typeof InspirationSchema>): FragmentStructure | null {
  const html = input.verifiedFragmentHtml;
  if (/<!doctype|<(?:html|head|body|script|iframe|object|embed|template)\b|\son[a-z]+\s*=/i.test(html)) return null;
  if (contentHash(html) !== input.sourceContentHash) return null;
  let parsed;
  try { parsed = parse(html); } catch { return null; }
  const roots = elementChildren(parsed).filter((element) => element.rawTagName.toLowerCase() !== "style" && element.rawTagName.toLowerCase() !== "link");
  if (roots.length !== 1 || roots[0].getAttribute("data-sec") !== input.candidateId) return null;
  if (parsed.querySelectorAll(`[data-sec="${input.candidateId}"]`).length !== 1) return null;
  const state = { nodeCount: 0, maxDepth: 0 };
  const fragment = serializeStructure(roots[0], state, 1);
  if (state.nodeCount < 1 || state.nodeCount > 64 || state.maxDepth > 5) return null;
  return { fragment, rootTag: safeTag(roots[0]), nodeCount: state.nodeCount, maxDepth: state.maxDepth };
}

function userPayload(request: GlmSectionProgramRequest): Record<string, unknown> | null {
  const base = {
    schemaVersion: "glm-section-program-input/1.0",
    mode: request.mode,
    ordinal: request.ordinal,
    role: request.role,
    direction: request.direction,
    copyKeys: request.copyKeys,
    assetSlots: request.assetSlots,
  };
  if (request.mode === "generate") return base;
  const structure = verifiedStructure(request.inspiration);
  if (!structure) return null;
  return {
    ...base,
    inspiration: {
      candidateId: request.inspiration.candidateId,
      sourceTemplateId: request.inspiration.sourceTemplateId,
      sourceBandOrdinal: request.inspiration.sourceBandOrdinal,
      sourceContentHash: request.inspiration.sourceContentHash,
      sourceStructuralFingerprint: request.inspiration.sourceStructuralFingerprint,
      usefulTraits: request.inspiration.usefulTraits,
      fragment: structure.fragment,
      structure: { rootTag: structure.rootTag, nodeCount: structure.nodeCount, maxDepth: structure.maxDepth },
    },
  };
}

export function createGlmSectionProgramProvider(options: Options): GlmSectionProgramProvider {
  if (!options?.client) throw new Error("Fireworks client with PageBudget is required");
  return {
    async generate(request) {
      const parsed = GlmSectionProgramRequestSchema.safeParse(request);
      if (!parsed.success) return { ok: false, code: "invalid_input", promptVersion: PROMPT_VERSION };
      const payload = userPayload(parsed.data);
      if (!payload) return { ok: false, code: "invalid_input", promptVersion: PROMPT_VERSION };
      const result = await options.client.request({
        role: "designer",
        reasoningEffort: reasoningEffortFor("designer", "initial_section_program"),
        requestId: parsed.data.requestId,
        maxOutputTokens: 8192,
        responseSchema: ExpressiveSectionProgramSchema,
        messages: [
          {
            role: "system",
            content: "Return exactly one expressive-section-program/1.0 AST. Use only supplied roles, copy-key names, asset-slot indexes, enums, responsive overrides, and motion presets. Never return literal copy, URLs, markup, styles, scripts, selectors, event names, imports, or executable text.",
          },
          { role: "user", content: JSON.stringify(payload) },
        ],
      });
      if (!result.ok) return { ...result, promptVersion: PROMPT_VERSION };
      const validated = validateExpressiveSectionProgram(result.value, {
        allowedCopyKeys: parsed.data.copyKeys,
        allowedAssetSlots: parsed.data.assetSlots.map((slot) => slot.slotIndex),
      });
      if (!validated.ok || validated.program.role !== parsed.data.role) {
        return {
          ok: false,
          code: "schema",
          modelId: result.modelId,
          usage: result.usage,
          durationMs: result.durationMs,
          attempts: result.attempts,
          promptVersion: PROMPT_VERSION,
        };
      }
      return {
        ok: true,
        program: validated.program,
        modelId: result.modelId,
        usage: result.usage,
        durationMs: result.durationMs,
        attempts: result.attempts,
        promptVersion: PROMPT_VERSION,
      };
    },
  };
}
