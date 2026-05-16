import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";
import { WitnessRecordSchema } from "@/lib/orchestrator/types";
import type {
  PaletteName,
  PipelineStep,
  RoutingDecision,
  WitnessRecord,
} from "@/lib/orchestrator/types";

// ─────────────────────────────────────────────────────────────────────────────
// Witness recorder.
//
// One JSONL file per generation lives at `recordings/<generationId>.jsonl`.
// Each line is a fully-typed `WitnessRecord` describing one model call:
// which step, which model, why, input/output tokens, latency, cost. The
// recordings are the explainability moat — anything in the response can be
// audited back to a concrete model call.
//
// Writes are best-effort but awaited. If the disk write fails we surface the
// error to the orchestrator so the SSE stream can emit a recoverable error
// event without taking down the whole generation.
// ─────────────────────────────────────────────────────────────────────────────

export interface RecordInput {
  step: PipelineStep;
  decision: RoutingDecision;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  costUsd: number;
  mocked: boolean;
  note?: string;
  /** Design palette selected for this generation when the step ran. */
  palette?: PaletteName;
  /**
   * Few-shot variants injected for this step in "direction/variant" form.
   * Absent for steps that skip few-shot loading.
   */
  fewShotVariants?: string[];
}

export interface Recorder {
  /** Repo-relative path of the JSONL file. */
  readonly path: string;
  /** Generation ID this recorder is bound to. */
  readonly generationId: string;
  /** Count of records flushed so far. */
  readonly count: number;
  record(input: RecordInput): Promise<void>;
}

const RECORDINGS_DIR_RELATIVE = "recordings";

function recordingsDir(): string {
  return path.join(process.cwd(), RECORDINGS_DIR_RELATIVE);
}

function relativePathFor(generationId: string): string {
  return path.posix.join(RECORDINGS_DIR_RELATIVE, `${generationId}.jsonl`);
}

function absolutePathFor(generationId: string): string {
  return path.join(recordingsDir(), `${generationId}.jsonl`);
}

export function createRecorder(generationId: string): Recorder {
  const absolutePath = absolutePathFor(generationId);
  const relPath = relativePathFor(generationId);
  let count = 0;
  let dirEnsured = false;

  async function ensureDir(): Promise<void> {
    if (dirEnsured) return;
    await mkdir(recordingsDir(), { recursive: true });
    dirEnsured = true;
  }

  return {
    get path() {
      return relPath;
    },
    generationId,
    get count() {
      return count;
    },
    async record(input: RecordInput): Promise<void> {
      const record: WitnessRecord = {
        ts: new Date().toISOString(),
        generationId,
        step: input.step,
        decision: input.decision,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        latencyMs: input.latencyMs,
        costUsd: input.costUsd,
        mocked: input.mocked,
        note: input.note,
        palette: input.palette,
        fewShotVariants: input.fewShotVariants,
      };
      // Validate before write so a malformed record fails loudly instead of
      // silently polluting the recording.
      const parsed = WitnessRecordSchema.parse(record);
      await ensureDir();
      await appendFile(absolutePath, `${JSON.stringify(parsed)}\n`, "utf8");
      count += 1;
    },
  };
}
