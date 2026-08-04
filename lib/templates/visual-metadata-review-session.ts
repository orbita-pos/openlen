import { z } from "zod";
import {
  VISUAL_METADATA_ARTIFACT_VERSION,
  type SuggestionArtifactRow,
} from "./visual-metadata-review-workflow";
import {
  TEMPLATE_VISUAL_METADATA_SCHEMA_VERSION,
  TemplateVisualMetadataSchema,
  type TemplateVisualMetadata,
} from "./visual-metadata";

export const REVIEW_SESSION_VERSION = "template-visual-metadata-review-session/1.0" as const;
export const REVIEW_EVENT_VERSION = "template-visual-metadata-review-event/1.0" as const;
export const REVIEW_AUDIT_VERSION = "template-visual-metadata-review-audit/1.0" as const;

const StrictTemplateVisualMetadataSchema = TemplateVisualMetadataSchema.strict();

function codePointLength(value: string): number {
  return Array.from(value).length;
}

const RejectionReasonSchema = z.string().superRefine((value, context) => {
  const normalized = value.trim();
  if (!normalized || codePointLength(normalized) > 500) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "rejection reason must be non-empty and at most 500 code points",
    });
  }
}).transform((value) => value.trim());

const MetadataArrayFieldSchema = z.enum([
  "domains",
  "audiences",
  "ageRanges",
  "emotionalRegisters",
  "visualArchetypes",
  "visualSignals",
  "layoutTraits",
  "requiredAssetTypes",
  "negativeTags",
  "supportedSiteTypes",
  "supportedSectionRoles",
]);
const MetadataScalarFieldSchema = z.enum(["themeability", "identityStrength"]);

export type MetadataArrayField = z.infer<typeof MetadataArrayFieldSchema>;
export type MetadataScalarField = z.infer<typeof MetadataScalarFieldSchema>;

const ReviewCommandSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("metadata_updated"),
    templateId: z.string().min(1),
    field: z.union([MetadataArrayFieldSchema, MetadataScalarFieldSchema]),
    value: z.unknown(),
  }).strict(),
  z.object({ action: z.literal("approved"), templateId: z.string().min(1) }).strict(),
  z.object({ action: z.literal("rejected"), templateId: z.string().min(1), reason: RejectionReasonSchema }).strict(),
  z.object({ action: z.literal("reopened"), templateId: z.string().min(1) }).strict(),
]);

export type ReviewCommand =
  | { action: "metadata_updated"; templateId: string; field: MetadataArrayField | MetadataScalarField; value: unknown }
  | { action: "approved"; templateId: string }
  | { action: "rejected"; templateId: string; reason: string }
  | { action: "reopened"; templateId: string };

const EventBaseSchema = z.object({
  version: z.literal(REVIEW_EVENT_VERSION),
  id: z.string().min(1),
  sequence: z.number().int().min(1),
  at: z.string().datetime(),
  templateId: z.string().min(1),
});

const MetadataUpdatedEventSchema = EventBaseSchema.extend({
  action: z.literal("metadata_updated"),
  field: z.union([MetadataArrayFieldSchema, MetadataScalarFieldSchema]),
  before: z.unknown(),
  after: z.unknown(),
}).strict();
const ApprovedEventSchema = EventBaseSchema.extend({
  action: z.literal("approved"),
  metadata: StrictTemplateVisualMetadataSchema,
}).strict();
const RejectedEventSchema = EventBaseSchema.extend({
  action: z.literal("rejected"),
  reason: RejectionReasonSchema,
}).strict();
const ReopenedEventSchema = EventBaseSchema.extend({ action: z.literal("reopened") }).strict();

export const ReviewEventV1Schema = z.discriminatedUnion("action", [
  MetadataUpdatedEventSchema,
  ApprovedEventSchema,
  RejectedEventSchema,
  ReopenedEventSchema,
]);
export type ReviewEventV1 = z.infer<typeof ReviewEventV1Schema>;

export const ReviewSessionV1Schema = z.object({
  version: z.literal(REVIEW_SESSION_VERSION),
  source: z.object({
    artifactVersion: z.literal(VISUAL_METADATA_ARTIFACT_VERSION),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    templateIds: z.array(z.string().min(1)),
  }).strict(),
  reviewer: z.object({ name: z.string().trim().min(1), email: z.string().email() }).strict(),
  createdAt: z.string().datetime(),
  events: z.array(ReviewEventV1Schema),
}).strict();
export type ReviewSessionV1 = z.infer<typeof ReviewSessionV1Schema>;

