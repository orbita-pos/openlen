// Localized notification and morning-summary copy for OpenLen Edge A/B Testing (Plan 3).
// Reads `ownAssistant.ab` from `messages/<locale>/panelsChat.json`, mirroring `lib/assistants/summary/texts.ts`.
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
import type { AbReadySummary } from "./types";

const MESSAGES = { de, en, es, fr, it, ja, ko, nl, pt, zh } as const;

type Translate = (key: string, values?: Record<string, string | number>) => string;

const PUSH_MAX = 199;

function clampPush(text: string): string {
  return text.length > PUSH_MAX ? `${text.slice(0, PUSH_MAX - 1)}…` : text;
}

function translatorFor(locale: string): { locale: string; t: Translate } {
  const l = idiomaDelCorreo(locale);
  const t = createTranslator({
    locale: l,
    messages: MESSAGES[l],
    namespace: "ownAssistant.ab",
  }) as unknown as Translate;
  return { locale: l, t };
}

/** Concise one-line A/B decision prompt appended to Tu Asistente's 8 a.m. morning summary. */
export function abSummaryLine(locale: string, items: readonly AbReadySummary[]): string {
  if (items.length === 0) return "";
  const { t } = translatorFor(locale);
  const primary =
    items.find((x) => x.status === "winner_ready" && x.winnerVariant === "b") ??
    items.find((x) => x.status === "winner_ready") ??
    items[0]!;
  const prob = Math.round(primary.probability * 100);
  const lift = Math.max(0, Math.round(Math.abs(primary.liftPct)));
  const first =
    primary.status === "winner_ready" && primary.winnerVariant === "b"
      ? t("summaryWinnerB", { name: primary.name, lift, prob })
      : primary.status === "winner_ready" && primary.winnerVariant === "a"
        ? t("summaryWinnerA", { name: primary.name, prob })
        : t("summaryInconclusive", { name: primary.name });
  if (items.length === 1) return first;
  return t("summaryMore", { first, count: items.length - 1 });
}

export interface AbNotificationInput {
  readonly name: string;
  readonly assistantName?: string | null;
  readonly verdict: "winner_b" | "winner_a" | "inconclusive" | "harm_stop";
  readonly liftPct: number;
  readonly probabilityPct: number;
  readonly url: string;
  /** Harm stop only: false = there was no published site to put the original back on (the text must not say it was). */
  readonly restored?: boolean;
}

/** Standalone push + email copy used when harm_stop triggers or when the project has no morning summary. */
export function abNotificationTexts(
  locale: string,
  input: AbNotificationInput,
): {
  readonly locale: string;
  readonly title: string;
  readonly push: string;
  readonly emailSubject: string;
  readonly emailText: string;
} {
  const { locale: l, t } = translatorFor(locale);
  const lift = Math.max(0, Math.round(Math.abs(input.liftPct)));
  const prob = Math.max(0, Math.min(100, Math.round(input.probabilityPct)));
  const rawPush =
    input.verdict === "winner_b"
      ? t("pushWinnerB", { name: input.name, lift, prob })
      : input.verdict === "winner_a"
        ? t("pushWinnerA", { name: input.name, prob })
        : input.verdict === "harm_stop"
          ? t(input.restored === false ? "pushHarmStopNotRestored" : "pushHarmStop", { name: input.name })
          : t("pushInconclusive", { name: input.name });
  const push = clampPush(rawPush);
  const title = input.assistantName?.trim() || t("badge");
  return {
    locale: l,
    title,
    push,
    emailSubject: t("emailSubject", { name: input.name }),
    // A harm stop is already decided: its email shows what happened, it doesn't ask for a decision.
    emailText: t(input.verdict === "harm_stop" ? "emailTextInfo" : "emailText", { push: rawPush, url: input.url }),
  };
}
