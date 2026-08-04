import { createHash, randomUUID } from "node:crypto";
import { open, readFile, rename, rm } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { writeJsonAtomic, type AtomicWriteResult } from "../fs/write-json-atomic";
import {
  REVIEW_AUDIT_VERSION, REVIEW_SESSION_VERSION, ReviewSessionV1Schema, applyReviewCommand, buildReviewExports,
  createReviewSession, deriveReviewState, requiredApprovalCount,
  type DerivedReviewState, type ReviewAuditV1, type ReviewCommand, type ReviewSessionV1,
} from "./visual-metadata-review-session";
import { validateSuggestionArtifactSeed, type SuggestionArtifactRow } from "./visual-metadata-review-workflow";

const LOCK_VERSION = "template-visual-metadata-review-lock/1.0" as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
export interface ReviewWorkspaceSnapshot { session: ReviewSessionV1; state: DerivedReviewState; currentTemplateId: string | null; }
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
  claimId?: () => string;
  processExists?: (pid: number) => boolean | Promise<boolean>;
  pid?: number;
  writeJson?: (path: string, value: unknown) => Promise<AtomicWriteResult>;
  onAfterStaleLockClaim?: () => void | Promise<void>;
  relativePath?: (from: string, to: string) => string;
  pathIsAbsolute?: (path: string) => boolean;
}

class SafeStoreError extends Error {
  readonly code: string;
  constructor(name: string, code: string, message: string) {
    super(message); this.name = name; this.code = code; this.stack = `${name}: ${message}`;
  }
}
export class ReviewWorkspaceLockError extends SafeStoreError { constructor() { super("ReviewWorkspaceLockError", "REVIEW_WORKSPACE_LOCKED", "review workspace is locked"); } }
export class ReviewWorkspaceResumeError extends SafeStoreError { constructor() { super("ReviewWorkspaceResumeError", "REVIEW_WORKSPACE_RESUME_REJECTED", "review workspace cannot be resumed"); } }
export class ReviewWorkspacePersistenceError extends SafeStoreError { constructor() { super("ReviewWorkspacePersistenceError", "REVIEW_WORKSPACE_PERSISTENCE_FAILED", "review workspace persistence failed"); } }
export class ReviewWorkspaceClosedError extends SafeStoreError { constructor() { super("ReviewWorkspaceClosedError", "REVIEW_WORKSPACE_CLOSED", "review workspace is closed"); } }
export class ReviewWorkspaceConfigError extends SafeStoreError { constructor() { super("ReviewWorkspaceConfigError", "REVIEW_WORKSPACE_CONFIG_INVALID", "review workspace configuration is invalid"); } }
export class ReviewWorkspaceCommandError extends SafeStoreError { constructor() { super("ReviewWorkspaceCommandError", "REVIEW_WORKSPACE_COMMAND_REJECTED", "review command was rejected"); } }

interface ReviewLock { version: typeof LOCK_VERSION; pid: number; processUuid: string; startedAt: string; }
interface FrozenConfig {
  inputPath: string; sessionPath: string; lockPath: string; reviewedOutputPath: string; auditOutputPath: string;
  reviewer: { name: string; email: string }; reviewedRelativePath: string; auditRelativePath: string;
}

