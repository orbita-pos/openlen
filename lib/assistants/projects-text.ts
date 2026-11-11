// WHAT SHE KNOWS OF EACH PROJECT SHE SERVES, WITH HER OWNER (spec local 2026-11-06-asistente-propio, §4.5, §6.7): one
// read-only file in her durable message, ~/.assistant/PROJECTS.md — her home first, each with its id (what `ask_len`
// takes), its address, where its files are, whether her bubble is on it, and what it published. Her turn runs in her
// home (its box, its files); the others she reads under ~/.assistant/projects/<id> (phase 4B, `served-folders.ts`), and
// what must be built there Len does, with `ask_len`. It changes only when a project is published or she joins or
// leaves one: the durable message re-sends it then, and only then (`memoryMessageForTurn`).
//
// Pure.
import { publishedHost } from "@/lib/publish/base-host";

import type { ServedProject } from "./projects";
import { servedFolderOf } from "./served-folders";

export const ASSISTANT_PROJECTS_PATH = "~/.assistant/PROJECTS.md";
/** What one project's published text takes, in characters. */
export const PROJECT_TEXT_MAX = 4_000;
/** The whole file.
 *
 *  MEASURED on 10/11 (phase 4, task 8: real turns on a throwaway base through Len's route with a phone key, DeepSeek
 *  V4.1 Flash; Lucía serving «Pastelería Canela» — her home, her bubble on — and «Canela Tienda»): 95 centicredits in
 *  all ($0.0029). «¿Qué vendemos en la tienda?» — 66 (the first call of her prefix, ~19.5k tokens, uncached), 7.7 s: the
 *  three products and the delivery terms, read from this file. «Dile a Len que en la tienda ponga el horario» — 7, 3.5 s:
 *  ask_len with the shop's id, and she told the owner it is in Canela Tienda's chat. «Dile a Len que cambie el botón» —
 *  15: ask_len to the shop WITHOUT asking which (both pages have a button; the turn before was about the shop). A
 *  visitor of the pastry shop's bubble asking «¿hacen envíos?» — 7, 1.6 s: the shop's delivery, by name, no link, plus
 *  pickup at the pastry shop. The queued Len turns were recorded, not run. */
export const PROJECTS_TEXT_MAX = 16_000;

function header(p: ServedProject): string {
  const facts = [
    `id: ${p.projectId}`,
    ...(p.subdomain ? [publishedHost(p.subdomain)] : []),
    // Phase 4B: where Read, Glob and Grep find its files, as Claude Code lists an added working directory. Her home's
    // are the project's own, at /.
    ...(p.isHome ? ["your home"] : [`files: ${servedFolderOf(p.projectId)}`]),
    ...(p.onPage ? ["on its page"] : []),
  ];
  return `# ${p.title?.trim() || p.projectId}\n(${facts.join(" · ")})`;
}

/** Why there is nothing of a project to read (final review I2): «not published» only when it isn't. */
function nothingToReadOf(p: ServedProject): string {
  if (p.knowledgeAt) return "(published, with no text to read)";
  if (p.subdomain) return "(published before you served it: you'll know it after its next publish)";
  return "(not published yet)";
}

export function projectsText(projects: readonly ServedProject[]): string {
  let out = "";
  for (const p of projects) {
    const body = p.knowledge?.trim() ? p.knowledge.trim().slice(0, PROJECT_TEXT_MAX) : nothingToReadOf(p);
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
