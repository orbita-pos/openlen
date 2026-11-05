// WHERE INSTALLED TOOLS SHOW UP (spec local 2026-11-04-herramientas-hechas-por-len, §4.3): a `rail` tool is an icon in
// the rail's own group; a `project` tool is one more lens of every project the person opens. Only the ones switched
// on that can open. Pure.
import type { InstalledToolView } from "@/lib/tools/types";

import type { RailToolItem } from "../rail-model";

import type { BridgeHostCaller } from "./use-tool-bridge-host";

export { toolPromptDraft } from "@/lib/tools/prompt-draft";

const canOpen = (t: InstalledToolView) => t.enabled && t.status === "ok" && !!t.frameUrl;

export function railToolItems(tools: readonly InstalledToolView[]): RailToolItem[] {
  return tools.filter((t) => t.placement === "rail" && canOpen(t)).map((t) => ({ kind: "tool", id: t.id, name: t.title, iconUrl: t.iconUrl, iconTinted: t.iconTinted }));
}

export function projectToolItems(tools: readonly InstalledToolView[]): InstalledToolView[] {
  return tools.filter((t) => t.placement === "project" && canOpen(t));
}

export type ToolLens = `tool:${string}`;

export function toolLens(id: string): ToolLens {
  return `tool:${id}`;
}

export function toolIdOfLens(lens: string): string | null {
  return lens.startsWith("tool:") ? lens.slice(5) : null;
}

/** A TOOL BEING BUILT runs in the project's real canvas with `window.openlen` in it; the workspace answers it there as
 *  the DRAFT (test database, no production writes). Null where there is nothing to answer: a page or an app, the local
 *  shell (no real canvas, nothing that calls), or no project. */
export function draftCanvasBridge(i: {
  readonly isTool: boolean;
  readonly remoteUrl: string | null;
  readonly projectId: string | null | undefined;
}): { readonly frameOrigin: string; readonly caller: BridgeHostCaller } | null {
  if (!i.isTool || !i.remoteUrl || !i.projectId) return null;
  try {
    return { frameOrigin: new URL(i.remoteUrl).origin, caller: { draftProjectId: i.projectId } };
  } catch {
    return null;
  }
}

/** What an installed tool's `context().tool` says: its own PROJECT — the same id it has in its canvas and in Len's
 *  eyes, so code that leaves the tool out of `projects()` works everywhere (found in the real turn) — and the release
 *  it runs. The installation's id is OpenLen's, not the tool's. */
export function installedToolIdentity(tool: Pick<InstalledToolView, "projectId" | "releaseSha">): { readonly id: string; readonly version: string } {
  return { id: tool.projectId, version: tool.releaseSha };
}