function cloneSession(session: ReviewSessionV1): ReviewSessionV1 { return structuredClone(session); }
function isErrno(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
function validIso(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && !Number.isNaN(Date.parse(value));
}
function parseLock(value: unknown): ReviewLock | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const lock = value as Record<string, unknown>;
  if (Object.keys(lock).length !== 4 || !["version", "pid", "processUuid", "startedAt"].every((key) => key in lock)
    || lock.version !== LOCK_VERSION || !Number.isSafeInteger(lock.pid) || (lock.pid as number) < 1
    || typeof lock.processUuid !== "string" || !UUID.test(lock.processUuid) || !validIso(lock.startedAt)) return null;
  return { version: LOCK_VERSION, pid: lock.pid as number, processUuid: lock.processUuid, startedAt: lock.startedAt };
}
function normalizedReviewer(reviewer: ReviewWorkspaceConfig["reviewer"]): FrozenConfig["reviewer"] {
  const name = typeof reviewer?.name === "string" ? reviewer.name.trim() : "";
  const email = typeof reviewer?.email === "string" ? reviewer.email.trim() : "";
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ReviewWorkspaceConfigError();
  return { name, email };
}
function freezeConfig(config: ReviewWorkspaceConfig, dependencies: ReviewWorkspaceDependencies): FrozenConfig {
  const inputPath = resolve(config.inputPath);
  const sessionPath = resolve(config.sessionPath);
  const reviewedOutputPath = resolve(config.reviewedOutputPath);
  const auditOutputPath = resolve(config.auditOutputPath);
  const lockPath = `${sessionPath}.lock`;
  const key = (path: string) => process.platform === "win32" ? path.toLocaleLowerCase("en-US") : path;
  const paths = [inputPath, sessionPath, reviewedOutputPath, auditOutputPath, lockPath];
  if (new Set(paths.map(key)).size !== paths.length) throw new ReviewWorkspaceConfigError();
  const makeRelative = dependencies.relativePath ?? relative;
  const absolute = dependencies.pathIsAbsolute ?? isAbsolute;
  const reviewedRelativePath = makeRelative(process.cwd(), reviewedOutputPath);
  const auditRelativePath = makeRelative(process.cwd(), auditOutputPath);
  if (!reviewedRelativePath || !auditRelativePath || absolute(reviewedRelativePath) || absolute(auditRelativePath)) throw new ReviewWorkspaceConfigError();
  return { inputPath, sessionPath, lockPath, reviewedOutputPath, auditOutputPath, reviewer: normalizedReviewer(config.reviewer), reviewedRelativePath, auditRelativePath };
}
function defaultProcessExists(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return !isErrno(error, "ESRCH"); }
}
function auditFor(session: ReviewSessionV1): ReviewAuditV1 {
  return { version: REVIEW_AUDIT_VERSION, sessionVersion: REVIEW_SESSION_VERSION,
    source: { artifactVersion: session.source.artifactVersion, sha256: session.source.sha256 }, reviewerName: session.reviewer.name,
    createdAt: session.createdAt, events: structuredClone(session.events) };
}
async function readSession(path: string): Promise<ReviewSessionV1 | null> {
  try { return ReviewSessionV1Schema.parse(JSON.parse((await readFile(path)).toString("utf8"))); }
  catch (error) { if (isErrno(error, "ENOENT")) return null; throw new ReviewWorkspaceResumeError(); }
}
function validateResumedSession(session: ReviewSessionV1, source: LoadedReviewSource, reviewer: FrozenConfig["reviewer"]): ReviewSessionV1 {
  try {
    if (session.source.sha256 !== source.sha256 || session.reviewer.name !== reviewer.name || session.reviewer.email !== reviewer.email) throw new Error();
    deriveReviewState(session, source.rows); return cloneSession(session);
  } catch { throw new ReviewWorkspaceResumeError(); }
}
async function readLock(path: string): Promise<ReviewLock | null> {
  try { return parseLock(JSON.parse((await readFile(path)).toString("utf8"))); }
  catch (error) { if (isErrno(error, "ENOENT")) return null; throw new ReviewWorkspaceLockError(); }
}
async function createLock(path: string, lock: ReviewLock): Promise<void> {
  let file: Awaited<ReturnType<typeof open>> | undefined;
  try { file = await open(path, "wx"); await file.writeFile(`${JSON.stringify(lock)}\n`, "utf8"); await file.sync(); }
  catch { throw new ReviewWorkspaceLockError(); }
  finally { try { await file?.close(); } catch { throw new ReviewWorkspaceLockError(); } }
}
async function releaseLock(path: string, ownedLock: ReviewLock): Promise<void> {
  const current = await readLock(path);
  if (!current || current.pid !== ownedLock.pid || current.processUuid !== ownedLock.processUuid) throw new ReviewWorkspaceLockError();
  try { await rm(path); } catch { throw new ReviewWorkspaceLockError(); }
}

export async function loadVisualMetadataReviewSource(inputPath: string): Promise<LoadedReviewSource> {
  let bytes: Buffer;
  try { bytes = await readFile(inputPath); } catch { throw new ReviewWorkspaceResumeError(); }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  let value: unknown;
  try { value = JSON.parse(bytes.toString("utf8")); } catch { throw new ReviewWorkspaceResumeError(); }
  if (!Array.isArray(value) || value.length === 0) throw new ReviewWorkspaceResumeError();
  const ids = value.map((candidate) => candidate && typeof candidate === "object" && !Array.isArray(candidate) ? (candidate as Record<string, unknown>).id : undefined);
  if (ids.some((id) => typeof id !== "string" || !id) || new Set(ids).size !== ids.length) throw new ReviewWorkspaceResumeError();
  let rows: SuggestionArtifactRow[];
  try { rows = validateSuggestionArtifactSeed(value, new Set(ids as string[])); } catch { throw new ReviewWorkspaceResumeError(); }
  const suggested = rows.filter((row) => row.decision.outcome === "suggested").length;
  return { sha256, rows: structuredClone(rows), counts: { rows: rows.length, unique: rows.length, suggested, failed: rows.length - suggested, requiredApprovals: requiredApprovalCount(rows.length) } };
}

