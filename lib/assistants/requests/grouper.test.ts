// THE TURN THAT JOINS (spec local 2026-11-06-asistente-propio, §4.3.2, §4.3.3, §4.7): a short turn on Len's loop with
// one tool, paid by the owner inside the visitors' cap, that tells the owner once — a new card, or a waiting one that
// reaches five people; a card set aside grows in silence. The model is scripted; the loop is the real one, wrapped in
// the replay invariant.
import { describe, expect, it } from "vitest";

import type { Message, StreamEvent } from "@/lib/ai-gateway";
import { runAgentLoop } from "@/lib/agent/loop";
import { withReplayInvariant } from "@/lib/agent/testing/replay-invariant";
import type { LenAvisoEvent } from "@/lib/notifications/types";

import { groupOne, type GrouperDeps } from "./grouper";
import { NOTIFY_AGAIN_AT } from "./limits";
import type { RequestCardRow, RequestRow } from "./store";
import { requestEmail, requestTurnPrompt } from "./texts";

const NOW = new Date("2026-11-09T12:00:00Z");
const PAIR = { assistantId: "a1", projectId: "p1" };
const done: StreamEvent = { type: "done", stopReason: { kind: "end_turn" } };
const usage: StreamEvent = { type: "usage", inputTokens: 900, outputTokens: 40, cachedTokens: 0, thinkingTokens: 0 };
const call = (name: string, args: Record<string, unknown>): StreamEvent[] => [{ type: "function_call", name, args }, usage, done];

const req = (id: string, text: string, locale = "es"): RequestRow => ({ id, assistantId: "a1", projectId: "p1", visitorId: `vid-${id}`, text, locale, at: NOW, cardId: null, attempts: 0, groupAfter: null, discardedAt: null });
const card = (id: string, o: Partial<RequestCardRow> = {}): RequestCardRow => ({
  id,
  assistantId: "a1",
  projectId: "p1",
  title: "Envíos a domicilio",
  locale: "es",
  status: "pending",
  visitors: 1,
  createdAt: NOW,
  lastAt: NOW,
  decidedAt: null,
  decidedBy: null,
  acceptedRowId: null,
  failure: null,
  ...o,
});

type Saved = Awaited<ReturnType<GrouperDeps["store"]["saveGrouping"]>>;

function setup(o: { requests?: RequestRow[]; cards?: RequestCardRow[]; script?: StreamEvent[][]; saved?: Saved; balance?: number; spent?: number; brainThrows?: boolean } = {}) {
  const requests = o.requests ?? [req("r1", "¿hacen envíos?"), req("r2", "do you deliver?")];
  const sent: Message[][] = [];
  const offered: string[][] = [];
  const saves: Parameters<GrouperDeps["store"]["saveGrouping"]>[0][] = [];
  const notices: { event: LenAvisoEvent; key: string }[] = [];
  const charges: Parameters<GrouperDeps["charge"]>[0][] = [];
  const spends: [string, string, number, number | undefined][] = [];
  let step = 0;
  const deps: GrouperDeps = {
    now: () => NOW,
    assistantOf: async (id) => (id === "a1" ? { id: "a1", name: "Lucía", personId: "owner" } : null),
    creditState: async () => ({ balance: o.balance ?? 10_000, allotment: 50_000 }),
    monthSpent: async () => o.spent ?? 0,
    addMonthSpend: async (u, m, c, messages) => void spends.push([u, m, c, messages]),
    explicitVisitorCap: async () => null,
    brain: (tools) => {
      offered.push(tools.map((t) => String(t.name)));
      return {
        providersUsed: () => [{ provider: "fireworks", model: "the-model", inputTokens: 900, cachedTokens: 0, outputTokens: 40, thinkingTokens: 0 }],
        openStream: (messages) => {
          sent.push(messages);
          if (o.brainThrows) throw new Error("the provider went away");
          const events = (o.script ?? [call("group_requests", { groups: [{ title: "Envíos a domicilio", requests: [1, 2] }] })])[step++] ?? [usage, done];
          return (async function* () {
            yield* events;
          })();
        },
        closeOut: () =>
          (async function* () {
            yield* [usage, done];
          })(),
      };
    },
    charge: async (c) => (charges.push(c), 3),
    notify: async (event, key) => void notices.push({ event, key }),
    store: {
      pendingRequests: async () => requests,
      joinableCards: async () => o.cards ?? [],
      saveGrouping: async (g) => (saves.push(g), o.saved ?? [{ card: card("c-new", { visitors: 2 }), isNew: true, before: 0 }]),
    },
    siteUrl: "https://openlen.com",
    runLoop: withReplayInvariant(runAgentLoop),
  };
  return { deps, sent, offered, saves, notices, charges, spends };
}

