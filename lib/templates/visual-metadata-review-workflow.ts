import { renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { sql, type SQL } from "drizzle-orm";
import type { TemplateRecord } from "./store";
import {
  suggestVisualMetadata,
  VISUAL_METADATA_FAILURE_POLICY_VERSION,
  VISUAL_METADATA_GENERATION_CONFIG_VERSION,
  VISUAL_METADATA_MAXIMUM_FAILURE_RATE,
  VISUAL_METADATA_MODEL_CHOICE_VERSION,
  VISUAL_METADATA_PER_TEMPLATE_TIMEOUT_MS,
  VISUAL_METADATA_PROMPT_VERSION,
  VISUAL_METADATA_TIMEOUT_POLICY_VERSION,
  VISUAL_METADATA_WORKFLOW_VERSION,
  type SuggestVisualMetadataOptions,
  type SuggestVisualMetadataResult,
} from "./suggest-visual-metadata";
import {
  TEMPLATE_VISUAL_METADATA_SCHEMA_VERSION,
  TemplateVisualMetadataSchema,
  type TemplateVisualMetadata,
} from "./visual-metadata";

export const VISUAL_METADATA_ARTIFACT_VERSION = "template-visual-metadata-suggestion-artifact/1.0" as const;
export const VISUAL_METADATA_DECISION_VERSION = "template-visual-metadata-suggestion-decision/1.0" as const;

type HistoricalPromptVersion = "template-visual-metadata-prompt/1.0";
type HistoricalGenerationConfigVersion = "template-visual-metadata-generation-config/1.0";

interface HistoricalGenerationConfig {
  version: HistoricalGenerationConfigVersion;
  temperature: 0.2;
  maxOutputTokens: 2048;
  responseMimeType: "application/json";
  thinkingBudget: 0;
}

interface CurrentGenerationConfig {
  version: typeof VISUAL_METADATA_GENERATION_CONFIG_VERSION;
  temperature: 0.2;
  maxOutputTokens: 2048;
  responseMimeType: "application/json";
  responseJsonSchemaVersion: typeof TEMPLATE_VISUAL_METADATA_SCHEMA_VERSION;
  thinkingBudget: 0;
}

export interface SuggestionArtifactProvenance {
  workflowVersion: typeof VISUAL_METADATA_WORKFLOW_VERSION;
  modelChoice: {
    version: typeof VISUAL_METADATA_MODEL_CHOICE_VERSION;
    modelId: string;
  };
  promptVersion: HistoricalPromptVersion | typeof VISUAL_METADATA_PROMPT_VERSION;
  schemaVersion: typeof TEMPLATE_VISUAL_METADATA_SCHEMA_VERSION;
  generationConfig: HistoricalGenerationConfig | CurrentGenerationConfig;
  failurePolicy: {
    version: typeof VISUAL_METADATA_FAILURE_POLICY_VERSION;
    maximumFailureRate: number;
  };
  timeoutPolicy: {
    version: typeof VISUAL_METADATA_TIMEOUT_POLICY_VERSION;
    timeoutMs: number;
  };
}

export interface SuggestionArtifactRow {
  artifactVersion: typeof VISUAL_METADATA_ARTIFACT_VERSION;
  recordedAt: string;
  decision: {
    version: typeof VISUAL_METADATA_DECISION_VERSION;
    outcome: "suggested" | "failed";
  };
  id: string;
  name: string;
  screenshotUrl: string | null;
  metadata: TemplateVisualMetadata | null;
  error: string | null;
  provenance: SuggestionArtifactProvenance;
  evidence: { rawModelResponse: string | null };
}

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const CREDENTIAL_FIELD_NAMES = new Set([
  "apikey",
  "authorization",
  "accesstoken",
  "refreshtoken",
  "databaseurl",
  "databaseurldirect",
  "dsn",
  "password",
  "secret",
]);

function hasCredentialField(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasCredentialField);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, nested]) =>
    CREDENTIAL_FIELD_NAMES.has(key.replace(/[^a-z0-9]/gi, "").toLowerCase()) || hasCredentialField(nested));
}

