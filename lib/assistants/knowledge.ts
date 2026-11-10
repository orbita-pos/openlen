// WHAT THE PERSON'S OWN ASSISTANT KNOWS OF THE BUSINESS (spec local 2026-11-06-asistente-propio, §4.2, §6.4; phase 2A):
// the PUBLISHED site's text, saved each time the owner publishes with her on the page — a visitor never reads the
// draft —, and what today's assistant was taught (`settings.assistant.facts`), as the start of her memory.
import type { PublicTable } from "@/lib/db/schema";
import type { AssistantSettings, ProjectData } from "@/lib/projects/types";
import { siteToText } from "@/lib/site-assistant/extract-text";

import { canAnswer } from "./visitor/on-page";

/** As much as a visitor's turn carries of the business, in characters. */
export const KNOWLEDGE_MAX = 24_000;

/** The site as a stranger sees it: without its members-only pages (final review I6) — never in what she knows, never
 *  in her links. */
function publicSite(data: ProjectData): ProjectData {
  const pages = Object.fromEntries(Object.entries(data.pages ?? {}).filter(([, p]) => !p.membersOnly));
  return { ...data, pages };
}

/** The site's pages, as her visuals may link to them (phase 2B): `/` and each `/<slug>`, with its title. */
function pagesLine(data: ProjectData): string {
  const pages = Object.entries(data.pages ?? {}).map(([slug, p]) => (p.title?.trim() ? `/${slug} (${p.title.trim()})` : `/${slug}`));
  return `Pages: ${["/", ...pages].join(", ")}`;
}

/** The published site's text, after a line with its pages — only when there is text: an app's shell with none stays
 *  "" (she can't answer about nothing). */
export function knowledgeOf(site: ProjectData): string {
  const data = publicSite(site);
  const text = siteToText(data);
  if (!text.trim()) return "";
  return `${pagesLine(data)}\n\n${text}`.slice(0, KNOWLEDGE_MAX);
}

/** Called by publishing a project she serves, after the release is written: what was just published is what she knows
 *  of it — its text and what its data shows anyone (phase 2B). With her on the page (`onPage`) that publish baked her
 *  bubble, and today's assistant goes off in it, the one hers replaced (§6.4). Never fails the publish. */
export async function rememberWhatWasPublished(
  projectId: string,
  data: ProjectData,
  at: Date,
  deps: {
    save(projectId: string, text: string, at: Date, publicData: PublicTable[] | null, o: { readonly baked: boolean }): Promise<void>;
    switchOldOff(projectId: string): Promise<boolean>;
    /** null = couldn't be read this time: what she had stays. */
    publicData(projectId: string): Promise<PublicTable[] | null>;
  },
  o: { readonly onPage: boolean },
): Promise<void> {
  try {
    const text = knowledgeOf(data);
    const publicData = await deps.publicData(projectId);
    await deps.save(projectId, text, at, publicData, { baked: o.onPage });
    // Not her bubble, or nothing for her to know: today's assistant keeps its settings.
    if (o.onPage && canAnswer({ knowledge: text, publicData: publicData ?? [] })) await deps.switchOldOff(projectId);
  } catch (err) {
    console.warn("[assistants] what was published wasn't saved for the page's own assistant", err);
  }
}

/** Connecting her to a project (phase 4, §6.4 applied to connecting): what today's assistant of that project was taught
 *  is added to her memory, under the project's name, never past `max` (her memory's cap) — her own lines are kept whole,
 *  the added block is cut. Unchanged when there is nothing to add, or it is already there. */
export function mergeOldAssistantMemory(memory: string, old: AssistantSettings | undefined, projectTitle: string, max: number): string {
  const added = memoryFromOldAssistant(old);
  if (!added) return memory;
  const block = added.replace(/^# Lo que me enseñaron antes/, `# Lo que me enseñaron antes en ${projectTitle}`);
  if (memory.includes(block)) return memory;
  const base = memory.trimEnd();
  const room = max - base.length - (base ? 2 : 0);
  if (room <= 0) return memory;
  return base ? `${base}

${block.slice(0, room)}` : block.slice(0, room);
}

/** Today's assistant's facts and tone, as the first lines of her memory; "" when it was taught nothing. */
export function memoryFromOldAssistant(a: AssistantSettings | undefined): string {
  const facts = a?.facts?.trim();
  if (!facts) return "";
  const tone = a?.tone?.trim();
  return [`# Lo que me enseñaron antes`, "", facts, ...(tone ? ["", `Tono que pedían: ${tone}.`] : [])].join("\n");
}
