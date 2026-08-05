import { sql, type SQL } from "drizzle-orm";
import { writeJsonAtomic } from "../fs/write-json-atomic";
import type { TemplateRecord } from "./store";
import {
  suggestVisualMetadata,
  VISUAL_METADATA_MAXIMUM_FAILURE_RATE,
  VISUAL_METADATA_PER_TEMPLATE_TIMEOUT_MS,
  type SuggestVisualMetadataOptions,
  type SuggestVisualMetadataResult,
} from "./suggest-visual-metadata";
import {
  TemplateVisualMetadataSchema,
  type TemplateVisualMetadata,
} from "./visual-metadata";
import {
  VISUAL_METADATA_ARTIFACT_VERSION,
  VISUAL_METADATA_DECISION_VERSION,
  validateSuggestionArtifactSeed,
  type SuggestionArtifactProvenance,
  type SuggestionArtifactRow,
} from "./visual-metadata-suggestion-contract";

export {
  VISUAL_METADATA_ARTIFACT_VERSION,
  VISUAL_METADATA_DECISION_VERSION,
  validateSuggestionArtifactSeed,
};
export type { SuggestionArtifactProvenance, SuggestionArtifactRow };

export interface SuggestionBatchOptions {
  force?: boolean;
  timeoutMs?: number;
  seedRows?: SuggestionArtifactRow[];
  onCheckpoint?: (
    rows: SuggestionArtifactRow[],
    progress: { attempted: number; failed: number },
  ) => void | Promise<void>;
  now?: () => Date;
  suggest?: (
    record: TemplateRecord,
    options: SuggestVisualMetadataOptions,
  ) => Promise<SuggestVisualMetadataResult>;
}

export interface SuggestionBatchResult {
  rows: SuggestionArtifactRow[];
  attempted: number;
  failed: number;
  shouldFail: boolean;
}

export async function runVisualMetadataSuggestionBatch(
  templates: TemplateRecord[],
  options: SuggestionBatchOptions = {},
): Promise<SuggestionBatchResult> {
  const rowsById = new Map<string, SuggestionArtifactRow>();
  for (const row of options.seedRows ?? []) {
    if (rowsById.has(row.id)) throw new Error(`duplicate seed template ${row.id}`);
    rowsById.set(row.id, row);
  }
  let attempted = 0;
  let failed = 0;
  const suggest = options.suggest ?? suggestVisualMetadata;
  const timeoutMs = options.timeoutMs ?? VISUAL_METADATA_PER_TEMPLATE_TIMEOUT_MS;
  const now = options.now ?? (() => new Date());
  for (const template of templates) {
    if (!options.seedRows && !options.force && template.visualMetadata?.reviewStatus === "reviewed") continue;
    attempted++;
    const result = await suggest(template, { timeoutMs });
    if (!result.ok) failed++;
    const row: SuggestionArtifactRow = {
      artifactVersion: VISUAL_METADATA_ARTIFACT_VERSION,
      recordedAt: now().toISOString(),
      decision: {
        version: VISUAL_METADATA_DECISION_VERSION,
        outcome: result.ok ? "suggested" : "failed",
      },
      id: template.id,
      name: template.name,
      screenshotUrl: template.screenshotUrl,
      metadata: result.ok ? result.metadata : null,
      error: result.ok ? null : `${result.kind}: ${result.message}`,
      provenance: result.audit,
      evidence: { rawModelResponse: result.raw ?? null },
    };
    rowsById.set(row.id, row);
    await options.onCheckpoint?.(Array.from(rowsById.values()), { attempted, failed });
  }
  return {
    rows: Array.from(rowsById.values()),
    attempted,
    failed,
    shouldFail: attempted > 0 && failed / attempted > VISUAL_METADATA_MAXIMUM_FAILURE_RATE,
  };
}


export function prepareVisualMetadataRetry(
  templates: TemplateRecord[],
  seedValue: unknown,
): { templates: TemplateRecord[]; seedRows: SuggestionArtifactRow[] } {
  const seedRows = validateSuggestionArtifactSeed(seedValue, new Set(templates.map((template) => template.id)));
  const failedIds = new Set(seedRows
    .filter((row) => row.decision.outcome === "failed")
    .map((row) => row.id));
  return {
    templates: templates.filter((template) => failedIds.has(template.id)),
    seedRows,
  };
}

export async function writeSuggestionArtifactAtomic(
  path: string,
  rows: SuggestionArtifactRow[],
): Promise<void> {
  await writeJsonAtomic(path, rows);
}

export interface ReviewedMetadataRow {
  id: string;
  metadata: TemplateVisualMetadata & { reviewStatus: "reviewed" };
}

export function validateReviewedMetadataInput(
  value: unknown,
  publishedIds: ReadonlySet<string>,
): ReviewedMetadataRow[] {
  if (!Array.isArray(value)) throw new Error("input must be an array");
  const seen = new Set<string>();
  return value.map((row, index) => {
    if (!row || typeof row !== "object") throw new Error(`row ${index} is not an object`);
    const id = String((row as Record<string, unknown>).id ?? "");
    if (!publishedIds.has(id)) throw new Error(`row ${index}: unknown published template ${id}`);
    if (seen.has(id)) throw new Error(`row ${index}: duplicate template ${id}`);
    seen.add(id);
    const metadata = TemplateVisualMetadataSchema.parse((row as Record<string, unknown>).metadata);
    if (metadata.reviewStatus !== "reviewed") throw new Error(`row ${index}: ${id} is not reviewed`);
    return { id, metadata: metadata as ReviewedMetadataRow["metadata"] };
  });
}

export async function executeReviewedMetadataUpdate(
  rows: ReviewedMetadataRow[],
  execute: (query: SQL) => Promise<unknown>,
): Promise<void> {
  if (rows.length === 0) return;
  const values = sql.join(
    rows.map((row) => sql`(${row.id}, ${JSON.stringify(row.metadata)}::jsonb)`),
    sql`, `,
  );
  await execute(sql`
    UPDATE "templates" AS target
    SET "visualMetadata" = source.metadata,
        "updatedAt" = NOW()
    FROM (VALUES ${values}) AS source(id, metadata)
    WHERE target.id = source.id
  `);
}
