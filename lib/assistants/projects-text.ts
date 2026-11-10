// WHAT SHE KNOWS OF EACH PROJECT SHE SERVES, WITH HER OWNER (spec local 2026-11-06-asistente-propio, §4.5, §6.7): one
// read-only file in her durable message, ~/.assistant/PROJECTS.md — her home first, each with its id (what `ask_len`
// takes), its address, whether her bubble is on it, and what it published. Her turn runs in her home (its box, its
// files); of the others she knows what they published, and what must be looked at or built there Len does, with
// `ask_len`. It changes only when a project is published or she joins or leaves one: the durable message re-sends it
// then, and only then (`memoryMessageForTurn`).
//
// Pure.
import { publishedHost } from "@/lib/publish/base-host";

import type { ServedProject } from "./projects";

export const ASSISTANT_PROJECTS_PATH = "~/.assistant/PROJECTS.md";
/** What one project's published text takes, in characters. */
export const PROJECT_TEXT_MAX = 4_000;
/** The whole file. */
export const PROJECTS_TEXT_MAX = 16_000;

function header(p: ServedProject): string {
  const facts = [`id: ${p.projectId}`, ...(p.subdomain ? [publishedHost(p.subdomain)] : []), ...(p.isHome ? ["your home"] : []), ...(p.onPage ? ["on its page"] : [])];
  return `# ${p.title?.trim() || p.projectId}\n(${facts.join(" · ")})`;
}

export function projectsText(projects: readonly ServedProject[]): string {
  let out = "";
  for (const p of projects) {
    const body = p.knowledge?.trim() ? p.knowledge.trim().slice(0, PROJECT_TEXT_MAX) : "(not published yet)";
    const block = `${header(p)}\n\n${body}`;
    const next = out ? `${out}\n\n${block}` : block;
    if (next.length > PROJECTS_TEXT_MAX) {
      // What fits of this one, then nothing more: the projects before it are whole.
      const room = PROJECTS_TEXT_MAX - out.length - (out ? 2 : 0);
      if (room > header(p).length + 2) out = out ? `${out}\n\n${block.slice(0, room)}` : block.slice(0, room);
      break;
    }
    out = next;
  }
  return out;
}
