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
import type { AbInconclusiveReason, AbReadySummary } from "./types";

const MESSAGES = { de, en, es, fr, it, ja, ko, nl, pt, zh } as const;

type Translate = (key: string, values?: Record<string, string | number>) => string;

const PUSH_MAX = 199;

/** `name` cut to at most `max` characters (code points, with an ellipsis); whole if it already fits. */
export function cutName(name: string, max: number): string {
  const chars = Array.from(name);
  return chars.length <= max ? name : `${chars.slice(0, Math.max(1, max - 1)).join("")}…`;
}

/** The name to put in a push so that `build(name)` fits: a push that is too long loses letters of the NAME, never the end of
 *  the sentence — the end is the question the owner has to answer (review item 29). If even a one-letter name doesn't fit
 *  (the template alone is long), the name is as short as it gets and the sentence stays whole. */
export function nameThatFits(name: string, build: (name: string) => string, max: number = PUSH_MAX): string {
  if (build(name).length <= max) return name;
  const over = build(name).length - max;
  // One pass computes the cut; the loop below only corrects for ellipsis and multi-unit characters.
  let keep = Math.max(1, Array.from(name).length - over);
  for (; keep > 1; keep--) {
    const candidate = cutName(name, keep);
    if (build(candidate).length <= max) return candidate;
  }
  return cutName(name, 1);
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
export function abSummaryLine(locale: string, items: readonly AbReadySummary[], nameMax: number = Infinity): string {
  if (items.length === 0) return "";
  const { t } = translatorFor(locale);
  const primary =
    items.find((x) => x.status === "winner_ready" && x.winnerVariant === "b") ??
    items.find((x) => x.status === "winner_ready") ??
    items[0]!;
  const prob = Math.round(primary.probability * 100);
  const lift = Math.max(0, Math.round(Math.abs(primary.liftPct)));
  const name = cutName(primary.name, nameMax);
  const first =
    primary.status === "winner_ready" && primary.winnerVariant === "b"
      ? t("summaryWinnerB", { name, lift, prob })
      : primary.status === "winner_ready" && primary.winnerVariant === "a"
        ? t("summaryWinnerA", { name, prob })
        : t(primary.reason === "uneven_traffic" ? "summaryUnevenTraffic" : "summaryInconclusive", { name });
  if (items.length === 1) return first;
  return t("summaryMore", { first, count: items.length - 1 });
}

export interface AbNotificationInput {
  readonly name: string;
  readonly assistantName?: string | null;
  readonly verdict: "winner_b" | "winner_a" | "inconclusive" | "harm_stop" | "closed_by_system" | "promoted_by_system";
  readonly liftPct: number;
  readonly probabilityPct: number;
  readonly url: string;
  /** Harm stop only: false = there was no published site to put the original back on (the text must not say it was). */
  readonly restored?: boolean;
  /** An inconclusive one with a known cause: it says so instead of «no clear winner». */
  readonly reason?: AbInconclusiveReason;
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
  const pushFor = (name: string): string =>
    input.verdict === "winner_b"
      ? t("pushWinnerB", { name, lift, prob })
      : input.verdict === "winner_a"
        ? t("pushWinnerA", { name, prob })
        : input.verdict === "harm_stop"
          ? t(input.restored === false ? "pushHarmStopNotRestored" : "pushHarmStop", { name })
          : input.verdict === "closed_by_system"
            ? t("pushClosedBySystem", { name })
            : input.verdict === "promoted_by_system"
              ? t("pushPromotedBySystem", { name })
              : t(input.reason === "uneven_traffic" ? "pushUnevenTraffic" : "pushInconclusive", { name });
  // The email has room for the whole name; the push (under 200 characters) loses letters of the name, never its question.
  const rawPush = pushFor(input.name);
  const push = pushFor(nameThatFits(input.name, pushFor));
  const title = input.assistantName?.trim() || t("badge");
  return {
    locale: l,
    title,
    push,
    emailSubject: t("emailSubject", { name: input.name }),
    // A harm stop, and what the system closed or recorded on its own, are already settled: the email shows what happened, it
    // doesn't ask for a decision.
    emailText: t(
      input.verdict === "harm_stop" || input.verdict === "closed_by_system" || input.verdict === "promoted_by_system" ? "emailTextInfo" : "emailText",
      { push: rawPush, url: input.url },
    ),
  };
}
