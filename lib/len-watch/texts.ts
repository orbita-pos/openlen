// LEN WATCH'S NOTICES in the owner's language (spec local 2026-10-30-len-watch, §5.3): the push title
// and body and the email's subject and text, written when the notice is created — the channels only
// carry them. The texts live in `messages/<locale>/topbar.json` (`lenWatch.notice`).
import { createTranslator } from "next-intl";

import de from "@/messages/de/topbar.json";
import en from "@/messages/en/topbar.json";
import es from "@/messages/es/topbar.json";
import fr from "@/messages/fr/topbar.json";
import it from "@/messages/it/topbar.json";
import ja from "@/messages/ja/topbar.json";
import ko from "@/messages/ko/topbar.json";
import nl from "@/messages/nl/topbar.json";
import pt from "@/messages/pt/topbar.json";
import zh from "@/messages/zh/topbar.json";
import type { LenWatchPhase } from "@/lib/notifications/types";
import { idiomaDelCorreo } from "@/lib/projects/correos-del-proyecto";

const MESSAGES = { de, en, es, fr, it, ja, ko, nl, pt, zh } as const;

type Translate = (key: string, values?: Record<string, string>) => string;

export interface LenWatchTexts {
  title: string;
  body: string;
  emailSubject: string;
  emailText: string;
}

/** What the chat row of a Len Watch turn shows as its message (the model reads the framing instead). */
export function lenWatchTurnPrompt(locale: string): string {
  const l = idiomaDelCorreo(locale);
  return (createTranslator({ locale: l, messages: MESSAGES[l] }) as unknown as Translate)("lenWatch.turnPrompt");
}

export function lenWatchTexts(
  phase: LenWatchPhase,
  locale: string,
  v: { projectTitle: string; url: string; chatUrl: string; detail: string | null; shipsUnpublished: boolean },
): LenWatchTexts {
  const l = idiomaDelCorreo(locale);
  // The key is built from the phase, which next-intl's typed keys can't follow.
  const t = createTranslator({ locale: l, messages: MESSAGES[l] }) as unknown as Translate;
  const vars = { project: v.projectTitle, url: v.url, chatUrl: v.chatUrl, detail: v.detail?.trim() ?? "" };
  const k = `lenWatch.notice.${phase}`;
  const paragraphs = t(`${k}.text`, vars).split("\n\n");
  // The warning goes right after the first paragraph, where the text says the fix isn't published.
  if (v.shipsUnpublished) paragraphs.splice(1, 0, t("lenWatch.notice.shipsUnpublished"));
  return {
    title: t(`${k}.title`, vars),
    body: t(`${k}.body`, vars),
    emailSubject: t(`${k}.subject`, vars),
    emailText: paragraphs
      .map((p) => p.trim())
      .filter(Boolean)
      .join("\n\n"),
  };
}