export async function openVisualMetadataReviewWorkspace(config: ReviewWorkspaceConfig, dependencies: ReviewWorkspaceDependencies = {}): Promise<VisualMetadataReviewWorkspace> {
  const frozenConfig = freezeConfig(config, dependencies);
  const source = await loadVisualMetadataReviewSource(frozenConfig.inputPath);
  const now = dependencies.now ?? (() => new Date());
  const eventId = dependencies.eventId ?? randomUUID;
  const processUuid = (dependencies.lockId ?? randomUUID)();
  if (!UUID.test(processUuid)) throw new ReviewWorkspaceConfigError();
  const lock: ReviewLock = { version: LOCK_VERSION, pid: dependencies.pid ?? process.pid, processUuid, startedAt: now().toISOString() };
  const processExists = dependencies.processExists ?? defaultProcessExists;
  const writeJson = dependencies.writeJson ?? writeJsonAtomic;
  const existingLock = await readLock(frozenConfig.lockPath);
  if (existingLock === null) {
    try { await createLock(frozenConfig.lockPath, lock); } catch (error) { if (error instanceof ReviewWorkspaceLockError) throw error; throw new ReviewWorkspaceLockError(); }
  } else {
    if (await processExists(existingLock.pid)) throw new ReviewWorkspaceLockError();
    const durableSession = await readSession(frozenConfig.sessionPath);
    if (durableSession === null) throw new ReviewWorkspaceLockError();
    validateResumedSession(durableSession, source, frozenConfig.reviewer);
    const claimPath = `${frozenConfig.lockPath}.${(dependencies.claimId ?? randomUUID)()}.claim`;
    try { await rename(frozenConfig.lockPath, claimPath); } catch { throw new ReviewWorkspaceLockError(); }
    try {
      await dependencies.onAfterStaleLockClaim?.();
      await createLock(frozenConfig.lockPath, lock);
    } catch {
      throw new ReviewWorkspaceLockError();
    } finally {
      try { await rm(claimPath, { force: true }); } catch { /* stale claim is not a live owner */ }
    }
  }

  let session: ReviewSessionV1;
  try {
    const existingSession = await readSession(frozenConfig.sessionPath);
    if (existingSession) session = validateResumedSession(existingSession, source, frozenConfig.reviewer);
    else { session = createReviewSession({ sourceSha256: source.sha256, rows: source.rows, reviewer: frozenConfig.reviewer, now: now() }); await writeJson(frozenConfig.sessionPath, session); }
  } catch (error) {
    try { await releaseLock(frozenConfig.lockPath, lock); } catch { /* opening cannot retain ownership after a failed persistence */ }
    if (error instanceof ReviewWorkspaceResumeError) throw error;
    throw new ReviewWorkspacePersistenceError();
  }

  let currentTemplateId: string | null = deriveReviewState(session, source.rows).currentTemplateId;
  let frozen: ReviewWorkspacePersistenceError | null = null;
  let closed = false;
  let chain: Promise<void> = Promise.resolve();
  const snapshot = (): ReviewWorkspaceSnapshot => {
    const state = deriveReviewState(session, source.rows);
    return { session: cloneSession(session), state, currentTemplateId: currentTemplateId && state.items[currentTemplateId] ? currentTemplateId : state.currentTemplateId };
  };
  const enqueue = <T>(operation: () => Promise<T>, allowClosed = false): Promise<T> => {
    const result = chain.then(async () => { if (!allowClosed && closed) throw new ReviewWorkspaceClosedError(); if (!allowClosed && frozen) throw frozen; return operation(); });
    chain = result.then(() => undefined, () => undefined); return result;
  };
  const persistSession = async (next: ReviewSessionV1) => {
    try { await writeJson(frozenConfig.sessionPath, next); } catch { frozen = new ReviewWorkspacePersistenceError(); throw frozen; }
  };
  return {
    snapshot,
    dispatch(command) {
      let immutableCommand: ReviewCommand;
      try { immutableCommand = structuredClone(command); } catch { return Promise.reject(new ReviewWorkspaceCommandError()); }
      return enqueue(async () => {
        let next: ReviewSessionV1;
        try { next = applyReviewCommand(session, source.rows, immutableCommand, { now, eventId }); } catch { throw new ReviewWorkspaceCommandError(); }
        await persistSession(next); session = next; currentTemplateId = deriveReviewState(session, source.rows).currentTemplateId; return snapshot();
      });
    },
    setCurrentTemplate(id) {
      const immutableId = String(id);
      return enqueue(async () => { if (!deriveReviewState(session, source.rows).items[immutableId]) throw new ReviewWorkspaceCommandError(); currentTemplateId = immutableId; return snapshot(); });
    },
    exportFinal() {
      return enqueue(async () => {
        const exports = buildReviewExports(session, source.rows);
        try { await writeJson(frozenConfig.auditOutputPath, exports.audit); await writeJson(frozenConfig.reviewedOutputPath, exports.reviewed); }
        catch { frozen = new ReviewWorkspacePersistenceError(); throw frozen; }
        return { reviewedPath: frozenConfig.reviewedRelativePath, auditPath: frozenConfig.auditRelativePath };
      });
    },
    exportAuditBackup() {
      return enqueue(async () => { try { await writeJson(frozenConfig.auditOutputPath, auditFor(session)); } catch { frozen = new ReviewWorkspacePersistenceError(); throw frozen; } return { auditPath: frozenConfig.auditRelativePath }; });
    },
    close() { return enqueue(async () => { if (closed) return; await releaseLock(frozenConfig.lockPath, lock); closed = true; }, true); },
  };
}