export interface ReviewTransitionDeps {
  now: () => Date;
  eventId: () => string;
}

export interface DerivedReviewItem {
  id: string;
  metadata: TemplateVisualMetadata | null;
  state: "pending" | "approved" | "rejected" | "failed";
  rejectionReason: string | null;
}

export interface DerivedReviewState {
  items: Record<string, DerivedReviewItem>;
  progress: {
    total: number;
    suggested: number;
    failed: number;
    pending: number;
    approved: number;
    rejected: number;
    requiredApprovals: number;
    remainingApprovals: number;
    finalExportEnabled: boolean;
  };
  currentTemplateId: string | null;
}

export interface SafeReviewItemDto {
  id: string;
  name: string;
  screenshotEndpoint: string | null;
  metadata: TemplateVisualMetadata | null;
  failureKind: string | null;
  state: "pending" | "approved" | "rejected" | "failed";
}

export type SafeReviewSessionDto =
  | { phase: "identity_required" }
  | {
      phase: "review";
      reviewerName: string;
      source: { artifactVersion: string; abbreviatedSha256: string };
      progress: DerivedReviewState["progress"];
      currentTemplateId: string | null;
    };

export interface ReviewAuditV1 {
  version: typeof REVIEW_AUDIT_VERSION;
  sessionVersion: typeof REVIEW_SESSION_VERSION;
  source: { artifactVersion: string; sha256: string };
  reviewerName: string;
  createdAt: string;
  events: ReviewEventV1[];
}

function copyMetadata(metadata: TemplateVisualMetadata): TemplateVisualMetadata {
  return {
    schemaVersion: TEMPLATE_VISUAL_METADATA_SCHEMA_VERSION,
    domains: [...metadata.domains],
    audiences: [...metadata.audiences],
    ageRanges: [...metadata.ageRanges],
    emotionalRegisters: [...metadata.emotionalRegisters],
    visualArchetypes: [...metadata.visualArchetypes],
    visualSignals: [...metadata.visualSignals],
    layoutTraits: [...metadata.layoutTraits],
    requiredAssetTypes: [...metadata.requiredAssetTypes],
    negativeTags: [...metadata.negativeTags],
    supportedSiteTypes: [...metadata.supportedSiteTypes],
    supportedSectionRoles: [...metadata.supportedSectionRoles],
    themeability: metadata.themeability,
    identityStrength: metadata.identityStrength,
    reviewStatus: metadata.reviewStatus,
  };
}

function copyMetadataWithField(
  metadata: TemplateVisualMetadata,
  field: MetadataArrayField | MetadataScalarField,
  value: unknown,
): TemplateVisualMetadata {
  const candidate: Record<string, unknown> = copyMetadata(metadata);
  candidate[field] = value;
  return TemplateVisualMetadataSchema.parse(candidate);
}

