import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, open, readFile, readdir, rename, rm, rmdir, unlink } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { writeJsonAtomic, type AtomicWriteResult } from "../fs/write-json-atomic";
import {
  ReviewSessionV1Schema, applyReviewCommand, buildReviewAudit, buildReviewExports,
  buildSafeReviewDto, createReviewSession, deriveReviewState, requiredApprovalCount,
  setReviewSessionCurrentTemplate,
  type DerivedReviewState, type ReviewCommand, type ReviewSessionV1,
  type SafeReviewItemDto, type SafeReviewSessionDto,
} from "./visual-metadata-review-session";
import {
  validateSuggestionArtifactSeed,
  type SuggestionArtifactRow,
} from "./visual-metadata-suggestion-contract";

const LOCK_VERSION = "template-visual-metadata-review-lock/1.0" as const;
const LOCK_GUARD_VERSION = "template-visual-metadata-review-lock-guard/1.0" as const;
const LOCK_GUARD_RECOVERY_VERSION = "template-visual-metadata-review-lock-guard-recovery/1.0" as const;
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
  getSafeReviewDto(): { session: SafeReviewSessionDto; items: SafeReviewItemDto[] };
  getScreenshotSourceUrl(id: string): string | null;
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
  onAfterStaleLockRead?: () => void | Promise<void>;
  onAfterReleaseLockGuard?: () => void | Promise<void>;
  onAfterStaleGuardRead?: () => void | Promise<void>;
  onAfterStaleRecoveryRead?: () => void | Promise<void>;
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
interface ReviewLockGuard { version: typeof LOCK_GUARD_VERSION; pid: number; processUuid: string; startedAt: string; }
interface ReviewLockGuardRecovery { version: typeof LOCK_GUARD_RECOVERY_VERSION; pid: number; processUuid: string; startedAt: string; }
interface ReviewLockGuardRecoveryLease { owner: ReviewLockGuardRecovery; markerPath: string | null; }
interface FrozenConfig {
  inputPath: string; sessionPath: string; lockPath: string; reviewedOutputPath: string; auditOutputPath: string;
  reviewer: { name: string; email: string }; reviewedRelativePath: string; auditRelativePath: string;
}

