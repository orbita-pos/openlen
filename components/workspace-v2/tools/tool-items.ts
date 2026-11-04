// WHERE INSTALLED TOOLS SHOW UP (spec local 2026-11-04-herramientas-hechas-por-len, §4.3): a `rail` tool is an icon in
// the rail's own group; a `project` tool is one more lens of every project the person opens. Only the ones switched
// on that can open. Pure.
import type { InstalledToolView } from "@/lib/tools/types";

import type { RailToolItem } from "../rail-model";

const canOpen = (t: InstalledToolView) => t.enabled && t.status === "ok" && !!t.frameUrl;

export function railToolItems(tools: readonly InstalledToolView[]): RailToolItem[] {
  return tools.filter((t) => t.placement === "rail" && canOpen(t)).map((t) => ({ kind: "tool", id: t.id, name: t.title, iconUrl: t.iconUrl }));
}

export function projectToolItems(tools: readonly InstalledToolView[]): InstalledToolView[] {
  return tools.filter((t) => t.placement === "project" && canOpen(t));
}

/** What a tool's `sendPrompt` puts in Len's composer (§4.4): its text quoted, signed with the tool's name. */
export function toolPromptDraft(text: string, toolTitle: string): string {
  const quoted = text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  return `${quoted}\n\n— ${toolTitle}\n`;
}

export type ToolLens = `tool:${string}`;

export function toolLens(id: string): ToolLens {
  return `tool:${id}`;
}

export function toolIdOfLens(lens: string): string | null {
  return lens.startsWith("tool:") ? lens.slice(5) : null;
}
