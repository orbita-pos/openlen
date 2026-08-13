import { z } from "zod";

import { TaxonomySlugSchema } from "./contracts";
import { SectionPlanRowSchema } from "./section-composition-contracts";

const NODE_ID = /^[a-z][a-z0-9_-]{0,63}$/;
const COPY_KEY = /^[a-z][a-z0-9_.-]{0,79}$/;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const CONTENT_HASH = /^[a-f0-9]{12}$/;

const NodeIdSchema = z.string().regex(NODE_ID);
const CopyKeySchema = z.string().regex(COPY_KEY);
const SpaceSchema = z.enum(["none", "xs", "sm", "md", "lg", "xl", "2xl"]);
const SizeSchema = z.enum(["xs", "sm", "md", "lg", "xl", "2xl", "display"]);
const ColorRoleSchema = z.enum(["background", "surface", "surface_alt", "ink", "muted", "accent", "accent_ink", "line"]);
const AlignSchema = z.enum(["start", "center", "end", "stretch"]);
const TransformSchema = z.enum(["none", "tilt_left", "tilt_right", "lift", "sink", "scale_up"]);
const RadiusSchema = z.enum(["none", "sm", "md", "lg", "pill", "organic"]);

const BaseCopyShape = {
  kind: z.literal("copy"),
  id: NodeIdSchema,
  tone: z.enum(["default", "quiet", "strong", "accent", "inverse"]),
  size: SizeSchema,
  color: ColorRoleSchema,
  align: z.enum(["start", "center", "end"]),
} as const;

const SingleCopyNodeSchema = z.object({
  ...BaseCopyShape,
  variant: z.enum(["heading", "body", "quote", "stat", "badge", "action"]),
  copyKey: CopyKeySchema,
  destination: z.enum(["none", "primary", "secondary", "contact"]).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.variant === "action" && value.destination === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["destination"], message: "actions require a repository destination" });
  }
  if (value.variant !== "action" && value.destination !== undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["destination"], message: "only actions have destinations" });
  }
});

const ListCopyNodeSchema = z.object({
  ...BaseCopyShape,
  variant: z.literal("list"),
  copyKeys: z.array(CopyKeySchema).min(1).max(8),
}).strict();

const CopyNodeSchema = z.union([SingleCopyNodeSchema, ListCopyNodeSchema]);

const MediaNodeSchema = z.object({
  kind: z.literal("media"),
  id: NodeIdSchema,
  slotIndex: z.number().int().min(0).max(11),
  aspect: z.enum(["square", "portrait", "landscape", "cinematic", "auto"]),
  fit: z.enum(["cover", "contain"]),
  treatment: z.enum(["plain", "framed", "bleed", "cutout", "film", "paper"]),
  radius: RadiusSchema,
  transform: TransformSchema,
  altCopyKey: CopyKeySchema.optional(),
}).strict();

const DecorationNodeSchema = z.object({
  kind: z.literal("decoration"),
  id: NodeIdSchema,
  decoration: z.enum(["shape", "divider", "texture"]),
  shape: z.enum(["circle", "square", "blob", "star", "line", "grain", "dots", "stripes"]),
  color: ColorRoleSchema,
  size: SizeSchema,
  transform: TransformSchema,
  blend: z.enum(["normal", "multiply", "screen", "overlay"]),
  opacity: z.enum(["faint", "soft", "solid"]),
}).strict();

const LayoutFields = {
  kind: z.literal("layout"),
  id: NodeIdSchema,
  preset: z.enum(["stack", "flex", "grid", "split", "collage", "bento", "layered"]),
  gap: SpaceSchema,
  padding: SpaceSchema,
  width: z.enum(["narrow", "content", "wide", "full"]),
  align: AlignSchema,
  justify: z.enum(["start", "center", "end", "between"]),
  columns: z.enum(["one", "two", "three", "four", "asymmetric_left", "asymmetric_right"]),
  color: ColorRoleSchema,
  radius: RadiusSchema,
  border: z.enum(["none", "hairline", "strong", "dashed"]),
  transform: TransformSchema,
  blend: z.enum(["normal", "multiply", "screen", "overlay"]),
} as const;

const LeafNodeSchema = z.union([CopyNodeSchema, MediaNodeSchema, DecorationNodeSchema]);