function cloneSession(session: ReviewSessionV1): ReviewSessionV1 { return structuredClone(session); }
function isErrno(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
function validIso(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
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
  const paths = [inputPath, sessionPath, reviewedOutputPath, auditOutputPath, lockPath, guardPath(lockPath), recoveryPath(lockPath)];
  if (new Set(paths.map(key)).size !== paths.length) throw new ReviewWorkspaceConfigError();
  if ([inputPath, sessionPath, reviewedOutputPath, auditOutputPath].some((path) => key(path).startsWith(`${key(guardPath(lockPath))}.`))) {
    throw new ReviewWorkspaceConfigError();
  }
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
function sameLock(left: ReviewLock | null, right: ReviewLock): boolean {
  return left !== null && left.pid === right.pid && left.processUuid === right.processUuid && left.startedAt === right.startedAt;
}
function guardPath(lockPath: string): string { return `${lockPath}.claim`; }
function recoveryPath(lockPath: string): string { return `${guardPath(lockPath)}.recovery`; }
function parseGuard(value: unknown): ReviewLockGuard | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const guard = value as Record<string, unknown>;
  if (Object.keys(guard).length !== 4 || guard.version !== LOCK_GUARD_VERSION || !Number.isSafeInteger(guard.pid)
    || (guard.pid as number) < 1 || typeof guard.processUuid !== "string" || !UUID.test(guard.processUuid) || !validIso(guard.startedAt)) return null;
  return { version: LOCK_GUARD_VERSION, pid: guard.pid as number, processUuid: guard.processUuid, startedAt: guard.startedAt };
}
function parseGuardRecovery(value: unknown): ReviewLockGuardRecovery | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const recovery = value as Record<string, unknown>;
  if (Object.keys(recovery).length !== 4 || recovery.version !== LOCK_GUARD_RECOVERY_VERSION || !Number.isSafeInteger(recovery.pid)
    || (recovery.pid as number) < 1 || typeof recovery.processUuid !== "string" || !UUID.test(recovery.processUuid) || !validIso(recovery.startedAt)) return null;
  return { version: LOCK_GUARD_RECOVERY_VERSION, pid: recovery.pid as number, processUuid: recovery.processUuid, startedAt: recovery.startedAt };
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
async function createLockGuard(lockPath: string, owner: ReviewLock): Promise<void> {
  let file: Awaited<ReturnType<typeof open>> | undefined;
  try {
    file = await open(guardPath(lockPath), "wx");
    await file.writeFile(`${JSON.stringify({ version: LOCK_GUARD_VERSION, pid: owner.pid, processUuid: owner.processUuid, startedAt: owner.startedAt })}\n`, "utf8");
    await file.sync();
  } catch { throw new ReviewWorkspaceLockError(); }
  finally { try { await file?.close(); } catch { throw new ReviewWorkspaceLockError(); } }
}
async function readLockGuard(lockPath: string): Promise<ReviewLockGuard | null> {
  try {
    const parsed = parseGuard(JSON.parse((await readFile(guardPath(lockPath))).toString("utf8")));
    if (!parsed) throw new ReviewWorkspaceLockError();
    return parsed;
  } catch (error) { if (isErrno(error, "ENOENT")) return null; throw new ReviewWorkspaceLockError(); }
}
async function releaseLockGuard(lockPath: string, owner: ReviewLock): Promise<void> {
  let guard: ReviewLockGuard | null;
  try { guard = await readLockGuard(lockPath); } catch { throw new ReviewWorkspaceLockError(); }
  if (!guard || guard.pid !== owner.pid || guard.processUuid !== owner.processUuid || guard.startedAt !== owner.startedAt) throw new ReviewWorkspaceLockError();
  try { await rm(guardPath(lockPath)); } catch { throw new ReviewWorkspaceLockError(); }
}
function recoveryOwner(owner: ReviewLock): ReviewLockGuardRecovery {
  return { version: LOCK_GUARD_RECOVERY_VERSION, pid: owner.pid, processUuid: owner.processUuid, startedAt: owner.startedAt };
}
function recoveryMarkerName(owner: ReviewLockGuardRecovery): string {
  return `${createHash("sha256").update(JSON.stringify(owner)).digest("hex")}.owner`;
}
async function discardRecoveryStaging(stagingPath: string, markerPath: string): Promise<void> {
  try { await rm(markerPath); } catch { /* an unpublished or already-cleaned marker is inert */ }
  try { await rmdir(stagingPath); } catch { /* an unpublished staging directory is inert */ }
}
async function publishRecoveryDirectory(stagingPath: string, canonicalPath: string): Promise<void> {
  try { await rename(stagingPath, canonicalPath); return; } catch { /* an empty retired directory may still occupy the name */ }
  try { await rmdir(canonicalPath); } catch { /* a non-empty generation must remain untouched */ }
  try { await rename(stagingPath, canonicalPath); } catch { throw new ReviewWorkspaceLockError(); }
}
async function createLockGuardRecovery(lockPath: string, owner: ReviewLock): Promise<void> {
  const canonicalPath = recoveryPath(lockPath);
  let stagingPath = "";
  let markerPath = "";
  let file: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const recovery = recoveryOwner(owner);
    stagingPath = await mkdtemp(`${canonicalPath}.pending-`);
    markerPath = join(stagingPath, recoveryMarkerName(recovery));
    file = await open(markerPath, "wx");
    await file.writeFile(`${JSON.stringify(recovery)}\n`, "utf8");
    await file.sync();
    await file.close();
    file = undefined;
    await publishRecoveryDirectory(stagingPath, canonicalPath);
  } catch {
    try { await file?.close(); } catch { /* redacted below */ }
    if (stagingPath) await discardRecoveryStaging(stagingPath, markerPath);
    throw new ReviewWorkspaceLockError();
  }
}
async function readLockGuardRecovery(lockPath: string): Promise<ReviewLockGuardRecoveryLease | null> {
  const canonicalPath = recoveryPath(lockPath);
  let entries: string[];
  try { entries = await readdir(canonicalPath); }
  catch (error) {
    if (isErrno(error, "ENOENT")) return null;
    if (!isErrno(error, "ENOTDIR")) throw new ReviewWorkspaceLockError();
    let owner: ReviewLockGuardRecovery | null;
    try { owner = parseGuardRecovery(JSON.parse((await readFile(canonicalPath)).toString("utf8"))); }
    catch { throw new ReviewWorkspaceLockError(); }
    if (!owner) throw new ReviewWorkspaceLockError();
    return { owner, markerPath: null };
  }
  if (entries.length === 0) {
    try { await rmdir(canonicalPath); return null; }
    catch (error) { if (isErrno(error, "ENOENT")) return null; throw new ReviewWorkspaceLockError(); }
  }
  if (entries.length !== 1) throw new ReviewWorkspaceLockError();
  const markerPath = join(canonicalPath, entries[0]);
  let owner: ReviewLockGuardRecovery | null;
  try { owner = parseGuardRecovery(JSON.parse((await readFile(markerPath)).toString("utf8"))); }
  catch { throw new ReviewWorkspaceLockError(); }
  if (!owner || entries[0] !== recoveryMarkerName(owner)) throw new ReviewWorkspaceLockError();
  return { owner, markerPath };
}
async function retireLockGuardRecovery(lockPath: string, lease: ReviewLockGuardRecoveryLease): Promise<void> {
  if (lease.markerPath === null) {
    try { await unlink(recoveryPath(lockPath)); } catch { throw new ReviewWorkspaceLockError(); }
    return;
  }
  try { await rm(lease.markerPath); } catch { throw new ReviewWorkspaceLockError(); }
  try { await rmdir(recoveryPath(lockPath)); } catch { throw new ReviewWorkspaceLockError(); }
}
async function releaseLockGuardRecovery(lockPath: string, owner: ReviewLock): Promise<void> {
  const lease = await readLockGuardRecovery(lockPath);
  if (!lease || lease.owner.pid !== owner.pid || lease.owner.processUuid !== owner.processUuid || lease.owner.startedAt !== owner.startedAt) {
    throw new ReviewWorkspaceLockError();
  }
  await retireLockGuardRecovery(lockPath, lease);
}
async function recoverOrRejectLockGuardRecovery(
  lockPath: string,
  processExists: (pid: number) => boolean | Promise<boolean>,
  onStaleRead?: () => void | Promise<void>,
): Promise<void> {
  const staleRecovery = await readLockGuardRecovery(lockPath);
  if (staleRecovery === null) return;
  if (await processExists(staleRecovery.owner.pid)) throw new ReviewWorkspaceLockError();
  await onStaleRead?.();
  await retireLockGuardRecovery(lockPath, staleRecovery);
}
function sameGuard(left: ReviewLockGuard | null, right: ReviewLockGuard): boolean {
  return left !== null && left.pid === right.pid && left.processUuid === right.processUuid && left.startedAt === right.startedAt;
}
async function recoverOrRejectLockGuard(
  lockPath: string,
  owner: ReviewLock,
  processExists: (pid: number) => boolean | Promise<boolean>,
  validateSession: () => Promise<void>,
  onStaleRead?: () => void | Promise<void>,
): Promise<void> {
  const staleGuard = await readLockGuard(lockPath);
  if (staleGuard === null) return;
  if (await processExists(staleGuard.pid)) throw new ReviewWorkspaceLockError();
  await validateSession();
  await onStaleRead?.();
  await createLockGuardRecovery(lockPath, owner);
  try {
    if (!sameGuard(await readLockGuard(lockPath), staleGuard) || await processExists(staleGuard.pid)) throw new ReviewWorkspaceLockError();
    try { await rm(guardPath(lockPath)); } catch { throw new ReviewWorkspaceLockError(); }
  } finally {
    await releaseLockGuardRecovery(lockPath, owner);
  }
}
async function releaseLock(path: string, ownedLock: ReviewLock, onGuard?: () => void | Promise<void>): Promise<void> {
  await createLockGuard(path, ownedLock);
  try {
    if (!sameLock(await readLock(path), ownedLock)) throw new ReviewWorkspaceLockError();
    await onGuard?.();
    if (!sameLock(await readLock(path), ownedLock)) throw new ReviewWorkspaceLockError();
    try { await rm(path); } catch { throw new ReviewWorkspaceLockError(); }
  } finally {
    await releaseLockGuard(path, ownedLock);
  }
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
  const pid = dependencies.pid ?? process.pid;
  if (!Number.isSafeInteger(pid) || pid < 1) throw new ReviewWorkspaceConfigError();
  const source = await loadVisualMetadataReviewSource(frozenConfig.inputPath);
  const now = dependencies.now ?? (() => new Date());
  const eventId = dependencies.eventId ?? randomUUID;
  const processUuid = (dependencies.lockId ?? randomUUID)();
  if (!UUID.test(processUuid)) throw new ReviewWorkspaceConfigError();
  const lock: ReviewLock = { version: LOCK_VERSION, pid, processUuid, startedAt: now().toISOString() };
  const processExists = dependencies.processExists ?? defaultProcessExists;
  const writeJson = dependencies.writeJson ?? writeJsonAtomic;
  await recoverOrRejectLockGuardRecovery(frozenConfig.lockPath, processExists, dependencies.onAfterStaleRecoveryRead);
  await recoverOrRejectLockGuard(
    frozenConfig.lockPath,
    lock,
    processExists,
    async () => {
      const durableSession = await readSession(frozenConfig.sessionPath);
      if (durableSession === null) throw new ReviewWorkspaceLockError();
      validateResumedSession(durableSession, source, frozenConfig.reviewer);
    },
    dependencies.onAfterStaleGuardRead,
  );
  const existingLock = await readLock(frozenConfig.lockPath);
  if (existingLock === null) {
    try { await createLock(frozenConfig.lockPath, lock); } catch (error) { if (error instanceof ReviewWorkspaceLockError) throw error; throw new ReviewWorkspaceLockError(); }
  } else {
    if (await processExists(existingLock.pid)) throw new ReviewWorkspaceLockError();
    const durableSession = await readSession(frozenConfig.sessionPath);
    if (durableSession === null) throw new ReviewWorkspaceLockError();
    validateResumedSession(durableSession, source, frozenConfig.reviewer);
    await dependencies.onAfterStaleLockRead?.();
    await createLockGuard(frozenConfig.lockPath, lock);
    const retiredPath = `${frozenConfig.lockPath}.${(dependencies.claimId ?? randomUUID)()}.retired`;
    try {
      if (!sameLock(await readLock(frozenConfig.lockPath), existingLock)) throw new ReviewWorkspaceLockError();
      await dependencies.onAfterStaleLockClaim?.();
      await rename(frozenConfig.lockPath, retiredPath);
      await createLock(frozenConfig.lockPath, lock);
      try { await rm(retiredPath); } catch { throw new ReviewWorkspaceLockError(); }
    } catch {
      throw new ReviewWorkspaceLockError();
    } finally {
      await releaseLockGuard(frozenConfig.lockPath, lock);
    }
  }

  let session: ReviewSessionV1;
  try {
    const existingSession = await readSession(frozenConfig.sessionPath);
    if (existingSession) session = validateResumedSession(existingSession, source, frozenConfig.reviewer);
    else { session = createReviewSession({ sourceSha256: source.sha256, rows: source.rows, reviewer: frozenConfig.reviewer, now: now() }); await writeJson(frozenConfig.sessionPath, session); }
  } catch (error) {
    await releaseLock(frozenConfig.lockPath, lock);
    if (error instanceof ReviewWorkspaceResumeError) throw error;
    throw new ReviewWorkspacePersistenceError();
  }

  let frozen: ReviewWorkspacePersistenceError | null = null;
  let closed = false;
  let chain: Promise<void> = Promise.resolve();
  const snapshot = (): ReviewWorkspaceSnapshot => {
    const state = deriveReviewState(session, source.rows);
    return { session: cloneSession(session), state, currentTemplateId: state.currentTemplateId };
  };
  const sourceRowsById = new Map(source.rows.map((row) => [row.id, row] as const));
  const enqueue = <T>(operation: () => Promise<T>, allowClosed = false): Promise<T> => {
    const result = chain.then(async () => { if (!allowClosed && closed) throw new ReviewWorkspaceClosedError(); if (!allowClosed && frozen) throw frozen; return operation(); });
    chain = result.then(() => undefined, () => undefined); return result;
  };
  const persistSession = async (next: ReviewSessionV1) => {
    try { await writeJson(frozenConfig.sessionPath, next); } catch { frozen = new ReviewWorkspacePersistenceError(); throw frozen; }
  };
  return {
    snapshot,
    getSafeReviewDto() {
      return structuredClone(buildSafeReviewDto(session, source.rows));
    },
    getScreenshotSourceUrl(id) {
      return sourceRowsById.get(String(id))?.screenshotUrl ?? null;
    },
    dispatch(command) {
      let immutableCommand: ReviewCommand;
      try { immutableCommand = structuredClone(command); } catch { return Promise.reject(new ReviewWorkspaceCommandError()); }
      return enqueue(async () => {
        let next: ReviewSessionV1;
        try { next = applyReviewCommand(session, source.rows, immutableCommand, { now, eventId }); } catch { throw new ReviewWorkspaceCommandError(); }
        await persistSession(next); session = next; return snapshot();
      });
    },
    setCurrentTemplate(id) {
      const immutableId = String(id);
      return enqueue(async () => {
        let next: ReviewSessionV1;
        try { next = setReviewSessionCurrentTemplate(session, source.rows, immutableId, now()); }
        catch { throw new ReviewWorkspaceCommandError(); }
        await persistSession(next);
        session = next;
        return snapshot();
      });
    },
    exportFinal() {
      return enqueue(async () => {
        const exports = buildReviewExports(session, source.rows, now());
        try { await writeJson(frozenConfig.auditOutputPath, exports.audit); await writeJson(frozenConfig.reviewedOutputPath, exports.reviewed); }
        catch { frozen = new ReviewWorkspacePersistenceError(); throw frozen; }
        return { reviewedPath: frozenConfig.reviewedRelativePath, auditPath: frozenConfig.auditRelativePath };
      });
    },
    exportAuditBackup() {
      return enqueue(async () => {
        try { await writeJson(frozenConfig.auditOutputPath, buildReviewAudit(session, source.rows, now())); }
        catch { frozen = new ReviewWorkspacePersistenceError(); throw frozen; }
        return { auditPath: frozenConfig.auditRelativePath };
      });
    },
    close() { return enqueue(async () => { if (closed) return; await releaseLock(frozenConfig.lockPath, lock, dependencies.onAfterReleaseLockGuard); closed = true; }, true); },
  };
}
