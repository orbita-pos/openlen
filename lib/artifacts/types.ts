/** Shared, JSON-safe contracts. No model/provider or server imports here. */
export type ArtifactKind = "dashboard" | "slides" | "image" | "motion";
export type ArtifactVisibility = "owner" | "project";
export type ArtifactStatus = "draft" | "queued" | "running" | "validating" | "storing" | "ready" | "failed" | "cancelled" | "needs_attention";
export type ArtifactJobStatus = Exclude<ArtifactStatus, "draft" | "ready"> | "completed";
export interface ArtifactContext {
  readonly actorId: string;
  readonly ownerId: string;
  readonly projectId: string;
  readonly requestId: string;
  readonly role: "dueno" | "editor" | "lector";
}
export interface ArtifactRequest {
  readonly id: string;
  readonly projectId: string;
  readonly sourceMessageId: string;
  readonly createdBy: string;
  readonly createdAt: Date;
}
export interface Artifact {
  readonly id: string;
  readonly projectId: string;
  readonly requestId: string;
  readonly kind: ArtifactKind;
  readonly title: string;
  readonly brief: string;
  readonly createdBy: string;
  readonly visibility: ArtifactVisibility;
  readonly currentRevision: number;
  readonly lastReadyRevision: number | null;
  readonly status: ArtifactStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
export interface ArtifactDependency { readonly artifactId: string; readonly revision: number }
export interface ArtifactSourceRef {
  readonly files: Readonly<Record<string, string>>;
  readonly settingsHash: string;
  readonly capturedAt: string;
  readonly resourceRefs: readonly string[];
}
export interface ArtifactOutput {
  readonly key: string;
  readonly hash: string;
  readonly mime: string;
  readonly bytes: number;
  readonly format: string;
}
export interface ArtifactEvidence { readonly valid: true; readonly checks: readonly string[]; readonly checkedAt: string }
export interface ArtifactRevision {
  readonly artifactId: string;
  readonly revision: number;
  readonly files: Readonly<Record<string, string>>;
  readonly manifest: Readonly<Record<string, unknown>>;
  readonly dependencies: readonly ArtifactDependency[];
  readonly sourceRef: ArtifactSourceRef | null;
  readonly sealedAt: Date | null;
  readonly createdAt: Date;
  readonly outputs: readonly ArtifactOutput[];
  readonly evidence: ArtifactEvidence | null;
}
export interface ArtifactJob {
  readonly id: string;
  readonly artifactId: string;
  readonly revision: number;
  readonly operation: string;
  readonly optionsHash: string;
  readonly options: Readonly<Record<string, unknown>>;
  readonly status: ArtifactJobStatus;
  readonly attempt: number;
  readonly workerId: string | null;
  readonly fencingToken: string | null;
  readonly leaseUntil: Date | null;
  readonly cancelRequested: boolean;
  readonly externalStartedAt: Date | null;
  readonly errorCode: string | null;
  readonly createdAt: Date;
}
export interface JobClaim { readonly job: ArtifactJob; readonly workerId: string; readonly fencingToken: string; readonly leaseUntil: Date }
export interface ArtifactEvent {
  readonly cursor: string;
  readonly projectId: string;
  readonly requestId: string;
  readonly artifactId: string;
  readonly revision: number;
  readonly type: string;
  readonly jobId: string | null;
  readonly createdAt: Date;
}
export interface ArtifactDataset {
  readonly id: string;
  readonly mode: "scenario" | "snapshot" | "live";
  readonly environment: "draft" | "live" | null;
  readonly visibility: ArtifactVisibility;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly unknown[])[];
  readonly query: string | null;
  readonly source: string;
  readonly capturedAt: string;
  readonly truncated: boolean;
}
export interface ResolvedAsset { readonly id: string; readonly mime: string; readonly bytes: Uint8Array }
export interface SealedArtifactInput {
  readonly artifact: Artifact;
  readonly revision: ArtifactRevision;
  readonly assets: readonly ResolvedAsset[];
  readonly datasets: readonly ArtifactDataset[];
}
export interface ProducedArtifactFile { readonly name: string; readonly format: string; readonly mime: string; readonly bytes: Uint8Array }
export interface AdapterResult { readonly outputs: readonly ProducedArtifactFile[]; readonly evidence: ArtifactEvidence }
export type ArtifactAdapter = (input: SealedArtifactInput, signal: AbortSignal) => Promise<AdapterResult>;
export interface ArtifactChargePolicy { readonly imageCenticredits: number; readonly renderCenticredits: number }
export interface Settlement { readonly jobId: string; readonly attemptId: string; readonly ledgerId: string; readonly chargedCenticredits: number }
export interface JobOutcome { readonly jobId: string; readonly status: "completed" | "failed" | "cancelled" | "needs_attention"; readonly code?: string }

export interface ArtifactSql {
  query(text: string, values?: readonly unknown[]): Promise<Record<string, unknown>[]>;
}
export interface ArtifactDatabase extends ArtifactSql {
  transaction<T>(fn: (tx: ArtifactSql) => Promise<T>): Promise<T>;
}
export class ArtifactError extends Error {
  constructor(readonly code: string, message = code) { super(message); this.name = "ArtifactError"; }
}
