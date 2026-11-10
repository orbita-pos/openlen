// HER MORNING SUMMARY'S WORDS (spec local 2026-11-06-asistente-propio, §6.9, phase 4D), in the language it was turned
// on in: only the counts that aren't 0, joined as each language joins a list (Intl.ListFormat), like «Ayer hablé con 14
// personas y 3 te dejaron su contacto». Written when the summary is made — the channels only carry them, like the
// requests' (../requests/texts.ts). The texts live in `messages/<locale>/panelsChat.json` (`ownAssistant.summary`).
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

import type { SummaryCounts } from "./count";

const MESSAGES = { de, en, es, fr, it, ja, ko, nl, pt, zh } as const;

type Translate = (key: string, values?: Record<string, string | number>) => string;

/** A push's line stays under this, as Claude Code's PushNotification asks. */
const PUSH_MAX = 199;

export function summaryTexts(locale: string, name: string, c: SummaryCounts, url: string): { title: string; push: string; emailSubject: string; emailText: string } {
  const l = idiomaDelCorreo(locale);
  const t = createTranslator({ locale: l, messages: MESSAGES[l], namespace: "ownAssistant.summary" }) as unknown as Translate;
  const parts = [
    ...(c.talkedWith > 0 ? [t("talkedWith", { count: c.talkedWith })] : []),
    ...(c.contacts > 0 ? [t("contacts", { count: c.contacts })] : []),
    ...(c.requests > 0 ? [t("requests", { count: c.requests })] : []),
  ];
  const line = t("push", { list: new Intl.ListFormat(l, { type: "conjunction" }).format(parts) });
  const push = line.length > PUSH_MAX ? `${line.slice(0, PUSH_MAX - 1)}…` : line;
  return { title: name, push, emailSubject: t("emailSubject", { name }), emailText: t("emailText", { push, name, url }) };
}
