import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { writeJsonAtomic } from "@/lib/fs/write-json-atomic";
import { canonicalJsonSha256, sha256 } from "./content-hash";
import type { BlindDecision } from "./fable-parity-scorecard";

interface FullPageScreenshotInput {
  readonly bytes: Uint8Array;
  readonly fullPage: true;
  readonly viewport: { readonly width: number; readonly height: number };
}

interface BlindSideArtifactsInput {
  readonly htmlBytes: Uint8Array;
  readonly desktop: FullPageScreenshotInput;
  readonly mobile: FullPageScreenshotInput;
}

export interface BlindComparisonArtifactsInput {
  readonly comparisonId: string;
  readonly promptManifestBytes: Uint8Array;
  readonly openLen: BlindSideArtifactsInput;
  readonly fable: BlindSideArtifactsInput;
  readonly resultBytes: Uint8Array;
}

interface ArtifactDescriptor {
  readonly path: string;
  readonly sha256: string;
}

interface ScreenshotArtifactDescriptor extends ArtifactDescriptor {
  readonly fullPage: true;
  readonly viewport: { readonly width: number; readonly height: number };
}

interface BlindSideArtifactDescriptor {
  readonly html: ArtifactDescriptor;
  readonly desktop: ScreenshotArtifactDescriptor;
  readonly mobile: ScreenshotArtifactDescriptor;
}

export interface BlindArtifactComparisonManifest {
  readonly comparisonId: string;
  readonly promptManifest: ArtifactDescriptor;
  readonly sides: { readonly A: BlindSideArtifactDescriptor; readonly B: BlindSideArtifactDescriptor };
  readonly assignment: ArtifactDescriptor;
  readonly result: ArtifactDescriptor;
}

export interface BlindArtifactManifest {
  readonly schemaVersion: "fable-parity-artifacts/1.0";
  readonly runId: string;
  readonly comparisons: readonly BlindArtifactComparisonManifest[];
}

interface BlindArtifactEnvelope {
  readonly manifest: BlindArtifactManifest;
  readonly manifestSha256: string;
}

export interface WrittenBlindArtifactBundle {
  readonly bundleRoot: string;
  readonly manifestPath: string;
  readonly manifest: BlindArtifactManifest;
  readonly manifestSha256: string;
}

export interface VerifiedBlindArtifactBundle extends WrittenBlindArtifactBundle {
  readonly verifiedArtifactBytes: ReadonlyMap<string, Uint8Array>;
}

export interface BlindReviewSource {
  readonly schemaVersion: "blind-review-source/1.0";
  readonly artifactManifestSha256: string;
  readonly comparisons: readonly {
    readonly comparisonId: string;
    readonly promptManifestUrl: string;
    readonly A: { readonly desktopUrl: string; readonly mobileUrl: string };
    readonly B: { readonly desktopUrl: string; readonly mobileUrl: string };
  }[];
}

export interface SealedBlindDecision {
  readonly schemaVersion: "blind-decision/1.0";
  readonly artifactManifestSha256: string;
  readonly decision: BlindDecision;
  readonly decisionSha256: string;
}

export interface BlindReviewSession {
  readonly schemaVersion: "blind-review-session/1.0";
  readonly reviewerSessionId: string;
  readonly artifactManifestSha256: string;
  readonly decisions: readonly SealedBlindDecision[];
  readonly completedAt: string | null;
}

const opaqueId = /^[a-f0-9]{24}$/;
const contentHash = /^sha256:[a-f0-9]{64}$/;

function validateBytes(value: Uint8Array, label: string): void {
  if ((!Buffer.isBuffer(value) && !ArrayBuffer.isView(value)) || value.byteLength === 0) throw new Error(`${label} bytes are required`);
}

function validateScreenshot(value: FullPageScreenshotInput, label: string): void {
  if (!value || value.fullPage !== true) throw new Error(`${label} must be a full-page screenshot`);
  validateBytes(value.bytes, label);
  if (!Number.isSafeInteger(value.viewport?.width) || value.viewport.width <= 0
    || !Number.isSafeInteger(value.viewport?.height) || value.viewport.height <= 0) {
    throw new Error(`${label} viewport is invalid`);
  }
}

