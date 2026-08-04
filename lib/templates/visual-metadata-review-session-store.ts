import { createHash, randomUUID } from "node:crypto";
import { open, readFile, rm } from "node:fs/promises";
import { basename, isAbsolute, relative } from "node:path";
import { writeJsonAtomic, type AtomicWriteResult } from "../fs/write-json-atomic";
import {
  REVIEW_AUDIT_VERSION,
  REVIEW_SESSION_VERSION,
  ReviewSessionV1Schema,
  applyReviewCommand,
  buildReviewExports,
  createReviewSession,
  deriveReviewState,
  requiredApprovalCount,
  type DerivedReviewState,
  type ReviewAuditV1,
  type ReviewCommand,
  type ReviewSessionV1,
} from "./visual-metadata-review-session";
import { validateSuggestionArtifactSeed, type SuggestionArtifactRow } from "./visual-metadata-review-workflow";

const LOCK_VERSION = "template-visual-metadata-review-lock/1.0" as const;

export interface ReviewWorkspaceConfig {
  inputPath: string;
  sessionPath: string;
  reviewedOutputPath: string;
  auditOutputPath: string;
  reviewer: { name: string; email: string };
}

export interface LoadedReviewSource {
  sha256: string;
  rows: SuggestionArtifactRow[];
  counts: { rows: number; unique: number; suggested: number; failed: number; requiredApprovals: number };
}

export interface ReviewWorkspaceSnapshot {
  session: ReviewSessionV1;
  state: DerivedReviewState;
  currentTemplateId: string | null;
}

export interface VisualMetadataReviewWorkspace {
  snapshot(): ReviewWorkspaceSnapshot;
  dispatch(command: ReviewCommand): Promise<ReviewWorkspaceSnapshot>;
  setCurrentTemplate(id: string): Promise<ReviewWorkspaceSnapshot>;
  exportFinal(): Promise<{ reviewedPath: string; auditPath: string }>;
  exportAuditBackup(): Promise<{ auditPath: string }>;
  close(): Promise<void>;
}

export interface ReviewWorkspaceDependencies {
  now?: () => Date;
  eventId?: () => string;
  lockId?: () => string;
  processExists?: (pid: number) => boolean | Promise<boolean>;
  pid?: number;
  writeJson?: (path: string, value: unknown) => Promise<AtomicWriteResult>;
}

export class ReviewWorkspaceLockError extends Error {
  readonly code = "REVIEW_WORKSPACE_LOCKED";

  constructor() {
    super("review workspace is locked");
    this.name = "ReviewWorkspaceLockError";
    this.stack = `${this.name}: ${this.message}`;
  }
}

export class ReviewWorkspaceResumeError extends Error {
  readonly code = "REVIEW_WORKSPACE_RESUME_REJECTED";

  constructor() {
    super("review workspace cannot be resumed");
    this.name = "ReviewWorkspaceResumeError";
    this.stack = `${this.name}: ${this.message}`;
  }
}

export class ReviewWorkspacePersistenceError extends Error {
  readonly code = "REVIEW_WORKSPACE_PERSISTENCE_FAILED";

  constructor() {
    super("review workspace persistence failed");
    this.name = "ReviewWorkspacePersistenceError";
    this.stack = `${this.name}: ${this.message}`;
  }
}

export class ReviewWorkspaceClosedError extends Error {
  readonly code = "REVIEW_WORKSPACE_CLOSED";

  constructor() {
    super("review workspace is closed");
    this.name = "ReviewWorkspaceClosedError";
    this.stack = `${this.name}: ${this.message}`;
  }
}

interface ReviewLock {
  version: typeof LOCK_VERSION;
  pid: number;
  processUuid: string;
  startedAt: string;
}

function safeRelativePath(path: string): string {
  const value = relative(process.cwd(), path);
  if (!value || isAbsolute(value)) return basename(path);
  return value;
}

function cloneSession(session: ReviewSessionV1): ReviewSessionV1 {
  return structuredClone(session);
}

function parseLock(value: unknown): ReviewLock | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const lock = value as Record<string, unknown>;
  if (lock.version !== LOCK_VERSION || !Number.isInteger(lock.pid) || (lock.pid as number) < 1
    || typeof lock.processUuid !== "string" || !lock.processUuid || typeof lock.startedAt !== "string"
    || Number.isNaN(Date.parse(lock.startedAt))) return null;
  return { version: LOCK_VERSION, pid: lock.pid as number, processUuid: lock.processUuid, startedAt: lock.startedAt };
}

function defaultProcessExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(typeof error === "object" && error !== null && "code" in error && error.code === "ESRCH");
  }
}

function auditFor(session: ReviewSessionV1): ReviewAuditV1 {
  return {
    version: REVIEW_AUDIT_VERSION,
    sessionVersion: REVIEW_SESSION_VERSION,
    source: { artifactVersion: session.source.artifactVersion, sha256: session.source.sha256 },
    reviewerName: session.reviewer.name,
    createdAt: session.createdAt,
    events: structuredClone(session.events),
  };
}

async function readSession(path: string): Promise<ReviewSessionV1 | null> {
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return null;
    throw new ReviewWorkspaceResumeError();
  }
  try {
    return ReviewSessionV1Schema.parse(JSON.parse(bytes.toString("utf8")));
  } catch {
    throw new ReviewWorkspaceResumeError();
  }
}

function validateResumedSession(
  session: ReviewSessionV1,
  source: LoadedReviewSource,
  reviewer: ReviewWorkspaceConfig["reviewer"],
): ReviewSessionV1 {
  try {
    if (session.source.sha256 !== source.sha256
      || session.reviewer.name !== reviewer.name
      || session.reviewer.email !== reviewer.email) throw new Error("mismatch");
    deriveReviewState(session, source.rows);
    return cloneSession(session);
  } catch {
    throw new ReviewWorkspaceResumeError();
  }
}

async function readLock(path: string): Promise<ReviewLock | null> {
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return null;
    throw new ReviewWorkspaceLockError();
  }
  try {
    return parseLock(JSON.parse(bytes.toString("utf8")));
  } catch {
    return null;
  }
}

async function createLock(path: string, lock: ReviewLock): Promise<void> {
  let file;
  try {
    file = await open(path, "wx");
    await file.writeFile(`${JSON.stringify(lock)}\n`, "utf8");
    await file.sync();
  } catch {
    throw new ReviewWorkspaceLockError();
  } finally {
    await file?.close();
  }
}

async function releaseLock(path: string, ownedLock: ReviewLock): Promise<void> {
  const current = await readLock(path);
  if (!current || current.pid !== ownedLock.pid || current.processUuid !== ownedLock.processUuid) return;
  try {
    await rm(path, { force: true });
  } catch {
    // Closing a workspace must not remove a lock acquired by another process.
  }
}

export async function loadVisualMetadataReviewSource(inputPath: string): Promise<LoadedReviewSource> {
  let bytes: Buffer;
  try {
    bytes = await readFile(inputPath);
  } catch {
    throw new ReviewWorkspaceResumeError();
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new ReviewWorkspaceResumeError();
  }
  if (!Array.isArray(value) || value.length === 0) throw new ReviewWorkspaceResumeError();
  const ids = value.map((candidate) => candidate && typeof candidate === "object" && !Array.isArray(candidate)
    ? (candidate as Record<string, unknown>).id : undefined);
  if (ids.some((id) => typeof id !== "string" || !id) || new Set(ids).size !== ids.length) {
    throw new ReviewWorkspaceResumeError();
  }
  let rows: SuggestionArtifactRow[];
  try {
    rows = validateSuggestionArtifactSeed(value, new Set(ids as string[]));
  } catch {
    throw new ReviewWorkspaceResumeError();
  }
  const suggested = rows.filter((row) => row.decision.outcome === "suggested").length;
  return {
    sha256,
    rows: structuredClone(rows),
    counts: {
      rows: rows.length,
      unique: new Set(rows.map((row) => row.id)).size,
      suggested,
      failed: rows.length - suggested,
      requiredApprovals: requiredApprovalCount(rows.length),
    },
  };
}

