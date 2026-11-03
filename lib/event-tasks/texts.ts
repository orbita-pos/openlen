// AN EVENT TASK'S WORDS in its creator's language (spec local 2026-11-03-len-que-avisa, §7.6, §7.7): the email
// of a card and the chat row of «Hazlo», written when they are made — the channels only carry them. Like Len
// Watch's (lib/len-watch/texts.ts). The texts live in `messages/<locale>/panelsChat.json` (`eventTasks`).
import { createTranslator } from "next-intl";

import de from "@/messages/de/panelsChat.json";
import en from "@/messages/en/panelsChat.json";
import es from "@/messages/es/panelsChat.json";
import fr from "@/messages/fr/panelsChat.json";
import it from "@/messages/it/panelsChat.json";
import ja from "@/messages/ja/panelsChat.json";
import ko from "@/messages/ko/panelsChat.json";
import nl from "@/messages/nl/panelsChat.json";
import pt from "@/messages/pt/panelsChat.json";
import zh from "@/messages/zh/panelsChat.json";
import { idiomaDelCorreo } from "@/lib/projects/correos-del-proyecto";

const MESSAGES = { de, en, es, fr, it, ja, ko, nl, pt, zh } as const;

type Translate = (key: string, values?: Record<string, string>) => string;

const translator = (locale: string): Translate => {
  const l = idiomaDelCorreo(locale);
  return createTranslator({ locale: l, messages: MESSAGES[l], namespace: "eventTasks" }) as unknown as Translate;
};

export function cardEmail(locale: string, o: { readonly task: string; readonly title: string; readonly summary: string; readonly action: string; readonly url: string }): { subject: string; text: string } {
  const t = translator(locale);
  return { subject: t("notice.emailSubject", { task: o.task, title: o.title }), text: t("notice.emailText", { summary: o.summary, action: o.action, url: o.url }) };
}

/** What the chat row of an accepted card's turn shows as its message (the model reads the framing instead). */
export function acceptedTurnPrompt(locale: string, task: string): string {
  return translator(locale)("turnPrompt", { task });
}