function validateInput(input: {
  workspaceRoot: string;
  runId: string;
  comparisons: readonly BlindComparisonArtifactsInput[];
  openLenOnSideA?: (index: number) => boolean;
}): void {
  if (!input.workspaceRoot?.trim()) throw new Error("workspace root is required");
  if (!opaqueId.test(input.runId)) throw new Error("run ID must be opaque");
  if (!Array.isArray(input.comparisons) || input.comparisons.length !== 20) throw new Error("artifact bundle requires exactly 20 comparisons");
  if (input.openLenOnSideA !== undefined && typeof input.openLenOnSideA !== "function") throw new Error("invalid side randomizer");
  const ids = new Set<string>();
  for (const row of input.comparisons) {
    if (!row || !opaqueId.test(row.comparisonId) || ids.has(row.comparisonId)) throw new Error("comparison IDs must be unique and opaque");
    ids.add(row.comparisonId);
    validateBytes(row.promptManifestBytes, "prompt manifest");
    validateBytes(row.resultBytes, "result");
    validateBytes(row.openLen?.htmlBytes, "OpenLen HTML");
    validateBytes(row.fable?.htmlBytes, "Fable HTML");
    validateScreenshot(row.openLen?.desktop, "OpenLen desktop");
    validateScreenshot(row.openLen?.mobile, "OpenLen mobile");
    validateScreenshot(row.fable?.desktop, "Fable desktop");
    validateScreenshot(row.fable?.mobile, "Fable mobile");
  }
}

function descriptor(path: string, bytes: Uint8Array): ArtifactDescriptor {
  return { path, sha256: sha256(bytes) };
}

function screenshotDescriptor(path: string, screenshot: FullPageScreenshotInput): ScreenshotArtifactDescriptor {
  return { ...descriptor(path, screenshot.bytes), fullPage: true, viewport: { ...screenshot.viewport } };
}

function sideDescriptor(comparisonId: string, side: "A" | "B", input: BlindSideArtifactsInput): BlindSideArtifactDescriptor {
  const root = `comparisons/${comparisonId}/${side}`;
  return {
    html: descriptor(`${root}/page.html`, input.htmlBytes),
    desktop: screenshotDescriptor(`${root}/desktop.png`, input.desktop),
    mobile: screenshotDescriptor(`${root}/mobile.png`, input.mobile),
  };
}

async function writeArtifact(root: string, item: ArtifactDescriptor, bytes: Uint8Array): Promise<void> {
  const path = resolve(root, item.path);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes, { flag: "wx" });
}

function randomSideA(): boolean {
  const byte = new Uint8Array(1);
  globalThis.crypto.getRandomValues(byte);
  return (byte[0]! & 1) === 0;
}

export async function writeBlindArtifactBundle(input: {
  readonly workspaceRoot: string;
  readonly runId: string;
  readonly comparisons: readonly BlindComparisonArtifactsInput[];
  readonly openLenOnSideA?: (index: number) => boolean;
}): Promise<WrittenBlindArtifactBundle> {
  validateInput(input);
  const scratchRoot = resolve(input.workspaceRoot, "scratch", "fable-parity");
  const bundleRoot = resolve(scratchRoot, input.runId);
  await mkdir(scratchRoot, { recursive: true });
  await mkdir(bundleRoot);
  const comparisons: BlindArtifactComparisonManifest[] = [];
  for (let index = 0; index < input.comparisons.length; index += 1) {
    const row = input.comparisons[index]!;
    const openLenOnA = input.openLenOnSideA ? input.openLenOnSideA(index) : randomSideA();
    const sideA = openLenOnA ? row.openLen : row.fable;
    const sideB = openLenOnA ? row.fable : row.openLen;
    const promptManifest = descriptor(`comparisons/${row.comparisonId}/prompt.json`, row.promptManifestBytes);
    const sides = { A: sideDescriptor(row.comparisonId, "A", sideA), B: sideDescriptor(row.comparisonId, "B", sideB) };
    const assignmentBytes = Buffer.from(JSON.stringify({
      schemaVersion: "fable-parity-assignment/1.0",
      comparisonId: row.comparisonId,
      openLenSide: openLenOnA ? "A" : "B",
      fableSide: openLenOnA ? "B" : "A",
    }));
    const assignment = descriptor(`private/${row.comparisonId}/assignment.json`, assignmentBytes);
    const result = descriptor(`private/${row.comparisonId}/result.json`, row.resultBytes);
    await Promise.all([
      writeArtifact(bundleRoot, promptManifest, row.promptManifestBytes),
      writeArtifact(bundleRoot, sides.A.html, sideA.htmlBytes),
      writeArtifact(bundleRoot, sides.A.desktop, sideA.desktop.bytes),
      writeArtifact(bundleRoot, sides.A.mobile, sideA.mobile.bytes),
      writeArtifact(bundleRoot, sides.B.html, sideB.htmlBytes),
      writeArtifact(bundleRoot, sides.B.desktop, sideB.desktop.bytes),
      writeArtifact(bundleRoot, sides.B.mobile, sideB.mobile.bytes),
      writeArtifact(bundleRoot, assignment, assignmentBytes),
      writeArtifact(bundleRoot, result, row.resultBytes),
    ]);
    comparisons.push({ comparisonId: row.comparisonId, promptManifest, sides, assignment, result });
  }
  const manifest: BlindArtifactManifest = {
    schemaVersion: "fable-parity-artifacts/1.0",
    runId: input.runId,
    comparisons,
  };
  const manifestSha256 = canonicalJsonSha256(manifest);
  const manifestPath = resolve(bundleRoot, "manifest.json");
  await writeJsonAtomic(manifestPath, { manifest, manifestSha256 } satisfies BlindArtifactEnvelope);
  return { bundleRoot, manifestPath, manifest, manifestSha256 };
}

