// HER MORNING SUMMARY'S PASS (spec local 2026-11-06-asistente-propio, §6.9, phase 4D): every five minutes, inside the
// Next process like the requests' grouper (../requests/pass.ts), each assistant whose summary is on and whose owner's
// clock reached 8 today gets it once: the day is CLAIMED first (compare-and-swap on `lastSummaryOn`), then yesterday is
// counted (no model), and only when something happened the owner is told (`assistant_summary`, push and, if no push
// went, email). Claimed first: at most one a day even with two passes or a restart; a failure after the claim loses that
// day's summary rather than sending two. One failing never stops the others. OPENLEN_ASSISTANT=0 starts none.
import type { AssistantSummaryEvent } from "@/lib/notifications/types";

import { assistantsEnabled } from "../enabled";
import type { SummaryCounts } from "./count";
import { dayBounds } from "./day";
import { summaryTexts } from "./texts";

/** At 8 in the morning, in the owner's zone. */
export const SUMMARY_HOUR = 8;
export const SUMMARY_PASS_MS = 5 * 60_000;

export interface SummaryCandidate {
  readonly id: string;
  readonly personId: string;
  readonly name: string;
  readonly slug: string;
  readonly homeProjectId: string;
  readonly summaryLocale: string | null;
  readonly lastSummaryOn: string | null;
}

export interface SummaryDeps {
  /** The assistants whose morning summary is on. */
  candidates(): Promise<readonly SummaryCandidate[]>;
  /** The owner's zone, from their notification preferences. */
  timeZoneOf(personId: string): Promise<string>;
  /** Takes the day for her; `false` when another pass already did. */
  claim(assistantId: string, day: string): Promise<boolean>;
  projectIdsOf(assistantId: string): Promise<readonly string[]>;
  count(assistantId: string, projectIds: readonly string[], start: Date, end: Date): Promise<SummaryCounts>;
  notify(event: AssistantSummaryEvent, dedupeKey: string): Promise<void>;
  readonly siteUrl: string;
}

/** How many summaries it sent. */
export async function summaryPass(d: SummaryDeps, now: Date): Promise<number> {
  let sent = 0;
  for (const a of await d.candidates()) {
    try {
      const day = dayBounds(now, await d.timeZoneOf(a.personId));
      if (day.hour < SUMMARY_HOUR || a.lastSummaryOn === day.today) continue;
      if (!(await d.claim(a.id, day.today))) continue;
      const c = await d.count(a.id, await d.projectIdsOf(a.id), day.yesterdayStart, day.yesterdayEnd);
      // «She only talks to you when there is something» (§4.6).
      if (c.talkedWith === 0 && c.contacts === 0 && c.requests === 0) continue;
      const locale = a.summaryLocale ?? "en";
      const texts = summaryTexts(locale, a.name, c, `${d.siteUrl}/${locale}/assistant/${encodeURIComponent(a.slug)}`);
      await d.notify(
        { type: "assistant_summary", projectId: a.homeProjectId, recipientUserId: a.personId, assistantId: a.id, assistantName: a.name, assistantSlug: a.slug, locale, ...texts },
        `assistant_summary:${a.id}:${day.today}`,
      );
      sent++;
    } catch (err) {
      console.warn(`[assistant-summary] ${a.id}'s summary failed`, err);
    }
  }
  return sent;
}

async function defaultDeps(): Promise<SummaryDeps> {
  const [{ db, schema }, { and, eq, or, isNull, ne }, { countYesterday }, { projectIdsOf }, { loadPrefs, scheduleNotification }] = await Promise.all([
    import("@/lib/db"),
    import("drizzle-orm"),
    import("./count"),
    import("../projects"),
    import("@/lib/notifications/dispatch"),
  ]);
  const a = schema.assistants;
  return {
    candidates: () =>
      db
        .select({ id: a.id, personId: a.personId, name: a.name, slug: a.slug, homeProjectId: a.homeProjectId, summaryLocale: a.summaryLocale, lastSummaryOn: a.lastSummaryOn })
        .from(a)
        .where(eq(a.morningSummary, true)),
    timeZoneOf: async (personId) => (await loadPrefs(personId)).timezone,
    claim: async (id, day) =>
      (
        await db
          .update(a)
          .set({ lastSummaryOn: day })
          .where(and(eq(a.id, id), eq(a.morningSummary, true), or(isNull(a.lastSummaryOn), ne(a.lastSummaryOn, day))))
          .returning({ id: a.id })
      ).length > 0,
    projectIdsOf: async (id) => (await projectIdsOf([id])).get(id) ?? [],
    count: countYesterday,
    notify: (event, key) => scheduleNotification(event, key),
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "https://openlen.com",
  };
}

let started: { stop(): void } | null = null;

/** Once per process, from instrumentation.ts: a first pass now, then one every five minutes, never overlapping. */
export function startMorningSummaries(o: { env?: Readonly<Record<string, string | undefined>>; deps?: SummaryDeps } = {}): { stop(): void } {
  if (!assistantsEnabled(o.env)) return { stop() {} };
  if (started) return started;
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;
  let running = false;
  void (o.deps ? Promise.resolve(o.deps) : defaultDeps())
    .then(async (deps) => {
      if (stopped) return;
      const pass = async () => {
        if (running) return;
        running = true;
        try {
          const n = await summaryPass(deps, new Date());
          if (n > 0) console.log(`[assistant-summary] told ${n} owner(s) what happened yesterday`);
        } catch (err) {
          console.error("[assistant-summary] pass failed", err);
        } finally {
          running = false;
        }
      };
      await pass();
      if (stopped) return;
      timer = setInterval(() => void pass(), SUMMARY_PASS_MS);
      timer.unref?.();
    })
    .catch((err) => console.error("[assistant-summary] the summaries could not start", err));
  return (started = {
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
    },
  });
}
