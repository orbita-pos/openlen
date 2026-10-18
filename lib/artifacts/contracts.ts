import { safeArtifactPath } from "./state";
import { ArtifactError, type AdapterResult } from "./types";

export function validateAdapterResult(result: AdapterResult): void {
  if (!result || !Array.isArray(result.outputs) || result.outputs.length < 1 || result.outputs.length > 100 || result.evidence?.valid !== true
    || !Array.isArray(result.evidence.checks) || result.evidence.checks.length < 1 || result.evidence.checks.some((c) => typeof c !== "string" || !c.trim()) || !Number.isFinite(Date.parse(result.evidence.checkedAt))) throw new ArtifactError("invalid_export");
  const names = new Set<string>();
  let bytes = 0;
  for (const file of result.outputs) {
    if (!file || !safeArtifactPath(file.name) || names.has(file.name) || !/^[a-z0-9_-]{1,30}$/i.test(file.format) || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(file.mime)
      || !(file.bytes instanceof Uint8Array) || !file.bytes.length) throw new ArtifactError("invalid_export");
    names.add(file.name); bytes += file.bytes.length;
  }
  if (bytes > 256 * 1024 * 1024) throw new ArtifactError("export_too_large");
}