function inside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

export function resolveFableParityEvidencePath(workspaceRoot: string, configuredPath: string, label = "evidence"): string {
  const scratchRoot = resolve(workspaceRoot, "scratch", "fable-parity");
  const absolute = isAbsolute(configuredPath) ? resolve(configuredPath) : resolve(workspaceRoot, configuredPath);
  if (!inside(scratchRoot, absolute)) throw new Error(`${label} path must remain below scratch/fable-parity`);
  return absolute;
}

function safeArtifactPath(bundleRoot: string, path: string): string {
  if (!path || isAbsolute(path) || path.includes("\\")) throw new Error("artifact path integrity failure");
  const absolute = resolve(bundleRoot, path);
  if (!inside(bundleRoot, absolute)) throw new Error("artifact path integrity failure");
  return absolute;
}

async function verifyArtifact(
  bundleRoot: string,
  item: ArtifactDescriptor,
  paths: Set<string>,
  verifiedArtifactBytes: Map<string, Uint8Array>,
): Promise<void> {
  if (!item || !contentHash.test(item.sha256)) throw new Error("artifact hash integrity failure");
  const absolute = safeArtifactPath(bundleRoot, item.path);
  if (paths.has(absolute)) throw new Error("duplicate artifact path integrity failure");
  paths.add(absolute);
  const bytes = Buffer.from(await readFile(absolute));
  if (sha256(bytes) !== item.sha256) throw new Error("artifact hash integrity failure");
  verifiedArtifactBytes.set(absolute, bytes);
}

