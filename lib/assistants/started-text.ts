// WHAT AN AGENT SEES OF THE PROJECTS IT STARTED (spec local 2026-11-21-agente-sigue-su-proyecto): one read-only file in
// its durable message, ~/.assistant/STARTED.md — as Claude Code keeps a «Linked sessions» note with each one's name and
// id, and DeepSeek's list_agents shows each subagent's name. One block per project, oldest first: its name (the
// project's title, read live), its id (what ask_len's `project` takes) and its address once published. It changes only
// when a project is started, renamed, published or deleted: the durable message re-sends it then, and only then.
//
// Pure.
import type { MemoryFile } from "@/lib/agent/memory/memory-messages";
import { publishedHost } from "@/lib/publish/base-host";

import type { StartedProject } from "./projects";

export const ASSISTANT_STARTED_PATH = "~/.assistant/STARTED.md";
/** The whole file: 30 projects of a long name fit with room to spare. */
export const STARTED_TEXT_MAX = 4_000;
export const STARTED_LABEL = "the projects you started with Len — read-only; pass an id in ask_len's project to change one";

function block(p: StartedProject): string {
  const facts = [`id: ${p.projectId}`, ...(p.subdomain ? [publishedHost(p.subdomain)] : [])];
  // One line, whatever the title holds: a line break would break the block.
  return `# ${p.title?.replace(/\s+/g, " ").trim() || p.projectId}\n(${facts.join(" · ")})`;
}

/** Its entry in the agent's durable message. A list that couldn't be read (null) adds none: what the agent saw before
 *  stands, instead of hearing the file is now empty and starting the project again. */
export function startedMemoryFiles(projects: readonly StartedProject[] | null): MemoryFile[] {
  return projects === null ? [] : [{ path: ASSISTANT_STARTED_PATH, label: STARTED_LABEL, text: startedText(projects) }];
}

export function startedText(projects: readonly StartedProject[]): string {
  let out = "";
  for (const p of projects) {
    const next = out ? `${out}\n\n${block(p)}` : block(p);
    if (next.length > STARTED_TEXT_MAX) break;
    out = next;
  }
  return out;
}
