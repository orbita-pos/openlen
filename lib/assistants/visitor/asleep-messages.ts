// SHE FELL ASLEEP (spec local 2026-11-06-asistente-propio, §4.7; phase 2A): «como todas las AI, sale un mensaje», but
// for the OWNER — the visitor only reads «I'm not here now». Like the apps' AI cap (lib/app-ai/cap-messages.ts): the push
// carries no prose (the server doesn't know the reader's language), the owner's email is in English. Pure and light:
// the notifications drain imports it.
import { formatCredits } from "@/lib/credits-client";
import type { AssistantAsleepEvent } from "@/lib/notifications/types";

export function asleepUrl(slug: string): string {
  return `/assistant/${encodeURIComponent(slug)}`;
}

export function asleepPush(e: AssistantAsleepEvent): { title: string; body: string; url: string } {
  return {
    title: `${e.assistantName} 💤`,
    body: e.reason === "cap" ? `${formatCredits(e.spent)} / ${formatCredits(e.cap)}` : "0",
    url: asleepUrl(e.assistantSlug),
  };
}

export function asleepEmail(e: AssistantAsleepEvent & { readonly siteUrl: string }): { subject: string; text: string } {
  const why =
    e.reason === "cap"
      ? {
          subject: `${e.assistantName} is asleep: your visitors used this month's limit`,
          line: `Your page's visitors have used ${formatCredits(e.spent)} of the ${formatCredits(e.cap)} credits you let ${e.assistantName} spend with them this month.`,
          wake: `You can raise the limit in ${e.assistantName}'s Conversations, or wait for next month.`,
        }
      : {
          subject: `${e.assistantName} is asleep: you're out of credits`,
          line: `Your account has no credits left, so ${e.assistantName} can't answer your page's visitors.`,
          wake: "Add credits or move to a bigger plan to wake her up.",
        };
  return {
    subject: why.subject,
    text: [
      "Hi,",
      "",
      why.line,
      "Until then, visitors who write in the bubble read that nobody is there right now, and get a contact form: what they leave reaches you by email.",
      why.wake,
      "",
      `${e.assistantName}'s place: ${e.siteUrl}${asleepUrl(e.assistantSlug)}`,
    ].join("\n"),
  };
}