export async function verifyBlindArtifactBundle(
  workspaceRoot: string,
  manifestPath: string,
): Promise<VerifiedBlindArtifactBundle> {
  const scratchRoot = resolve(workspaceRoot, "scratch", "fable-parity");
  const absoluteManifestPath = isAbsolute(manifestPath) ? resolve(manifestPath) : resolve(workspaceRoot, manifestPath);
  if (!inside(scratchRoot, absoluteManifestPath) || absoluteManifestPath.split(/[\\/]/).at(-1) !== "manifest.json") {
    throw new Error("artifact manifest must be below scratch/fable-parity");
  }
  const bundleRoot = dirname(absoluteManifestPath);
  let envelope: BlindArtifactEnvelope;
  try {
    envelope = JSON.parse(await readFile(absoluteManifestPath, "utf8")) as BlindArtifactEnvelope;
  } catch {
    throw new Error("artifact manifest integrity failure");
  }
  if (!envelope || envelope.manifest?.schemaVersion !== "fable-parity-artifacts/1.0"
    || !contentHash.test(envelope.manifestSha256 ?? "")
    || canonicalJsonSha256(envelope.manifest) !== envelope.manifestSha256
    || envelope.manifest.runId !== bundleRoot.split(/[\\/]/).at(-1)
    || !Array.isArray(envelope.manifest.comparisons)
    || envelope.manifest.comparisons.length !== 20) {
    throw new Error("artifact manifest hash integrity failure");
  }
  const comparisonIds = new Set<string>();
  const paths = new Set<string>();
  const verifiedArtifactBytes = new Map<string, Uint8Array>();
  for (const row of envelope.manifest.comparisons) {
    if (!opaqueId.test(row.comparisonId) || comparisonIds.has(row.comparisonId)) throw new Error("comparison manifest integrity failure");
    comparisonIds.add(row.comparisonId);
    await verifyArtifact(bundleRoot, row.promptManifest, paths, verifiedArtifactBytes);
    await verifyArtifact(bundleRoot, row.assignment, paths, verifiedArtifactBytes);
    await verifyArtifact(bundleRoot, row.result, paths, verifiedArtifactBytes);
    for (const side of [row.sides?.A, row.sides?.B]) {
      if (!side) throw new Error("side manifest integrity failure");
      await verifyArtifact(bundleRoot, side.html, paths, verifiedArtifactBytes);
      for (const screenshot of [side.desktop, side.mobile]) {
        if (!screenshot || screenshot.fullPage !== true
          || !Number.isSafeInteger(screenshot.viewport?.width) || screenshot.viewport.width <= 0
          || !Number.isSafeInteger(screenshot.viewport?.height) || screenshot.viewport.height <= 0) {
          throw new Error("full-page screenshot integrity failure");
        }
        await verifyArtifact(bundleRoot, screenshot, paths, verifiedArtifactBytes);
      }
    }
    let assignment: Record<string, unknown>;
    try {
      const assignmentPath = safeArtifactPath(bundleRoot, row.assignment.path);
      assignment = JSON.parse(Buffer.from(verifiedArtifactBytes.get(assignmentPath)!).toString("utf8")) as Record<string, unknown>;
    } catch {
      throw new Error("side assignment integrity failure");
    }
    if (assignment.schemaVersion !== "fable-parity-assignment/1.0" || assignment.comparisonId !== row.comparisonId
      || (assignment.openLenSide !== "A" && assignment.openLenSide !== "B")
      || assignment.fableSide !== (assignment.openLenSide === "A" ? "B" : "A")) {
      throw new Error("side assignment integrity failure");
    }
  }
  return {
    bundleRoot,
    manifestPath: absoluteManifestPath,
    manifest: envelope.manifest,
    manifestSha256: envelope.manifestSha256,
    verifiedArtifactBytes,
  };
}

function artifactUrl(comparisonId: string, side: "A" | "B" | null, kind: "prompt" | "html" | "desktop" | "mobile"): string {
  return side === null ? `/artifact/${comparisonId}/prompt` : `/artifact/${comparisonId}/${side}/${kind}`;
}

export async function loadVerifiedBlindReviewSource(workspaceRoot: string, manifestPath: string): Promise<BlindReviewSource> {
  const verified = await verifyBlindArtifactBundle(workspaceRoot, manifestPath);
  return {
    schemaVersion: "blind-review-source/1.0",
    artifactManifestSha256: verified.manifestSha256,
    comparisons: verified.manifest.comparisons.map((row) => ({
      comparisonId: row.comparisonId,
      promptManifestUrl: artifactUrl(row.comparisonId, null, "prompt"),
      A: {
        desktopUrl: artifactUrl(row.comparisonId, "A", "desktop"),
        mobileUrl: artifactUrl(row.comparisonId, "A", "mobile"),
      },
      B: {
        desktopUrl: artifactUrl(row.comparisonId, "B", "desktop"),
        mobileUrl: artifactUrl(row.comparisonId, "B", "mobile"),
      },
    })),
  };
}

export async function resolveVerifiedBlindArtifact(
  workspaceRoot: string,
  manifestPath: string,
  comparisonId: string,
  side: "A" | "B" | null,
  kind: "prompt" | "html" | "desktop" | "mobile",
): Promise<{ bytes: Uint8Array; sha256: string; contentType: "application/json" | "text/html; charset=utf-8" | "image/png" }> {
  const verified = await verifyBlindArtifactBundle(workspaceRoot, manifestPath);
  const row = verified.manifest.comparisons.find((item) => item.comparisonId === comparisonId);
  if (!row) throw new Error("unknown comparison artifact");
  let item: ArtifactDescriptor;
  let contentType: "application/json" | "text/html; charset=utf-8" | "image/png";
  if (kind === "prompt") {
    if (side !== null) throw new Error("prompt artifact has no side");
    item = row.promptManifest;
    contentType = "application/json";
  } else {
    if (side !== "A" && side !== "B") throw new Error("side is required");
    item = row.sides[side][kind];
    contentType = kind === "html" ? "text/html; charset=utf-8" : "image/png";
  }
  const path = safeArtifactPath(verified.bundleRoot, item.path);
  const bytes = verified.verifiedArtifactBytes.get(path);
  if (!bytes || sha256(bytes) !== item.sha256) throw new Error("artifact hash integrity failure");
  return { bytes: Buffer.from(bytes), sha256: item.sha256, contentType };
}

