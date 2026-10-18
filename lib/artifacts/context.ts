import { createHash } from "node:crypto";
import { requireProjectAccess } from "./access";
import { safeArtifactPath } from "./state";
import { classifyFolderPath } from "../agent/ficheros/folder";
import { ArtifactError, type ArtifactContext, type ArtifactDatabase, type ArtifactSourceRef } from "./types";

export interface ArtifactProjectSources {
  readonly files: Readonly<Record<string, string>>;
  readonly settings: Readonly<Record<string, unknown>>;
}
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
function allowed(path: string): boolean {
  if (!path.startsWith("/") || !safeArtifactPath(path.slice(1))) return false;
  if (path === "/index.html" || /^\/[A-Za-z0-9_-]+\/index\.html$/.test(path)) return true;
  const kind = classifyFolderPath(path);
  return kind.ok && (kind.kind === "web" || kind.kind === "manifest");
}

export function createArtifactContextCapture(database: ArtifactDatabase, load: (projectId: string, paths: readonly string[]) => Promise<ArtifactProjectSources>) {
  return async function captureArtifactContext(ctx: ArtifactContext, paths: readonly string[]): Promise<ArtifactSourceRef> {
    await requireProjectAccess(database, ctx);
    if (!Array.isArray(paths) || paths.length === 0 || paths.length > 100 || paths.some((p) => typeof p !== "string" || !allowed(p))) throw new ArtifactError("context_source_forbidden");
    const source = await load(ctx.projectId, paths);
    const files: Record<string, string> = Object.create(null);
    const resources = new Set<string>();
    for (const path of [...new Set(paths)].sort()) {
      const text = source.files[path];
      if (typeof text !== "string") throw new ArtifactError("context_source_not_found");
      files[path] = hash(text);
      // References only: no fetch, cookies, credentials or signed query URLs.
      for (const match of text.matchAll(/https:\/\/[^\s"'<>`)]+/g)) {
        try {
          const url = new URL(match[0]);
          if (!url.username && !url.password && !url.search && !url.hash && /\.(png|jpe?g|webp|svg|gif|avif|mp4|woff2?)$/i.test(url.pathname) && resources.size < 100) resources.add(url.href);
        } catch { /* malformed author URL is not a resource */ }
      }
    }
    // Allowlist public settings. Do not even hash assistant facts, recipient
    // emails, preview tokens or integration credentials into this descriptor.
    const languages = Array.isArray(source.settings.languages) ? source.settings.languages.filter((s) => typeof s === "string").sort() : [];
    return { files, settingsHash: hash(JSON.stringify({ languages, analyticsDisabled: source.settings.analyticsDisabled === true })), resourceRefs: [...resources].sort(), capturedAt: new Date().toISOString() };
  };
}