function nodeSchema(depthRemaining: number): z.ZodTypeAny {
  if (depthRemaining <= 1) return LeafNodeSchema;
  const LayoutNodeSchema = z.object({
    ...LayoutFields,
    children: z.array(nodeSchema(depthRemaining - 1)).min(1).max(63),
  }).strict();
  return z.union([LayoutNodeSchema, LeafNodeSchema]);
}

const ResponsiveOverrideSchema = z.object({
  nodeId: NodeIdSchema,
  preset: LayoutFields.preset,
  columns: LayoutFields.columns,
  gap: SpaceSchema,
  padding: SpaceSchema,
  hidden: z.boolean(),
}).strict();

export const ResponsiveProgramSchema = z.object({
  mobile: z.array(ResponsiveOverrideSchema).max(64),
}).strict();

export const MotionPresetSchema = z.object({
  nodeId: NodeIdSchema,
  preset: z.enum(["fade_up", "reveal", "drift", "pulse", "marquee", "stagger"]),
  intensity: z.enum(["subtle", "medium", "bold"]),
  delay: z.enum(["none", "short", "medium", "long"]),
}).strict();

interface VisitedProgram {
  nodeIds: Set<string>;
  layoutIds: Set<string>;
  mediaSlots: Set<number>;
  copyKeys: string[];
  nodeCount: number;
  mediaCount: number;
}

function visitProgramNode(node: ExpressiveNode, state: VisitedProgram, ctx: z.RefinementCtx): void {
  state.nodeCount += 1;
  if (state.nodeIds.has(node.id)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["root"], message: "node IDs must be unique" });
  }
  state.nodeIds.add(node.id);
  if (node.kind === "layout") {
    state.layoutIds.add(node.id);
    node.children.forEach((child) => visitProgramNode(child, state, ctx));
    return;
  }
  if (node.kind === "media") {
    state.mediaCount += 1;
    if (state.mediaSlots.has(node.slotIndex)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["root"], message: "media slots must be unique" });
    }
    state.mediaSlots.add(node.slotIndex);
    if (node.altCopyKey) state.copyKeys.push(node.altCopyKey);
    return;
  }
  if (node.kind === "copy") {
    state.copyKeys.push(...("copyKey" in node ? [node.copyKey] : node.copyKeys));
  }
}

const ProgramShapeSchema = z.object({
  schemaVersion: z.literal("expressive-section-program/1.0"),
  role: SectionPlanRowSchema.shape.requestedRole,
  root: nodeSchema(5),
  responsive: ResponsiveProgramSchema,
  motion: z.array(MotionPresetSchema).max(16),
}).strict();

export const ExpressiveSectionProgramSchema = ProgramShapeSchema.superRefine((value, ctx) => {
  const state: VisitedProgram = {
    nodeIds: new Set(), layoutIds: new Set(), mediaSlots: new Set(), copyKeys: [], nodeCount: 0, mediaCount: 0,
  };
  visitProgramNode(value.root as ExpressiveNode, state, ctx);
  if (state.nodeCount > 64) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["root"], message: "program exceeds 64 nodes" });
  if (state.mediaCount > 12) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["root"], message: "program exceeds 12 media nodes" });
  const mobileIds = new Set<string>();
  value.responsive.mobile.forEach((override, index) => {
    if (!state.layoutIds.has(override.nodeId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["responsive", "mobile", index, "nodeId"], message: "mobile overrides target layout nodes only" });
    }
    if (mobileIds.has(override.nodeId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["responsive", "mobile", index, "nodeId"], message: "mobile overrides must be unique" });
    }
    mobileIds.add(override.nodeId);
  });
  const motionIds = new Set<string>();
  value.motion.forEach((motion, index) => {
    if (!state.nodeIds.has(motion.nodeId) || motionIds.has(motion.nodeId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["motion", index, "nodeId"], message: "motion targets must exist and be unique" });
    }
    motionIds.add(motion.nodeId);
  });
});

const ProvenanceBaseSchema = z.object({
  schemaVersion: z.literal("section-decision-provenance/1.0"),
  usefulTraits: z.array(TaxonomySlugSchema).max(8).superRefine((values, ctx) => {
    if (new Set(values).size !== values.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "useful traits must be unique" });
  }),
});

const GenerateProvenanceSchema = ProvenanceBaseSchema.extend({
  action: z.literal("generate"),
  candidateId: z.null(),
  sourceTemplateId: z.null(),
  sourceBandOrdinal: z.null(),
  sourceContentHash: z.null(),
  sourceStructuralFingerprint: z.null(),
}).strict();