function validateBlindDecision(decision: BlindDecision): void {
  if (!decision || !opaqueId.test(decision.comparisonId) || !opaqueId.test(decision.reviewerSessionId)) throw new Error("decision identities must be opaque");
  const preferences = [decision.desktopPreference, decision.mobilePreference, decision.overallPreference];
  if (preferences.some((value) => value !== "A" && value !== "B" && value !== "tie")) throw new Error("invalid blind preference");
  if (!["none", "A", "B", "both"].includes(decision.wrongNicheSide)) throw new Error("invalid wrong-niche decision");
  if (!decision.rubric || Object.keys(decision.rubric).sort().join(",") !== "coherence,fidelity,niche,polish,usability"
    || Object.values(decision.rubric).some((value) => !Number.isInteger(value) || value < 1 || value > 10)) {
    throw new Error("invalid decision rubric");
  }
}

export function createBlindReviewSession(reviewerSessionId: string, artifactManifestSha256: string): BlindReviewSession {
  if (!opaqueId.test(reviewerSessionId)) throw new Error("reviewer session ID must be opaque");
  if (!contentHash.test(artifactManifestSha256)) throw new Error("artifact manifest hash is required");
  return {
    schemaVersion: "blind-review-session/1.0",
    reviewerSessionId,
    artifactManifestSha256,
    decisions: [],
    completedAt: null,
  };
}

export function verifySealedBlindDecision(value: unknown, artifactManifestSha256: string): BlindDecision {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid sealed decision");
  const sealed = value as SealedBlindDecision;
  validateBlindDecision(sealed.decision);
  if (sealed.schemaVersion !== "blind-decision/1.0" || sealed.artifactManifestSha256 !== artifactManifestSha256
    || !contentHash.test(sealed.decisionSha256 ?? "")) throw new Error("sealed decision source mismatch");
  const { decisionSha256, ...unsigned } = sealed;
  if (canonicalJsonSha256(unsigned) !== decisionSha256) throw new Error("sealed decision hash mismatch");
  return structuredClone(sealed.decision);
}

export function sealBlindDecision(decision: BlindDecision, artifactManifestSha256: string): SealedBlindDecision {
  validateBlindDecision(decision);
  if (!contentHash.test(artifactManifestSha256)) throw new Error("artifact manifest hash is required");
  const unsigned = {
    schemaVersion: "blind-decision/1.0" as const,
    artifactManifestSha256,
    decision: structuredClone(decision),
  };
  return { ...unsigned, decisionSha256: canonicalJsonSha256(unsigned) };
}

export function verifyBlindReviewSession(value: unknown): BlindReviewSession {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid review session");
  const session = value as BlindReviewSession;
  if (session.schemaVersion !== "blind-review-session/1.0"
    || !opaqueId.test(session.reviewerSessionId)
    || !contentHash.test(session.artifactManifestSha256)
    || !Array.isArray(session.decisions)
    || (session.completedAt !== null && !Number.isFinite(Date.parse(session.completedAt)))) {
    throw new Error("invalid review session");
  }
  const comparisonIds = new Set<string>();
  for (const sealed of session.decisions) {
    const decision = verifySealedBlindDecision(sealed, session.artifactManifestSha256);
    if (decision.reviewerSessionId !== session.reviewerSessionId || comparisonIds.has(decision.comparisonId)) {
      throw new Error("review session decision identity mismatch");
    }
    comparisonIds.add(decision.comparisonId);
  }
  if (session.completedAt !== null && session.decisions.length !== 20) throw new Error("completed review session must contain exactly 20 decisions");
  return structuredClone(session);
}