describe("groupOne", () => {
  it("offers the model one tool, and saves what it answered", async () => {
    const s = setup();
    expect(await groupOne(PAIR, s.deps)).toBe("grouped");
    expect(s.offered).toEqual([["group_requests"]]);
    expect(s.saves).toEqual([{ assistantId: "a1", projectId: "p1", locale: "es", at: NOW, newCards: [{ title: "Envíos a domicilio", requestIds: ["r1", "r2"] }], joins: [], discard: [], retry: [] }]);
    // One call: group_requests ends the turn.
    expect(s.sent).toHaveLength(1);
  });

  it("nothing waiting: no model call", async () => {
    const s = setup({ requests: [] });
    expect(await groupOne(PAIR, s.deps)).toBe("nothing");
    expect(s.sent).toHaveLength(0);
  });

  it("🔴 asleep: no model call and the requests wait", async () => {
    for (const o of [{ balance: 0 }, { spent: 12_500 }]) {
      const s = setup(o);
      expect(await groupOne(PAIR, s.deps)).toBe("asleep");
      expect(s.sent).toHaveLength(0);
      expect(s.saves).toHaveLength(0);
      expect(s.charges).toHaveLength(0);
    }
  });

  it("🔴 a provider error costs nothing and adds no attempt", async () => {
    const s = setup({ brainThrows: true });
    await expect(groupOne(PAIR, s.deps)).rejects.toThrow();
    expect(s.saves).toHaveLength(0);
    expect(s.charges).toHaveLength(0);
    expect(s.spends).toHaveLength(0);
  });

  // Final review C1: the real brain never throws on a provider failure — it ends the stream with an error stop reason
  // and the loop returns errorCode. Three such passes discarded every waiting request, and each was charged.
  it("🔴 a provider that fails the way providers fail costs nothing, adds no attempt and says it failed", async () => {
    const failing: StreamEvent[] = [usage, { type: "done", stopReason: { kind: "error", error: "upstream unavailable" } }];
    const s = setup({ script: [failing, failing, failing] });
    const finished: string[] = [];
    expect(await groupOne(PAIR, { ...s.deps, recorder: () => ({ onCall: () => {}, onStepTools: () => {}, finish: (e) => void finished.push(e.endReason) }) })).toBe("failed");
    expect(s.saves).toHaveLength(0);
    expect(s.charges).toHaveLength(0);
    expect(s.spends).toHaveLength(0);
    expect(s.notices).toHaveLength(0);
    expect(finished).toEqual(["error"]);
  });

  it("🔴 any other tool is refused: nothing runs but group_requests", async () => {
    const s = setup({ script: [call("Write", { file_path: "/index.html", content: "x" }), call("group_requests", { groups: [], discard: [1, 2] })] });
    await groupOne(PAIR, s.deps);
    // The loop keeps one conversation: the last one sent holds every answer.
    const refusal = s.sent.at(-1)!.flatMap((m) => m.functionResponses ?? []).find((f) => f.name === "Write")!.response as { ok?: boolean };
    expect(refusal.ok).toBe(false);
    expect(s.saves[0]!.discard).toEqual(["r1", "r2"]);
  });

  it("a new card notifies once with its title and count", async () => {
    const s = setup();
    await groupOne(PAIR, s.deps);
    expect(s.notices).toHaveLength(1);
    const { event, key } = s.notices[0]!;
    expect(key).toBe("assistant_requests:a1:p1");
    expect(event).toMatchObject({ type: "len_aviso", projectId: "p1", recipientUserId: "owner", cardId: "c-new", title: "Lucía", push: "Envíos a domicilio (2)" });
    expect(event.emailSubject).toContain("Envíos a domicilio");
    expect(event.emailText).toContain("https://openlen.com/new?project=p1&chat=1&card=c-new");
    // One visitor: no count.
    const one = setup({ saved: [{ card: card("c1", { visitors: 1 }), isNew: true, before: 0 }] });
    await groupOne(PAIR, one.deps);
    expect(one.notices[0]!.event.push).toBe("Envíos a domicilio");
  });

  it(`joining a waiting card notifies only when it crosses ${NOTIFY_AGAIN_AT}`, async () => {
    const below = setup({ saved: [{ card: card("c1", { visitors: NOTIFY_AGAIN_AT - 1 }), isNew: false, before: 2 }] });
    await groupOne(PAIR, below.deps);
    expect(below.notices).toHaveLength(0);
    const crossing = setup({ saved: [{ card: card("c1", { visitors: NOTIFY_AGAIN_AT + 1 }), isNew: false, before: NOTIFY_AGAIN_AT - 1 }] });
    await groupOne(PAIR, crossing.deps);
    expect(crossing.notices).toHaveLength(1);
    expect(crossing.notices[0]!.event.push).toBe(`Envíos a domicilio (${NOTIFY_AGAIN_AT + 1})`);
    const past = setup({ saved: [{ card: card("c1", { visitors: NOTIFY_AGAIN_AT + 3 }), isNew: false, before: NOTIFY_AGAIN_AT }] });
    await groupOne(PAIR, past.deps);
    expect(past.notices).toHaveLength(0);
  });

  it("🔴 a dismissed card grows in silence", async () => {
    const s = setup({ saved: [{ card: card("c1", { status: "dismissed", visitors: 9 }), isNew: false, before: 1 }] });
    await groupOne(PAIR, s.deps);
    expect(s.notices).toHaveLength(0);
  });

  it("a flood in one pass is one notice per pair", async () => {
    const saved: Saved = [
      { card: card("c1", { title: "Reservas", visitors: 2 }), isNew: true, before: 0 },
      { card: card("c2", { title: "Envíos", visitors: 7 }), isNew: true, before: 0 },
      { card: card("c3", { title: "Regalos", visitors: 6 }), isNew: false, before: 4 },
    ];
    const s = setup({ saved });
    await groupOne(PAIR, s.deps);
    expect(s.notices).toHaveLength(1);
    expect(s.notices[0]!.event.cardId).toBe("c2");
  });

  it("what it spent is charged and added to the month's spend", async () => {
    const s = setup();
    await groupOne(PAIR, s.deps);
    expect(s.charges).toHaveLength(1);
    expect(s.charges[0]).toMatchObject({ ownerId: "owner", projectId: "p1", refId: `requests:a1:p1:${NOW.toISOString()}` });
    expect(s.charges[0]!.uses[0]).toMatchObject({ provider: "fireworks", model: "the-model", inputTokens: 900 });
    // Within the visitors' cap, but it is no visitor's message.
    expect(s.spends).toEqual([["owner", "2026-11", 3, 0]]);
  });

  it("its telemetry is tagged assistant-requests:<id>", async () => {
    const s = setup();
    const opened: unknown[] = [];
    const finished: string[] = [];
    await groupOne(PAIR, { ...s.deps, recorder: (o) => (opened.push(o), { onCall: () => {}, onStepTools: () => {}, finish: (e) => void finished.push(e.endReason) }) });
    expect(opened[0]).toMatchObject({ projectId: "p1", tag: "assistant-requests:a1" });
    expect(finished).toEqual(["done"]);
  });

  it("writes in the page's language: the newest request's", async () => {
    const s = setup({ requests: [req("r1", "¿envíos?", "es"), req("r2", "livraison ?", "fr")], saved: [{ card: card("c1", { locale: "fr", visitors: 2 }), isNew: true, before: 0 }] });
    await groupOne(PAIR, s.deps);
    expect(s.saves[0]!.locale).toBe("fr");
    expect(s.notices[0]!.event.emailText).toBe(requestEmail("fr", { name: "Lucía", title: "Envíos a domicilio", visitors: 2, url: "https://openlen.com/new?project=p1&chat=1&card=c1" }).text);
  });
});

describe("the texts", () => {
  it("the email names her, the wish, how many and where to open it, in the page's language", () => {
    const es = requestEmail("es", { name: "Lucía", title: "Envíos a domicilio", visitors: 5, url: "https://x/y" });
    expect(es.subject).toContain("Lucía");
    expect(es.subject).toContain("Envíos a domicilio");
    expect(es.text).toContain("5");
    expect(es.text).toContain("https://x/y");
    expect(requestEmail("en", { name: "Lucía", title: "Delivery", visitors: 1, url: "u" }).text).not.toBe(requestEmail("es", { name: "Lucía", title: "Delivery", visitors: 1, url: "u" }).text);
    // An unknown language falls back to one we write.
    expect(requestEmail("xx", { name: "Lucía", title: "t", visitors: 1, url: "u" }).text).toBeTruthy();
  });

  it("the chat row of the turn says who it's from and what", () => {
    expect(requestTurnPrompt("es", "Lucía", "Envíos a domicilio")).toContain("Lucía");
    expect(requestTurnPrompt("es", "Lucía", "Envíos a domicilio")).toContain("Envíos a domicilio");
  });
});
