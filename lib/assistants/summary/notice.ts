// THE MORNING SUMMARY'S PUSH ON THE WEB (spec local 2026-11-06-asistente-propio, §6.9, phase 4D): its texts come
// written; it opens her place, in the language it was turned on in. Pure.
import type { AssistantSummaryEvent } from "@/lib/notifications/types";

export function summaryPush(event: AssistantSummaryEvent): { title: string; body: string; url: string } {
  return { title: event.title, body: event.push, url: `/${event.locale}/assistant/${encodeURIComponent(event.assistantSlug)}` };
}