const DonorProvenanceSchema = ProvenanceBaseSchema.extend({
  action: z.enum(["reuse", "rebuild"]),
  candidateId: z.string().min(1).max(128).regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/),
  sourceTemplateId: z.string().min(1).max(128).regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/).nullable(),
  sourceBandOrdinal: z.number().int().min(0).max(127).nullable(),
  sourceContentHash: z.string().regex(CONTENT_HASH),
  sourceStructuralFingerprint: z.string().regex(SHA256),
}).strict().superRefine((value, ctx) => {
  if ((value.sourceTemplateId === null) !== (value.sourceBandOrdinal === null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sourceTemplateId"], message: "template provenance must be paired" });
  }
});

export const SectionDecisionProvenanceSchema = z.union([GenerateProvenanceSchema, DonorProvenanceSchema]);

export type LayoutPreset = z.infer<typeof LayoutFields.preset>;
export type CopyNode = z.infer<typeof CopyNodeSchema>;
export type MediaNode = z.infer<typeof MediaNodeSchema>;
export type DecorationNode = z.infer<typeof DecorationNodeSchema>;
export interface LayoutNode {
  readonly kind: "layout";
  readonly id: string;
  readonly preset: z.infer<typeof LayoutFields.preset>;
  readonly children: readonly ExpressiveNode[];
  readonly gap: z.infer<typeof SpaceSchema>;
  readonly padding: z.infer<typeof SpaceSchema>;
  readonly width: z.infer<typeof LayoutFields.width>;
  readonly align: z.infer<typeof AlignSchema>;
  readonly justify: z.infer<typeof LayoutFields.justify>;
  readonly columns: z.infer<typeof LayoutFields.columns>;
  readonly color: z.infer<typeof ColorRoleSchema>;
  readonly radius: z.infer<typeof RadiusSchema>;
  readonly border: z.infer<typeof LayoutFields.border>;
  readonly transform: z.infer<typeof TransformSchema>;
  readonly blend: z.infer<typeof LayoutFields.blend>;
}
export type ExpressiveNode = LayoutNode | CopyNode | MediaNode | DecorationNode;
export type ResponsiveProgram = z.infer<typeof ResponsiveProgramSchema>;
export type MotionPreset = z.infer<typeof MotionPresetSchema>;
export interface ExpressiveSectionProgram {
  readonly schemaVersion: "expressive-section-program/1.0";
  readonly role: z.infer<typeof SectionPlanRowSchema.shape.requestedRole>;
  readonly root: ExpressiveNode;
  readonly responsive: ResponsiveProgram;
  readonly motion: readonly MotionPreset[];
}
export type SectionDecisionProvenance = z.infer<typeof SectionDecisionProvenanceSchema>;

export type ValidateExpressiveSectionProgramResult =
  | { readonly ok: true; readonly program: ExpressiveSectionProgram }
  | { readonly ok: false; readonly code: "invalid_program" | "copy_key_not_allowed" | "asset_slot_not_allowed" };

export function validateExpressiveSectionProgram(
  input: unknown,
  allowed: { readonly allowedCopyKeys: readonly string[]; readonly allowedAssetSlots: readonly number[] },
): ValidateExpressiveSectionProgramResult {
  const parsed = ExpressiveSectionProgramSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid_program" };
  const copyKeys = new Set(allowed.allowedCopyKeys);
  const assetSlots = new Set(allowed.allowedAssetSlots);
  let copyAllowed = true;
  let assetAllowed = true;
  const visit = (node: ExpressiveNode): void => {
    if (node.kind === "layout") return node.children.forEach(visit);
    if (node.kind === "media") {
      if (!assetSlots.has(node.slotIndex)) assetAllowed = false;
      if (node.altCopyKey && !copyKeys.has(node.altCopyKey)) copyAllowed = false;
      return;
    }
    if (node.kind === "copy") {
      const referenced = "copyKey" in node ? [node.copyKey] : node.copyKeys;
      if (referenced.some((key) => !copyKeys.has(key))) copyAllowed = false;
    }
  };
  visit(parsed.data.root as ExpressiveNode);
  if (!copyAllowed) return { ok: false, code: "copy_key_not_allowed" };
  if (!assetAllowed) return { ok: false, code: "asset_slot_not_allowed" };
  return { ok: true, program: parsed.data as ExpressiveSectionProgram };
}
