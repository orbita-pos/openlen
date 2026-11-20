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

describe("the A/B decisions the summary says are said once (item 29)", () => {
  const ready = (id: string) => ({ experimentId: id, projectId: "p1", projectTitle: "Tienda", name: "Hero", status: "winner_ready" as const, winnerVariant: "b" as const, rateA: 0.04, rateB: 0.053, liftPct: 31, totalViews: 900, probability: 0.97 });

  it("🔴 after the summary was queued it marks exactly the decisions it listed as told", async () => {
    const order: string[] = [];
    const markAbTold = vi.fn(async () => void order.push("marked"));
    const d = deps({
      count: vi.fn(async () => ({ talkedWith: 0, contacts: 0, requests: 0, abReady: [ready("ab_1"), ready("ab_2")] })),
      notify: vi.fn(async () => void order.push("notified")),
      markAbTold,
    });
    expect(await summaryPass(d, AT_8)).toBe(1);
    expect(markAbTold).toHaveBeenCalledWith(["ab_1", "ab_2"], AT_8);
    expect(order).toEqual(["notified", "marked"]);
  });

  it("🔴 a summary that never went out marks nothing: the decision is said the next morning", async () => {
    const markAbTold = vi.fn(async () => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const d = deps({
      count: vi.fn(async () => ({ talkedWith: 0, contacts: 0, requests: 0, abReady: [ready("ab_1")] })),
      notify: vi.fn(async () => Promise.reject(new Error("queue down"))),
      markAbTold,
    });
    expect(await summaryPass(d, AT_8)).toBe(0);
    warn.mockRestore();
    expect(markAbTold).not.toHaveBeenCalled();
  });

  it("a summary with no A/B decision marks none; a marking that fails doesn't undo a summary that was sent", async () => {
    const markAbTold = vi.fn(async () => Promise.reject(new Error("db")));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const plain = deps({ markAbTold });
    expect(await summaryPass(plain, AT_8)).toBe(1);
    expect(markAbTold).not.toHaveBeenCalled();
    const withAb = deps({ count: vi.fn(async () => ({ talkedWith: 1, contacts: 0, requests: 0, abReady: [ready("ab_1")] })), markAbTold });
    expect(await summaryPass(withAb, AT_8)).toBe(1);
    warn.mockRestore();
  });
});

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

  it("sends the morning summary when only a ready A/B verdict is waiting", async () => {
    const d = deps({
      count: vi.fn(async () => ({
        talkedWith: 0,
        contacts: 0,
        requests: 0,
        abReady: [
          {
            experimentId: "ab_1",
            projectId: "p1",
            projectTitle: "Tienda",
            name: "Hero CTA",
            status: "winner_ready" as const,
            winnerVariant: "b" as const,
            rateA: 0.04,
            rateB: 0.053,
            liftPct: 31,
            totalViews: 900,
            probability: 0.97,
          },
        ],
      })),
    });
    expect(await summaryPass(d, AT_8)).toBe(1);
    const [event] = (d.notify as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(event.push).toContain("31%");
    expect(event.push).not.toContain("Ayer .");
  });
});