export async function appendBlindDecision(
  workspaceRoot: string,
  manifestPath: string,
  session: BlindReviewSession,
  decision: BlindDecision,
): Promise<BlindReviewSession> {
  session = verifyBlindReviewSession(session);
  if (session.completedAt !== null) throw new Error("review session is completed");
  validateBlindDecision(decision);
  if (decision.reviewerSessionId !== session.reviewerSessionId) throw new Error("reviewer session mismatch");
  if (session.decisions.some((row) => row.decision.comparisonId === decision.comparisonId)) throw new Error("comparison already decided");
  const verified = await verifyBlindArtifactBundle(workspaceRoot, manifestPath);
  if (verified.manifestSha256 !== session.artifactManifestSha256) throw new Error("review artifact source mismatch");
  if (!verified.manifest.comparisons.some((row) => row.comparisonId === decision.comparisonId)) throw new Error("unknown comparison decision");
  const sealed = sealBlindDecision(decision, verified.manifestSha256);
  return { ...structuredClone(session), decisions: [...session.decisions, sealed] };
}

export function completeBlindReviewSession(session: BlindReviewSession, completedAt: string): BlindReviewSession {
  session = verifyBlindReviewSession(session);
  if (session.completedAt !== null) return structuredClone(session);
  if (session.decisions.length !== 20) throw new Error("review session is incomplete; exactly 20 decisions are required");
  if (!Number.isFinite(Date.parse(completedAt))) throw new Error("invalid completion time");
  for (const sealed of session.decisions) verifySealedBlindDecision(sealed, session.artifactManifestSha256);
  return { ...structuredClone(session), completedAt };
}

const sessionQueues = new Map<string, Promise<void>>();

async function withSessionQueue<T>(path: string, action: () => Promise<T>): Promise<T> {
  const previous = sessionQueues.get(path) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolveGate) => { release = resolveGate; });
  const current = previous.catch(() => undefined).then(() => gate);
  sessionQueues.set(path, current);
  await previous.catch(() => undefined);
  try {
    return await action();
  } finally {
    release();
    if (sessionQueues.get(path) === current) sessionQueues.delete(path);
  }
}

async function readSessionFile(path: string): Promise<BlindReviewSession> {
  try {
    return verifyBlindReviewSession(JSON.parse(await readFile(path, "utf8")));
  } catch {
    throw new Error("review session file is invalid");
  }
}

export async function ensureBlindReviewSessionFile(
  workspaceRoot: string,
  configuredPath: string,
  initial: BlindReviewSession,
): Promise<BlindReviewSession> {
  const path = resolveFableParityEvidencePath(workspaceRoot, configuredPath, "review session");
  const verifiedInitial = verifyBlindReviewSession(initial);
  return withSessionQueue(path, async () => {
    try {
      const existing = await readSessionFile(path);
      if (existing.reviewerSessionId !== verifiedInitial.reviewerSessionId
        || existing.artifactManifestSha256 !== verifiedInitial.artifactManifestSha256) {
        throw new Error("review session source mismatch");
      }
      return existing;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && !String(error).includes("review session file is invalid")) throw error;
      try {
        await readFile(path, "utf8");
        throw error;
      } catch (readError) {
        if ((readError as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      await mkdir(dirname(path), { recursive: true });
      await writeJsonAtomic(path, verifiedInitial);
      return structuredClone(verifiedInitial);
    }
  });
}

export async function appendBlindDecisionToSessionFile(
  workspaceRoot: string,
  manifestPath: string,
  configuredSessionPath: string,
  decision: BlindDecision | Omit<BlindDecision, "reviewerSessionId">,
): Promise<BlindReviewSession> {
  const path = resolveFableParityEvidencePath(workspaceRoot, configuredSessionPath, "review session");
  return withSessionQueue(path, async () => {
    const session = await readSessionFile(path);
    const updated = await appendBlindDecision(workspaceRoot, manifestPath, session, {
      ...decision,
      reviewerSessionId: "reviewerSessionId" in decision ? decision.reviewerSessionId : session.reviewerSessionId,
    });
    await writeJsonAtomic(path, updated);
    return updated;
  });
}

export async function completeBlindReviewSessionFile(
  workspaceRoot: string,
  manifestPath: string,
  configuredSessionPath: string,
  completedAt: string,
): Promise<BlindReviewSession> {
  const path = resolveFableParityEvidencePath(workspaceRoot, configuredSessionPath, "review session");
  return withSessionQueue(path, async () => {
    const session = await readSessionFile(path);
    const verified = await verifyBlindArtifactBundle(workspaceRoot, manifestPath);
    if (verified.manifestSha256 !== session.artifactManifestSha256) throw new Error("review artifact source mismatch");
    const completed = completeBlindReviewSession(session, completedAt);
    await writeJsonAtomic(path, completed);
    return completed;
  });
}
