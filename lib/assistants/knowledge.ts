// WHAT THE PERSON'S OWN ASSISTANT KNOWS OF THE BUSINESS (spec local 2026-11-06-asistente-propio, §4.2, §6.4; phase 2A):
// the PUBLISHED site's text, saved each time the owner publishes with her on the page — a visitor never reads the
// draft —, and what today's assistant was taught (`settings.assistant.facts`), as the start of her memory.
import type { AssistantSettings, ProjectData } from "@/lib/projects/types";
import { siteToText } from "@/lib/site-assistant/extract-text";

/** As much as a visitor's turn carries of the business, in characters. */
export const KNOWLEDGE_MAX = 24_000;

export function knowledgeOf(data: ProjectData): string {
  return siteToText(data).slice(0, KNOWLEDGE_MAX);
}

/** Called by publishing with her on the page, after the release is written: what was just published is what she knows,
 *  and today's assistant goes off in this same publish — the one that baked her bubble in its place (§6.4). Never fails
 *  the publish. */
export async function rememberWhatWasPublished(
  projectId: string,
  data: ProjectData,
  at: Date,
  deps: { save(projectId: string, text: string, at: Date): Promise<void>; switchOldOff(projectId: string): Promise<boolean> },
): Promise<void> {
  try {
    await deps.save(projectId, knowledgeOf(data), at);
    await deps.switchOldOff(projectId);
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