function metadataWithReviewStatus(
  metadata: TemplateVisualMetadata,
  reviewStatus: TemplateVisualMetadata["reviewStatus"],
): TemplateVisualMetadata {
  const candidate: Record<string, unknown> = copyMetadata(metadata);
  candidate.reviewStatus = reviewStatus;
  return TemplateVisualMetadataSchema.parse(candidate);
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeRejectionReason(reason: string): string {
  return RejectionReasonSchema.parse(reason);
}

function sourceRowsById(session: ReviewSessionV1, sourceRows: readonly SuggestionArtifactRow[]): Map<string, SuggestionArtifactRow> {
  const byId = new Map<string, SuggestionArtifactRow>();
  for (const row of sourceRows) {
    if (byId.has(row.id)) throw new Error(`duplicate source suggestion ${row.id}`);
    byId.set(row.id, row);
  }
  const actualIds = Array.from(byId.keys());
  if (actualIds.length !== session.source.templateIds.length
    || actualIds.some((id) => !session.source.templateIds.includes(id))) {
    throw new Error("source rows do not match review session");
  }
  for (const row of sourceRows) {
    if (row.artifactVersion !== session.source.artifactVersion) {
      throw new Error("source artifact version does not match review session");
    }
  }
  return byId;
}

function validateSession(session: ReviewSessionV1): ReviewSessionV1 {
  const parsed = ReviewSessionV1Schema.parse(session);
  const ids = new Set(parsed.source.templateIds);
  if (ids.size !== parsed.source.templateIds.length) throw new Error("review session has duplicate source template IDs");
  parsed.events.forEach((event, index) => {
    if (event.sequence !== index + 1) throw new Error("review events must have contiguous sequences");
    if (!ids.has(event.templateId)) throw new Error(`review event references unknown template ${event.templateId}`);
  });
  return parsed;
}

export function createReviewSession(args: {
  sourceSha256: string;
  rows: SuggestionArtifactRow[];
  reviewer: { name: string; email: string };
  now: Date;
}): ReviewSessionV1 {
  if (!(args.now instanceof Date) || Number.isNaN(args.now.valueOf())) throw new Error("invalid review session time");
  const ids = args.rows.map((row) => row.id);
  if (new Set(ids).size !== ids.length) throw new Error("source rows contain duplicate template IDs");
  const artifactVersion = args.rows[0]?.artifactVersion ?? VISUAL_METADATA_ARTIFACT_VERSION;
  if (args.rows.some((row) => row.artifactVersion !== artifactVersion)) {
    throw new Error("source rows contain multiple artifact versions");
  }
  return validateSession({
    version: REVIEW_SESSION_VERSION,
    source: { artifactVersion, sha256: args.sourceSha256, templateIds: [...ids] },
    reviewer: { name: args.reviewer.name, email: args.reviewer.email },
    createdAt: args.now.toISOString(),
    events: [],
  });
}

export function requiredApprovalCount(total: number): number {
  if (!Number.isInteger(total) || total < 0) throw new Error("approval total must be a non-negative integer");
  return Math.ceil(total * 0.95);
}

export function deriveReviewState(
  session: ReviewSessionV1,
  sourceRows: readonly SuggestionArtifactRow[],
): DerivedReviewState {
  const validSession = validateSession(session);
  const rowsById = sourceRowsById(validSession, sourceRows);
  const items: Record<string, DerivedReviewItem & { draft: TemplateVisualMetadata | null }> = {};

  for (const id of validSession.source.templateIds) {
    const row = rowsById.get(id)!;
    if (row.decision.outcome === "failed") {
      if (row.metadata !== null) throw new Error(`failed source suggestion ${id} has metadata`);
      items[id] = { id, metadata: null, draft: null, state: "failed", rejectionReason: null };
      continue;
    }
    const metadata = TemplateVisualMetadataSchema.parse(row.metadata);
    if (metadata.reviewStatus !== "unreviewed") throw new Error(`source suggestion ${id} must be unreviewed`);
    const draft = copyMetadata(metadata);
    items[id] = { id, metadata: copyMetadata(draft), draft, state: "pending", rejectionReason: null };
  }

  for (const event of validSession.events) {
    const item = items[event.templateId];
    if (!item) throw new Error(`review event references unknown template ${event.templateId}`);
    if (event.action === "metadata_updated") {
      if (item.state !== "pending" || item.draft === null) throw new Error("metadata can only be updated while pending");
      const before = item.draft[event.field];
      if (!sameJson(before, event.before)) throw new Error("metadata update before value does not match replay state");
      const updated = copyMetadataWithField(item.draft, event.field, event.after);
      if (!sameJson(updated[event.field], event.after)) throw new Error("metadata update after value is not canonical");
      item.draft = updated;
      item.metadata = copyMetadata(updated);
      continue;
    }
    if (event.action === "approved") {
      if (item.state !== "pending") throw new Error("approval requires a pending suggestion");
      const approved = StrictTemplateVisualMetadataSchema.parse(event.metadata);
      if (approved.reviewStatus !== "reviewed") throw new Error("approved event must contain reviewed metadata");
      if (item.draft === null || !sameJson(approved, metadataWithReviewStatus(item.draft, "reviewed"))) {
        throw new Error("approved event metadata does not match draft");
      }
      item.state = "approved";
      item.metadata = copyMetadata(approved);
      item.rejectionReason = null;
      continue;
    }
    if (event.action === "rejected") {
      if (item.state !== "pending") throw new Error("rejection requires a pending suggestion");
      item.state = "rejected";
      item.rejectionReason = normalizeRejectionReason(event.reason);
      continue;
    }
    if (item.state !== "approved" && item.state !== "rejected") throw new Error("reopen requires an approval or rejection");
    item.state = "pending";
    item.rejectionReason = null;
    item.metadata = item.draft ? copyMetadata(item.draft) : null;
  }

  const itemValues = Object.values(items);
  const suggested = itemValues.filter((item) => item.state !== "failed").length;
  const failed = itemValues.length - suggested;
  const pending = itemValues.filter((item) => item.state === "pending").length;
  const approved = itemValues.filter((item) => item.state === "approved").length;
  const rejected = itemValues.filter((item) => item.state === "rejected").length;
  const requiredApprovals = requiredApprovalCount(itemValues.length);
  const progress = {
    total: itemValues.length,
    suggested,
    failed,
    pending,
    approved,
    rejected,
    requiredApprovals,
    remainingApprovals: Math.max(requiredApprovals - approved, 0),
    finalExportEnabled: pending === 0 && approved >= requiredApprovals,
  };
  const publicItems: Record<string, DerivedReviewItem> = {};
  for (const id of validSession.source.templateIds) {
    const item = items[id];
    publicItems[id] = {
      id: item.id,
      metadata: item.metadata ? copyMetadata(item.metadata) : null,
      state: item.state,
      rejectionReason: item.rejectionReason,
    };
  }
  return {
    items: publicItems,
    progress,
    currentTemplateId: validSession.source.templateIds.find((id) => publicItems[id].state === "pending") ?? null,
  };
}

export function applyReviewCommand(
  session: ReviewSessionV1,
  sourceRows: readonly SuggestionArtifactRow[],
  command: ReviewCommand,
  deps: ReviewTransitionDeps,
): ReviewSessionV1 {
  const validSession = validateSession(session);
  const parsedCommand = ReviewCommandSchema.parse(command);
  const state = deriveReviewState(validSession, sourceRows);
  const item = state.items[parsedCommand.templateId];
  if (!item) throw new Error(`unknown template ${parsedCommand.templateId}`);
  const at = deps.now();
  if (!(at instanceof Date) || Number.isNaN(at.valueOf())) throw new Error("invalid review event time");
  const base = {
    version: REVIEW_EVENT_VERSION,
    id: deps.eventId(),
    sequence: validSession.events.length + 1,
    at: at.toISOString(),
    templateId: parsedCommand.templateId,
  } as const;
  let event: ReviewEventV1;

  if (parsedCommand.action === "metadata_updated") {
    if (item.state !== "pending" || item.metadata === null) throw new Error("metadata can only be updated while pending");
    const updated = copyMetadataWithField(item.metadata, parsedCommand.field, parsedCommand.value);
    event = {
      ...base,
      action: "metadata_updated",
      field: parsedCommand.field,
      before: structuredClone(item.metadata[parsedCommand.field]),
      after: structuredClone(updated[parsedCommand.field]),
    };
  } else if (parsedCommand.action === "approved") {
    if (item.state === "failed") throw new Error("cannot approve failed suggestion");
    if (item.state !== "pending" || item.metadata === null) throw new Error("approval requires a pending suggestion");
    event = {
      ...base,
      action: "approved",
      metadata: metadataWithReviewStatus(item.metadata, "reviewed"),
    };
  } else if (parsedCommand.action === "rejected") {
    if (item.state === "failed") throw new Error("cannot reject failed suggestion");
    if (item.state !== "pending") throw new Error("rejection requires a pending suggestion");
    event = { ...base, action: "rejected", reason: normalizeRejectionReason(parsedCommand.reason) };
  } else {
    if (item.state === "failed") throw new Error("cannot reopen failed suggestion");
    if (item.state !== "approved" && item.state !== "rejected") throw new Error("reopen requires an approval or rejection");
    event = { ...base, action: "reopened" };
  }

  return validateSession({
    version: validSession.version,
    source: {
      artifactVersion: validSession.source.artifactVersion,
      sha256: validSession.source.sha256,
      templateIds: [...validSession.source.templateIds],
    },
    reviewer: { name: validSession.reviewer.name, email: validSession.reviewer.email },
    createdAt: validSession.createdAt,
    events: [...validSession.events, event],
  });
}

function copyEvent(event: ReviewEventV1): ReviewEventV1 {
  if (event.action === "metadata_updated") {
    return {
      version: event.version, id: event.id, sequence: event.sequence, at: event.at, templateId: event.templateId,
      action: event.action, field: event.field, before: structuredClone(event.before), after: structuredClone(event.after),
    };
  }
  if (event.action === "approved") {
    return {
      version: event.version, id: event.id, sequence: event.sequence, at: event.at, templateId: event.templateId,
      action: event.action, metadata: copyMetadata(event.metadata),
    };
  }
  if (event.action === "rejected") {
    return {
      version: event.version, id: event.id, sequence: event.sequence, at: event.at, templateId: event.templateId,
      action: event.action, reason: event.reason,
    };
  }
  return {
    version: event.version, id: event.id, sequence: event.sequence, at: event.at, templateId: event.templateId,
    action: event.action,
  };
}

const FAILURE_KINDS = new Set([
  "missing_key",
  "missing_screenshot",
  "fetch",
  "model",
  "parse",
  "aborted",
  "timeout",
]);

function safeFailureKind(error: string | null): string | null {
  if (error === null) return null;
  const category = error.split(":", 1)[0].trim();
  return FAILURE_KINDS.has(category) ? category : "unknown";
}

function safeScreenshotEndpoint(id: string): string {
  const encodedId = encodeURIComponent(id).replace(/\./g, "%2E");
  return `/api/internal/template-review/screenshots/${encodedId}`;
}

export function buildReviewExports(
  session: ReviewSessionV1,
  sourceRows: readonly SuggestionArtifactRow[],
): {
  reviewed: Array<{ id: string; metadata: TemplateVisualMetadata & { reviewStatus: "reviewed" } }>;
  audit: ReviewAuditV1;
} {
  const validSession = validateSession(session);
  const state = deriveReviewState(validSession, sourceRows);
  if (!state.progress.finalExportEnabled) throw new Error("final export is not enabled");
  const reviewed: Array<{ id: string; metadata: TemplateVisualMetadata & { reviewStatus: "reviewed" } }> = [];
  for (const id of validSession.source.templateIds) {
    const item = state.items[id];
    if (item.state !== "approved" || item.metadata === null) continue;
    const metadata = TemplateVisualMetadataSchema.parse(item.metadata);
    if (metadata.reviewStatus !== "reviewed") throw new Error(`approved template ${id} is not reviewed`);
    reviewed.push({ id, metadata: metadata as TemplateVisualMetadata & { reviewStatus: "reviewed" } });
  }
  return {
    reviewed,
    audit: {
      version: REVIEW_AUDIT_VERSION,
      sessionVersion: REVIEW_SESSION_VERSION,
      source: { artifactVersion: validSession.source.artifactVersion, sha256: validSession.source.sha256 },
      reviewerName: validSession.reviewer.name,
      createdAt: validSession.createdAt,
      events: validSession.events.map(copyEvent),
    },
  };
}

export function buildSafeReviewDto(
  session: ReviewSessionV1 | null,
  sourceRows: readonly SuggestionArtifactRow[],
): { session: SafeReviewSessionDto; items: SafeReviewItemDto[] } {
  if (session === null) return { session: { phase: "identity_required" }, items: [] };
  const validSession = validateSession(session);
  const state = deriveReviewState(validSession, sourceRows);
  const rowsById = sourceRowsById(validSession, sourceRows);
  const items: SafeReviewItemDto[] = [];
  for (const id of validSession.source.templateIds) {
    const row = rowsById.get(id)!;
    const item = state.items[id];
    const failureKind = row.decision.outcome === "failed" ? safeFailureKind(row.error) : null;
    items.push({
      id: row.id,
      name: row.name,
      screenshotEndpoint: safeScreenshotEndpoint(row.id),
      metadata: item.metadata ? copyMetadata(item.metadata) : null,
      failureKind,
      state: item.state,
    });
  }
  return {
    session: {
      phase: "review",
      reviewerName: validSession.reviewer.name,
      source: {
        artifactVersion: validSession.source.artifactVersion,
        abbreviatedSha256: validSession.source.sha256.slice(0, 12),
      },
      progress: {
        total: state.progress.total,
        suggested: state.progress.suggested,
        failed: state.progress.failed,
        pending: state.progress.pending,
        approved: state.progress.approved,
        rejected: state.progress.rejected,
        requiredApprovals: state.progress.requiredApprovals,
        remainingApprovals: state.progress.remainingApprovals,
        finalExportEnabled: state.progress.finalExportEnabled,
      },
      currentTemplateId: state.currentTemplateId,
    },
    items,
  };
}
