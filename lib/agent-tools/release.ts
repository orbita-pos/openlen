// THE PUBLISHED VERSION OF AN AGENT'S TOOL (spec local 2026-11-22-herramienta-dentro-del-agente, §3): what the agent wrote in
// `/tools/<agent slug>/<tool>/` is a folder of the space's project; publishing freezes it as a VERSION — the files
// re-rooted at `/`, as the tool's own host serves them — and the tab shows that copy, never the folder mid-edit. This is the
// pure half: the files come in, the version (or why not) goes out; nothing here reads the database or saves anything.
import { createHash } from "node:crypto";

import { contentTypeFor } from "@/lib/agent/ficheros/folder";
import { sizeOf } from "@/lib/files/blob-pointer";
import type { ToolReleaseFile } from "@/lib/tools/types";

import { AGENT_TOOL_VERSION_MAX_BYTES } from "./limits";

export type AgentToolReleaseError = "no_index" | "too_big" | "empty";

export type AgentToolRelease =
  | { readonly ok: true; readonly sha: string; readonly files: Record<string, ToolReleaseFile> }
  | { readonly ok: false; readonly error: AgentToolReleaseError };

/** The version's id: the space's project and every (path, content) pair in path order. Each piece goes in with its length,
 *  so `a` + `bc` and `ab` + `c` are two versions. */
function shaOf(spaceProjectId: string, files: Readonly<Record<string, ToolReleaseFile>>): string {
  const h = createHash("sha256");
  h.update(`${spaceProjectId.length}:${spaceProjectId}\n`);
  for (const path of Object.keys(files).sort()) {
    const { content } = files[path]!;
    h.update(`${path.length}:${path}\n${content.length}:${content}\n`);
  }
  return h.digest("hex");
}

/**
 * `folder` is the tool's folder (`/tools/ana/recorrido`, with or without the trailing slash) and `files` the space's files
 * by absolute path. Only what is strictly under `folder + "/"` is the tool's: `/tools/ana/recorrido-2/…` is another folder.
 * A text file keeps its text and a binary its blob pointer (`lib/files/blob-pointer.ts`), like a published page's release.
 */
export function buildAgentToolRelease(p: {
  readonly spaceProjectId: string;
  readonly folder: string;
  readonly files: Readonly<Record<string, string>>;
}): AgentToolRelease {
  const root = p.folder.replace(/\/+$/, "");
  // the root of the project is not a tool's folder: that would publish the whole space
  if (!root) return { ok: false, error: "empty" };
  const prefix = `${root}/`;

  const files: Record<string, ToolReleaseFile> = {};
  let bytes = 0;
  for (const [path, content] of Object.entries(p.files)) {
    if (!path.startsWith(prefix) || path.length === prefix.length) continue;
    const rerooted = path.slice(root.length);
    files[rerooted] = { content, contentType: contentTypeFor(rerooted) };
    bytes += sizeOf(content);
  }

  if (Object.keys(files).length === 0) return { ok: false, error: "empty" };
  if (!files["/index.html"]) return { ok: false, error: "no_index" };
  if (bytes > AGENT_TOOL_VERSION_MAX_BYTES) return { ok: false, error: "too_big" };
  return { ok: true, sha: shaOf(p.spaceProjectId, files), files };
}
