import { ArtifactError, type ArtifactOutput, type ArtifactStatus } from "./types";

export function safeArtifactPath(path: string): boolean {
  return path.length > 0 && path.length <= 512 && !/[\\\u0000-\u001f:]/.test(path)
    && path.split("/").every((p) => p !== "" && p !== "." && p !== ".." && p !== "__proto__" && p !== "constructor" && p !== "prototype");
}

export function validateArtifactFiles(files: Readonly<Record<string, string>>): Record<string, string> {
  if (!files || typeof files !== "object" || Array.isArray(files)) throw new ArtifactError("invalid_files");
  let bytes = 0;
  const result: Record<string, string> = Object.create(null);
  for (const [path, content] of Object.entries(files)) {
    if (!safeArtifactPath(path) || typeof content !== "string") throw new ArtifactError("invalid_source_path");
    bytes += Buffer.byteLength(content, "utf8");
    result[path] = content;
  }
  if (Object.keys(result).length > 200 || bytes > 5 * 1024 * 1024) throw new ArtifactError("sources_too_large");
  return result;
}

export function validateArtifactOutputs(outputs: readonly ArtifactOutput[]): readonly ArtifactOutput[] {
  if (!Array.isArray(outputs) || outputs.length === 0 || outputs.length > 100) throw new ArtifactError("invalid_outputs");
  const names = new Set<string>();
  for (const o of outputs) {
    if (!o || !safeArtifactPath(o.key) || !/^[a-f0-9]{64}$/.test(o.hash) || !Number.isSafeInteger(o.bytes) || o.bytes <= 0
      || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(o.mime) || !/^[a-z0-9_-]{1,30}$/.test(o.format) || names.has(o.key)) throw new ArtifactError("invalid_outputs");
    names.add(o.key);
  }
  return outputs;
}

export function artifactProgress(artifacts: readonly { currentRevision: number; lastReadyRevision: number | null; status: ArtifactStatus }[]) {
  const result = { total: artifacts.length, ready: 0, pending: 0, active: 0, failed: 0 };
  for (const a of artifacts) {
    if (a.status === "ready" && a.lastReadyRevision === a.currentRevision) result.ready++;
    else if (["failed", "cancelled", "needs_attention"].includes(a.status)) result.failed++;
    else if (["running", "validating", "storing"].includes(a.status)) result.active++;
    else result.pending++;
  }
  return result;
}
