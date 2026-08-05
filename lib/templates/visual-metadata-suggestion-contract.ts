import {
  TEMPLATE_VISUAL_METADATA_SCHEMA_VERSION,
  TemplateVisualMetadataSchema,
  type TemplateVisualMetadata,
} from "./visual-metadata";

export const VISUAL_METADATA_ARTIFACT_VERSION = "template-visual-metadata-suggestion-artifact/1.0" as const;
export const VISUAL_METADATA_DECISION_VERSION = "template-visual-metadata-suggestion-decision/1.0" as const;
export const VISUAL_METADATA_WORKFLOW_VERSION = "template-visual-metadata-suggestion-workflow/1.0" as const;
export const VISUAL_METADATA_MODEL_CHOICE_VERSION = "template-visual-metadata-model-choice/1.0" as const;
export const VISUAL_METADATA_PROMPT_VERSION = "template-visual-metadata-prompt/3.0" as const;
export const VISUAL_METADATA_GENERATION_CONFIG_VERSION = "template-visual-metadata-generation-config/3.0" as const;
export const VISUAL_METADATA_FAILURE_POLICY_VERSION = "template-visual-metadata-failure-policy/1.0" as const;
export const VISUAL_METADATA_TIMEOUT_POLICY_VERSION = "template-visual-metadata-timeout-policy/1.0" as const;
export const VISUAL_METADATA_MAXIMUM_FAILURE_RATE = 0.10;
export const VISUAL_METADATA_PER_TEMPLATE_TIMEOUT_MS = 60_000;

type HistoricalPromptVersion =
  | "template-visual-metadata-prompt/1.0"
  | "template-visual-metadata-prompt/2.0";
type HistoricalGenerationConfigVersion = "template-visual-metadata-generation-config/1.0";
type StructuredGenerationConfigVersion =
  | "template-visual-metadata-generation-config/2.0"
  | typeof VISUAL_METADATA_GENERATION_CONFIG_VERSION;

interface HistoricalGenerationConfig {
  version: HistoricalGenerationConfigVersion;
  temperature: 0.2;
  maxOutputTokens: 2048;
  responseMimeType: "application/json";
  thinkingBudget: 0;
}

interface StructuredGenerationConfig {
  version: StructuredGenerationConfigVersion;
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
  generationConfig: HistoricalGenerationConfig | StructuredGenerationConfig;
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
      (
        (
          value.promptVersion === "template-visual-metadata-prompt/2.0"
          && generationConfig.version === "template-visual-metadata-generation-config/2.0"
        )
        || (
          value.promptVersion === VISUAL_METADATA_PROMPT_VERSION
          && generationConfig.version === VISUAL_METADATA_GENERATION_CONFIG_VERSION
        )
      )
      && generationConfig.responseJsonSchemaVersion === TEMPLATE_VISUAL_METADATA_SCHEMA_VERSION
    )
  );
  return value.workflowVersion === VISUAL_METADATA_WORKFLOW_VERSION
    && isRecord(modelChoice)
    && modelChoice.version === VISUAL_METADATA_MODEL_CHOICE_VERSION
    && typeof modelChoice.modelId === "string"
    && modelChoice.modelId.trim().length > 0
    && value.schemaVersion === TEMPLATE_VISUAL_METADATA_SCHEMA_VERSION
    && baseGenerationConfig
    && validProvenanceVersionPair
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
      decision: { version: VISUAL_METADATA_DECISION_VERSION, outcome: decision.outcome },
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
