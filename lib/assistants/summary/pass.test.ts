// THE MORNING SUMMARY'S PASS (spec local 2026-11-06-asistente-propio, §6.9, phase 4D): at 8 in the owner's zone, once a
// day, only when something happened; a day is claimed before it is counted, so two passes never send two.
import { describe, expect, it, vi } from "vitest";

import { SUMMARY_HOUR, summaryPass, type SummaryDeps } from "./pass";

const LUCIA = { id: "a1", personId: "u1", name: "Lucía", slug: "lucia", homeProjectId: "p1", summaryLocale: "es", lastSummaryOn: null as string | null };

function deps(o: Partial<SummaryDeps> & { counts?: { talkedWith: number; contacts: number; requests: number } } = {}) {
  const claimed = new Set<string>();
  const d: SummaryDeps = {
    candidates: async () => [LUCIA],
    timeZoneOf: async () => "America/Lima",
    claim: vi.fn(async (id: string, day: string) => {
      const k = `${id}:${day}`;
      if (claimed.has(k)) return false;
      claimed.add(k);
      return true;
    }),
    projectIdsOf: async () => ["p1", "p2"],
    count: vi.fn(async () => o.counts ?? { talkedWith: 3, contacts: 1, requests: 0 }),
    notify: vi.fn(async () => {}),
    siteUrl: "https://openlen.com",
    ...o,
  };
  return d;
}

// 2026-11-09 08:05 in Lima (UTC−5).
const AT_8 = new Date("2026-11-09T13:05:00Z");

describe("summaryPass", () => {
  it("is at 8 in the morning", () => expect(SUMMARY_HOUR).toBe(8));

  it("🔴 at 8 in the owner's zone, one summary; a second pass the same day sends nothing", async () => {
    const d = deps();
    expect(await summaryPass(d, AT_8)).toBe(1);
    expect(d.count).toHaveBeenCalledWith("a1", ["p1", "p2"], new Date("2026-11-08T05:00:00Z"), new Date("2026-11-09T05:00:00Z"));
    const [event, key] = (d.notify as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(key).toBe("assistant_summary:a1:2026-11-09");
    expect(event).toMatchObject({ type: "assistant_summary", projectId: "p1", recipientUserId: "u1", assistantId: "a1", assistantName: "Lucía", assistantSlug: "lucia", locale: "es", title: "Lucía" });
    expect(event.emailText).toContain("https://openlen.com/es/assistant/lucia");
    expect(await summaryPass(d, new Date(AT_8.getTime() + 5 * 60_000))).toBe(0);
    expect(d.notify).toHaveBeenCalledTimes(1);
  });

  it("🔴 a day with nothing sends nothing, and isn't retried that day", async () => {
    const d = deps({ counts: { talkedWith: 0, contacts: 0, requests: 0 } });
    expect(await summaryPass(d, AT_8)).toBe(0);
    expect(d.notify).not.toHaveBeenCalled();
    await summaryPass(d, new Date(AT_8.getTime() + 5 * 60_000));
    expect(d.count).toHaveBeenCalledTimes(1);
  });

  it("before 8 it waits", async () => {
    const d = deps();
    expect(await summaryPass(d, new Date("2026-11-09T12:55:00Z"))).toBe(0);
    expect(d.claim).not.toHaveBeenCalled();
  });

  it("one already sent today (after a restart) is not sent again", async () => {
    const d = deps({ candidates: async () => [{ ...LUCIA, lastSummaryOn: "2026-11-09" }] });
    expect(await summaryPass(d, AT_8)).toBe(0);
    expect(d.claim).not.toHaveBeenCalled();
  });

  it("one failing never stops the others", async () => {
    const ana = { ...LUCIA, id: "a2", name: "Ana", slug: "ana" };
    const d = deps({ candidates: async () => [LUCIA, ana], projectIdsOf: vi.fn(async (id: string) => (id === "a1" ? Promise.reject(new Error("db")) : ["p3"])) });
    expect(await summaryPass(d, AT_8)).toBe(1);
  });
});
