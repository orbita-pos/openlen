import { ArtifactError } from "./types";
import { safeArtifactPath } from "./state";

export const ARTIFACT_WORKSPACE = "/.len/artifacts/";
export function parseArtifactPath(path: string): { artifactId: string; path: string } | null {
  if (!path.startsWith(ARTIFACT_WORKSPACE)) return null;
  const match = /^\/\.len\/artifacts\/([a-zA-Z0-9_-]+)\/(.+)$/.exec(path);
  if (!match || !safeArtifactPath(match[2]!)) throw new ArtifactError("invalid_source_path");
  return { artifactId: match[1]!, path: match[2]! };
}
export function isArtifactSourcePath(path: string): boolean {
  try { return parseArtifactPath(path) !== null; } catch { return false; }
}