export async function openVisualMetadataReviewWorkspace(
  config: ReviewWorkspaceConfig,
  dependencies: ReviewWorkspaceDependencies = {},
): Promise<VisualMetadataReviewWorkspace> {
  const source = await loadVisualMetadataReviewSource(config.inputPath);
  const now = dependencies.now ?? (() => new Date());
  const eventId = dependencies.eventId ?? randomUUID;
  const processUuid = (dependencies.lockId ?? randomUUID)();
  const pid = dependencies.pid ?? process.pid;
  const processExists = dependencies.processExists ?? defaultProcessExists;
  const writeJson = dependencies.writeJson ?? writeJsonAtomic;
  const lockPath = `${config.sessionPath}.lock`;
  const lock: ReviewLock = { version: LOCK_VERSION, pid, processUuid, startedAt: now().toISOString() };
  const existingLock = await readLock(lockPath);
  if (existingLock) {
    if (await processExists(existingLock.pid)) throw new ReviewWorkspaceLockError();
    const existingSession = await readSession(config.sessionPath);
    if (existingSession !== null) validateResumedSession(existingSession, source, config.reviewer);
    try {
      await rm(lockPath);
    } catch {
      throw new ReviewWorkspaceLockError();
    }
  } else {
    // Invalid lock data fails closed; never guess that an unreadable owner is stale.
    try {
      const bytes = await readFile(lockPath);
      if (bytes) throw new ReviewWorkspaceLockError();
    } catch (error) {
      if (error instanceof ReviewWorkspaceLockError) throw error;
      if (!(typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")) {
        throw new ReviewWorkspaceLockError();
      }
    }
  }
  await createLock(lockPath, lock);

  let session: ReviewSessionV1;
  try {
    const existingSession = await readSession(config.sessionPath);
    if (existingSession !== null) {
      session = validateResumedSession(existingSession, source, config.reviewer);
    } else {
      const createdAt = now();
      session = createReviewSession({ sourceSha256: source.sha256, rows: source.rows, reviewer: config.reviewer, now: createdAt });
      await writeJson(config.sessionPath, session);
    }
  } catch (error) {
    await releaseLock(lockPath, lock);
    if (error instanceof ReviewWorkspaceResumeError) throw error;
    throw new ReviewWorkspacePersistenceError();
  }

  let currentTemplateId: string | null = deriveReviewState(session, source.rows).currentTemplateId;
  let frozen: ReviewWorkspacePersistenceError | null = null;
  let closed = false;
  let chain: Promise<void> = Promise.resolve();

  function snapshot(): ReviewWorkspaceSnapshot {
    const state = deriveReviewState(session, source.rows);
    const current = currentTemplateId && state.items[currentTemplateId] ? currentTemplateId : state.currentTemplateId;
    return { session: cloneSession(session), state, currentTemplateId: current };
  }

  function enqueue<T>(operation: () => Promise<T>, permitClosed = false): Promise<T> {
    const result = chain.then(async () => {
      if (!permitClosed && closed) throw new ReviewWorkspaceClosedError();
      if (!permitClosed && frozen) throw frozen;
      return operation();
    });
    chain = result.then(() => undefined, () => undefined);
    return result;
  }

  async function persist(value: unknown): Promise<void> {
    try {
      await writeJson(config.sessionPath, value);
    } catch {
      frozen = new ReviewWorkspacePersistenceError();
      throw frozen;
    }
  }

  return {
    snapshot,
    dispatch(command) {
      return enqueue(async () => {
        const next = applyReviewCommand(session, source.rows, command, { now, eventId });
        await persist(next);
        session = next;
        currentTemplateId = deriveReviewState(session, source.rows).currentTemplateId;
        return snapshot();
      });
    },
    setCurrentTemplate(id) {
      return enqueue(async () => {
        const state = deriveReviewState(session, source.rows);
        if (!state.items[id]) throw new ReviewWorkspaceResumeError();
        currentTemplateId = id;
        return snapshot();
      });
    },
    exportFinal() {
      return enqueue(async () => {
        const exports = buildReviewExports(session, source.rows);
        try {
          await writeJson(config.reviewedOutputPath, exports.reviewed);
          await writeJson(config.auditOutputPath, exports.audit);
        } catch {
          frozen = new ReviewWorkspacePersistenceError();
          throw frozen;
        }
        return { reviewedPath: safeRelativePath(config.reviewedOutputPath), auditPath: safeRelativePath(config.auditOutputPath) };
      });
    },
    exportAuditBackup() {
      return enqueue(async () => {
        try {
          await writeJson(config.auditOutputPath, auditFor(session));
        } catch {
          frozen = new ReviewWorkspacePersistenceError();
          throw frozen;
        }
        return { auditPath: safeRelativePath(config.auditOutputPath) };
      });
    },
    close() {
      return enqueue(async () => {
        if (closed) return;
        closed = true;
        await releaseLock(lockPath, lock);
      }, true);
    },
  };
}