function validProvenance(value: unknown): value is SuggestionArtifactProvenance {
  if (!isRecord(value)) return false;
  const modelChoice = value.modelChoice;
  const generationConfig = value.generationConfig;
  const failurePolicy = value.failurePolicy;
  const timeoutPolicy = value.timeoutPolicy;
  const baseGenerationConfig = isRecord(generationConfig)
    && generationConfig.temperature === 0.2
    && generationConfig.maxOutputTokens === 2_048
    && generationConfig.responseMimeType === "application/json"
    && generationConfig.thinkingBudget === 0;
  const validProvenanceVersionPair = isRecord(generationConfig) && (
    (
      value.promptVersion === "template-visual-metadata-prompt/1.0"
      && generationConfig.version === "template-visual-metadata-generation-config/1.0"
    )
    || (
      value.promptVersion === VISUAL_METADATA_PROMPT_VERSION
      && generationConfig.version === VISUAL_METADATA_GENERATION_CONFIG_VERSION
      && generationConfig.responseJsonSchemaVersion === TEMPLATE_VISUAL_METADATA_SCHEMA_VERSION
    )
  );
  const validGenerationConfig = baseGenerationConfig && validProvenanceVersionPair;
  return value.workflowVersion === VISUAL_METADATA_WORKFLOW_VERSION
    && isRecord(modelChoice)
    && modelChoice.version === VISUAL_METADATA_MODEL_CHOICE_VERSION
    && typeof modelChoice.modelId === "string"
    && modelChoice.modelId.trim().length > 0
    && value.schemaVersion === TEMPLATE_VISUAL_METADATA_SCHEMA_VERSION
    && validGenerationConfig
    && isRecord(failurePolicy)
    && failurePolicy.version === VISUAL_METADATA_FAILURE_POLICY_VERSION
    && failurePolicy.maximumFailureRate === VISUAL_METADATA_MAXIMUM_FAILURE_RATE
    && isRecord(timeoutPolicy)
    && timeoutPolicy.version === VISUAL_METADATA_TIMEOUT_POLICY_VERSION
    && typeof timeoutPolicy.timeoutMs === "number"
    && Number.isInteger(timeoutPolicy.timeoutMs)
    && timeoutPolicy.timeoutMs >= 1
    && timeoutPolicy.timeoutMs <= 600_000;
}

export function validateSuggestionArtifactSeed(
  value: unknown,
  publishedIds: ReadonlySet<string>,
): SuggestionArtifactRow[] {
  if (!Array.isArray(value)) throw new Error("seed artifact must be an array");
  const seen = new Set<string>();
  const rows = value.map((candidate, index): SuggestionArtifactRow => {
    if (!isRecord(candidate)) throw new Error(`row ${index} is not an object`);
    if (hasCredentialField(candidate)) throw new Error(`row ${index}: credential field names are not allowed`);
    const id = typeof candidate.id === "string" ? candidate.id : "";
    if (!publishedIds.has(id)) throw new Error(`row ${index}: unknown published template ${id}`);
    if (seen.has(id)) throw new Error(`row ${index}: duplicate template ${id}`);
    seen.add(id);
    if (candidate.artifactVersion !== VISUAL_METADATA_ARTIFACT_VERSION) {
      throw new Error(`row ${index}: unsupported artifact version`);
    }
    if (typeof candidate.recordedAt !== "string" || !Number.isFinite(Date.parse(candidate.recordedAt))) {
      throw new Error(`row ${index}: invalid recordedAt`);
    }
    const decision = candidate.decision;
    if (!isRecord(decision)
      || decision.version !== VISUAL_METADATA_DECISION_VERSION
      || (decision.outcome !== "suggested" && decision.outcome !== "failed")) {
      throw new Error(`row ${index}: invalid decision`);
    }
    if (!validProvenance(candidate.provenance)) throw new Error(`row ${index}: incomplete provenance`);
    const evidence = candidate.evidence;
    if (!isRecord(evidence)
      || (evidence.rawModelResponse !== null && typeof evidence.rawModelResponse !== "string")) {
      throw new Error(`row ${index}: invalid evidence`);
    }
    if (typeof candidate.name !== "string"
      || (candidate.screenshotUrl !== null && typeof candidate.screenshotUrl !== "string")) {
      throw new Error(`row ${index}: invalid template identity`);
    }

    let metadata: TemplateVisualMetadata | null = null;
    let error: string | null = null;
    if (decision.outcome === "suggested") {
      metadata = TemplateVisualMetadataSchema.parse(candidate.metadata);
      if (metadata.reviewStatus !== "unreviewed") {
        throw new Error(`row ${index}: ${id} suggestion is not unreviewed`);
      }
      if (candidate.error !== null) throw new Error(`row ${index}: ${id} suggested decision must have null error`);
    } else {
      if (candidate.metadata !== null) throw new Error(`row ${index}: ${id} failed decision must have null metadata`);
      if (typeof candidate.error !== "string" || !candidate.error) {
        throw new Error(`row ${index}: ${id} failed decision must have an error`);
      }
      error = candidate.error;
    }
    return {
      artifactVersion: VISUAL_METADATA_ARTIFACT_VERSION,
      recordedAt: candidate.recordedAt,
      decision: {
        version: VISUAL_METADATA_DECISION_VERSION,
        outcome: decision.outcome,
      },
      id,
      name: candidate.name,
      screenshotUrl: candidate.screenshotUrl,
      metadata,
      error,
      provenance: candidate.provenance,
      evidence: { rawModelResponse: evidence.rawModelResponse },
    };
  });
  for (const publishedId of publishedIds) {
    if (!seen.has(publishedId)) throw new Error(`seed artifact does not cover published template ${publishedId}`);
  }
  return rows;
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

export function writeSuggestionArtifactAtomic(
  path: string,
  rows: SuggestionArtifactRow[],
): void {
  const target = resolve(path);
  const temporary = `${target}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(rows, null, 2)}\n`, "utf8");
  renameSync(temporary, target);
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
