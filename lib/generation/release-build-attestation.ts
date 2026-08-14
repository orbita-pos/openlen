import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { writeJsonAtomic } from "@/lib/fs/write-json-atomic";
import { canonicalJsonSha256, sha256 } from "./content-hash";

const CONTENT_HASH = /^sha256:[a-f0-9]{64}$/;
const REVISION = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
const BUILD_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;

export const RELEASE_BUILD_ATTESTATION_PATH = ".next/standalone/.openlen-build-attestation.json";

const RELEASE_CRITICAL_ROOT_ARTIFACT_PATHS = Object.freeze([
  "server.js",
  "package.json",
  ".next/BUILD_ID",
  ".next/app-build-manifest.json",
  ".next/app-path-routes-manifest.json",
  ".next/build-manifest.json",
  ".next/required-server-files.json",
  ".next/routes-manifest.json",
] as const);

export interface ReleaseBuildArtifactDigest {
  readonly path: string;
  readonly byteLength: number;
  readonly sha256: string;
}

export interface ReleaseBuildAttestation {
  readonly schemaVersion: "openlen-standalone-build-attestation/1.0";
  readonly sourceRevision: string;
  readonly buildId: string;
  readonly artifacts: readonly ReleaseBuildArtifactDigest[];
  readonly artifactDigest: string;
  readonly attestationSha256: string;
}

function exactKeys(value: object, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

async function readReleaseArtifacts(workspaceRoot: string): Promise<{
  readonly buildId: string;
  readonly artifacts: ReleaseBuildArtifactDigest[];
}> {
  const standaloneRoot = resolve(workspaceRoot, ".next", "standalone");
  const artifactPaths = new Set<string>(RELEASE_CRITICAL_ROOT_ARTIFACT_PATHS);
  async function collect(relativeDirectory: string): Promise<void> {
    const entries = await readdir(resolve(standaloneRoot, ...relativeDirectory.split("/")), { withFileTypes: true });
    for (const entry of entries) {
      const path = `${relativeDirectory}/${entry.name}`;
      if (entry.isDirectory()) await collect(path);
      else if (entry.isFile()) artifactPaths.add(path);
      else throw new Error(`release-critical standalone artifact is not a regular file: ${path}`);
    }
  }
  try { await collect(".next/server"); } catch (error) {
    if (String(error).includes("not a regular file")) throw error;
    throw new Error("release-critical standalone server output is missing");
  }
  const artifacts: ReleaseBuildArtifactDigest[] = [];
  for (const path of [...artifactPaths].sort()) {
    let bytes: Buffer;
    try {
      bytes = await readFile(resolve(standaloneRoot, ...path.split("/")));
    } catch {
      throw new Error(`release-critical standalone artifact is missing: ${path}`);
    }
    if (bytes.byteLength === 0 || bytes.byteLength > 32 * 1024 * 1024) {
      throw new Error(`release-critical standalone artifact has invalid size: ${path}`);
    }
    artifacts.push({ path, byteLength: bytes.byteLength, sha256: sha256(bytes) });
  }
  const buildId = (await readFile(resolve(standaloneRoot, ".next", "BUILD_ID"), "utf8")).trim();
  if (!BUILD_ID.test(buildId)) throw new Error("standalone BUILD_ID is invalid");
  return { buildId, artifacts };
}

function unsignedAttestation(input: {
  readonly sourceRevision: string;
  readonly buildId: string;
  readonly artifacts: readonly ReleaseBuildArtifactDigest[];
}) {
  const artifactDigest = canonicalJsonSha256(input.artifacts);
  return {
    schemaVersion: "openlen-standalone-build-attestation/1.0" as const,
    ...input,
    artifactDigest,
  };
}

export async function createReleaseBuildAttestation(
  workspaceRoot: string,
  sourceRevision: string,
): Promise<ReleaseBuildAttestation> {
  if (!REVISION.test(sourceRevision)) throw new Error("release source revision is invalid");
  const actual = await readReleaseArtifacts(workspaceRoot);
  const unsigned = unsignedAttestation({ sourceRevision, ...actual });
  return { ...unsigned, attestationSha256: canonicalJsonSha256(unsigned) };
}

export async function writeReleaseBuildAttestation(
  workspaceRoot: string,
  sourceRevision: string,
): Promise<ReleaseBuildAttestation> {
  const attestation = await createReleaseBuildAttestation(workspaceRoot, sourceRevision);
  await writeJsonAtomic(resolve(workspaceRoot, ...RELEASE_BUILD_ATTESTATION_PATH.split("/")), attestation);
  return attestation;
}

export async function verifyReleaseBuildAttestation(
  workspaceRoot: string,
  expectedSourceRevision?: string,
): Promise<ReleaseBuildAttestation> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(resolve(workspaceRoot, ...RELEASE_BUILD_ATTESTATION_PATH.split("/")), "utf8"));
  } catch {
    throw new Error("standalone build attestation is absent or invalid");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("standalone build attestation is invalid");
  const stored = parsed as ReleaseBuildAttestation;
  if (!exactKeys(stored, ["schemaVersion", "sourceRevision", "buildId", "artifacts", "artifactDigest", "attestationSha256"])
    || stored.schemaVersion !== "openlen-standalone-build-attestation/1.0"
    || !REVISION.test(stored.sourceRevision)
    || !BUILD_ID.test(stored.buildId)
    || !CONTENT_HASH.test(stored.artifactDigest)
    || !CONTENT_HASH.test(stored.attestationSha256)
    || !Array.isArray(stored.artifacts)
    || stored.artifacts.length < RELEASE_CRITICAL_ROOT_ARTIFACT_PATHS.length + 1) {
    throw new Error("standalone build attestation schema is invalid");
  }
  if (expectedSourceRevision !== undefined && stored.sourceRevision !== expectedSourceRevision) {
    throw new Error("standalone build attestation source revision is stale");
  }
  const actual = await createReleaseBuildAttestation(workspaceRoot, stored.sourceRevision);
  if (canonicalJsonSha256(stored.artifacts) !== stored.artifactDigest
    || actual.buildId !== stored.buildId
    || actual.artifactDigest !== stored.artifactDigest
    || actual.attestationSha256 !== stored.attestationSha256) {
    throw new Error("standalone build attestation does not match release artifacts");
  }
  for (let index = 0; index < stored.artifacts.length; index += 1) {
    const item = stored.artifacts[index]!;
    if (!exactKeys(item, ["path", "byteLength", "sha256"])
      || item.path !== actual.artifacts[index]?.path
      || !Number.isSafeInteger(item.byteLength) || item.byteLength <= 0
      || !CONTENT_HASH.test(item.sha256)) {
      throw new Error("standalone build artifact ledger is invalid");
    }
  }
  return structuredClone(stored);
}
