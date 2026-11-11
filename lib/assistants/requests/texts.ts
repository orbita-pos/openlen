// WHAT VISITORS ASKED FOR, in the page's language (spec local 2026-11-06-asistente-propio, §4.3.3): the email of a card
// and the chat row of «Que Len lo haga», written when they are made — the channels only carry them. Like the event
// tasks' (lib/event-tasks/texts.ts). The texts live in `messages/<locale>/panelsChat.json` (`ownAssistant.requests`).
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

type Translate = (key: string, values?: Record<string, string | number>) => string;

const translator = (locale: string): Translate => {
  const l = idiomaDelCorreo(locale);
  return createTranslator({ locale: l, messages: MESSAGES[l], namespace: "ownAssistant.requests" }) as unknown as Translate;
};

export function requestEmail(locale: string, o: { readonly name: string; readonly title: string; readonly visitors: number; readonly url: string }): { subject: string; text: string } {
  const t = translator(locale);
  return {
    subject: t("emailSubject", { name: o.name, title: o.title }),
    text: t("emailText", { name: o.name, title: o.title, visitors: t("visitors", { count: o.visitors }), url: o.url }),
  };
}

/** What the chat row of an accepted card's turn shows as its message (the model reads the framing instead). Only her
 *  name, which her owner chose: the agent route reads this text as the owner's own words — a "/name" in it invokes a
 *  skill, an "@name" notifies a member, a subdomain in it lets publish claim it — so nothing visitors wrote goes here
 *  (final review I4). The card's title rides in the framing, as data. */
export function requestTurnPrompt(locale: string, name: string): string {
  return translator(locale)("turnPrompt", { name });
}
