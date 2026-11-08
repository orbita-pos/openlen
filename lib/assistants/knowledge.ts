// WHAT THE PERSON'S OWN ASSISTANT KNOWS OF THE BUSINESS (spec local 2026-11-06-asistente-propio, §4.2, §6.4; phase 2A):
// the PUBLISHED site's text, saved each time the owner publishes with her on the page — a visitor never reads the
// draft —, and what today's assistant was taught (`settings.assistant.facts`), as the start of her memory.
import type { PublicTable } from "@/lib/db/schema";
import type { AssistantSettings, ProjectData } from "@/lib/projects/types";
import { siteToText } from "@/lib/site-assistant/extract-text";

import { canAnswer } from "./visitor/on-page";

/** As much as a visitor's turn carries of the business, in characters. */
export const KNOWLEDGE_MAX = 24_000;

/** The site's pages, as her visuals may link to them (phase 2B): `/` and each `/<slug>`, with its title. */
function pagesLine(data: ProjectData): string {
  const pages = Object.entries(data.pages ?? {}).map(([slug, p]) => (p.title?.trim() ? `/${slug} (${p.title.trim()})` : `/${slug}`));
  return `Pages: ${["/", ...pages].join(", ")}`;
}

/** The published site's text, after a line with its pages — only when there is text: an app's shell with none stays
 *  "" (she can't answer about nothing). */
export function knowledgeOf(data: ProjectData): string {
  const text = siteToText(data);
  if (!text.trim()) return "";
  return `${pagesLine(data)}\n\n${text}`.slice(0, KNOWLEDGE_MAX);
}

/** Called by publishing with her on the page, after the release is written: what was just published is what she knows
 *  — its text and what its data shows anyone (phase 2B) —, and today's assistant goes off in this same publish, the one
 *  that baked her bubble in its place (§6.4). Never fails the publish. */
export async function rememberWhatWasPublished(
  projectId: string,
  data: ProjectData,
  at: Date,
  deps: {
    save(projectId: string, text: string, at: Date, publicData: PublicTable[]): Promise<void>;
    switchOldOff(projectId: string): Promise<boolean>;
    publicData(projectId: string): Promise<PublicTable[]>;
  },
): Promise<void> {
  try {
    const text = knowledgeOf(data);
    const publicData = await deps.publicData(projectId);
    await deps.save(projectId, text, at, publicData);
    // With nothing for her to know she won't answer, so today's assistant keeps its settings.
    if (canAnswer({ knowledge: text, publicData })) await deps.switchOldOff(projectId);
  } catch (err) {
    console.warn("[assistants] what was published wasn't saved for the page's own assistant", err);
  }
}

/** Today's assistant's facts and tone, as the first lines of her memory; "" when it was taught nothing. */
export function memoryFromOldAssistant(a: AssistantSettings | undefined): string {
  const facts = a?.facts?.trim();
  if (!facts) return "";
  const tone = a?.tone?.trim();
  return [`# Lo que me enseñaron antes`, "", facts, ...(tone ? ["", `Tono que pedían: ${tone}.`] : [])].join("\n");
}
