// @vitest-environment node
//
// WHAT VISITORS ASK FOR AND SHE CAN'T DO (spec local 2026-11-06-asistente-propio, §4.3, §6.5), against real Postgres
// (PGlite), with the tables exactly as `npm run assistants:migrate` creates them.
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/lib/db/schema";

const base = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", async () => {
  const s = await import("@/lib/db/schema");
  return {
    schema: s,
    get db() {
      return base.db;
    },
  };
});

const { CREATE_ASSISTANTS } = await import("@/scripts/assistants-migrate-sql");
const { createAssistant, deleteAssistant } = await import("../store");
const requests = await import("./store");
const { REQUESTS_PER_VISIT_DAY, REQUESTS_PER_ASSISTANT_DAY, GROUP_QUIET_MS, DISMISSED_JOIN_DAYS } = await import("./limits");

const LUCIA = { name: "Lucía", shape: "blob", color: "#F4A48B", tone: "friendly" } as const;
const DAY = 86_400_000;
const NOW = new Date("2026-11-09T12:00:00Z");
let pg: PGlite;
let lucia: string;

const note = (visitorId: string, text: string, at: Date = NOW, projectId = "p1") =>
  requests.noteRequest({ assistantId: lucia, projectId, visitorId, text, locale: "es", at });

const pendingIds = async () => (await requests.pendingRequests(lucia, "p1", 100)).map((r) => r.id);

beforeEach(async () => {
  pg = new PGlite();
  await pg.query(`create table "users" ("id" text primary key)`);
  await pg.query(`create table "projects" ("id" text primary key, "userId" text, "title" text, "data" jsonb, "updatedAt" timestamp)`);
  await pg.query(`create table "projectChatMessages" ("id" text primary key, "projectId" text not null references "projects"("id") on delete cascade, "conversation" text)`);
  await pg.query(`insert into "users" values ('u1'), ('u2')`);
  await pg.query(`insert into "projects" ("id", "userId", "title") values ('p1', 'u1', 'Pastelería'), ('p2', 'u1', 'Tienda')`);
  for (const statement of CREATE_ASSISTANTS) await pg.query(statement);
  base.db = drizzle(pg, { schema });
  const r = await createAssistant({ personId: "u1", projectId: "p1", input: LUCIA });
  if (!r.ok) throw new Error("setup");
  lucia = r.assistant.id;
});

describe("noting", () => {
  it("🔴 the same visitor asking five times counts once", async () => {
    // Three a day per visit: the same visitor asks over three days.
    for (let i = 0; i < 5; i++) expect(await note("vid-a", `¿hacen envíos? ${i}`, new Date(NOW.getTime() - (4 - i) * DAY))).toBe("noted");
    const ids = await pendingIds();
    expect(ids).toHaveLength(5);
    const [saved] = await requests.saveGrouping({ assistantId: lucia, projectId: "p1", locale: "es", at: NOW, newCards: [{ title: "Envíos a domicilio", requestIds: ids }], joins: [], discard: [], retry: [] });
    expect(saved!.isNew).toBe(true);
    expect(saved!.before).toBe(0);
    expect(saved!.card.visitors).toBe(1);
  });

  it("past 3 a day a visit notes nothing more", async () => {
    for (let i = 0; i < REQUESTS_PER_VISIT_DAY; i++) expect(await note("vid-a", `pedido ${i}`)).toBe("noted");
    expect(await note("vid-a", "otro más")).toBe("visit_limit");
    expect(await pendingIds()).toHaveLength(REQUESTS_PER_VISIT_DAY);
    // Another visitor still can, and the same one can again a day later.
    expect(await note("vid-b", "pedido")).toBe("noted");
    expect(await note("vid-a", "mañana", new Date(NOW.getTime() + DAY + 1000))).toBe("noted");
  });

  it("past 200 a day the assistant notes nothing more", async () => {
    const values = Array.from({ length: REQUESTS_PER_ASSISTANT_DAY }, (_, i) => `('r${i}', '${lucia}', 'p1', 'vid-${i}', 'pedido', 'es', '${new Date(NOW.getTime() - 1000).toISOString()}')`);
    await pg.query(`insert into "assistantRequests" ("id", "assistantId", "projectId", "visitorId", "text", "locale", "at") values ${values.join(", ")}`);
    expect(await note("vid-new", "uno más")).toBe("assistant_limit");
    // In another of her projects too: the limit is hers.
    expect(await note("vid-new", "uno más", NOW, "p2")).toBe("assistant_limit");
    expect(await note("vid-new", "mañana", new Date(NOW.getTime() + DAY))).toBe("noted");
  });
});

describe("grouping", () => {
  it("a pending group waits for the quiet window", async () => {
    await note("vid-a", "¿envíos?", new Date(NOW.getTime() - GROUP_QUIET_MS / 2));
    const quietBefore = new Date(NOW.getTime() - GROUP_QUIET_MS);
    expect(await requests.pendingGroups(quietBefore, 20)).toEqual([]);
    await note("vid-b", "¿reservas?", new Date(NOW.getTime() - GROUP_QUIET_MS - 1000));
    expect(await requests.pendingGroups(quietBefore, 20)).toEqual([{ assistantId: lucia, projectId: "p1" }]);
    // Once all are on a card or discarded, nothing waits.
    const ids = await pendingIds();
    await requests.saveGrouping({ assistantId: lucia, projectId: "p1", locale: "es", at: NOW, newCards: [], joins: [], discard: ids, retry: [] });
    expect(await requests.pendingGroups(quietBefore, 20)).toEqual([]);
  });

  it("a dismissed card can still be joined for 30 days, an accepted one can't", async () => {
    await note("vid-a", "¿envíos?");
    await note("vid-b", "¿reservas?");
    await note("vid-c", "¿regalos?");
    const [a, b, c] = await pendingIds();
    const saved = await requests.saveGrouping({
      assistantId: lucia,
      projectId: "p1",
      locale: "es",
      at: NOW,
      newCards: [
        { title: "Envíos", requestIds: [a!] },
        { title: "Reservas", requestIds: [b!] },
        { title: "Regalos", requestIds: [c!] },
      ],
      joins: [],
      discard: [],
      retry: [],
    });
    const [envios, reservas, regalos] = saved.map((s) => s.card);
    await pg.query(`update "assistantRequestCards" set "status" = 'dismissed', "decidedAt" = $1 where "id" = $2`, [NOW.toISOString(), envios!.id]);
    await pg.query(`update "assistantRequestCards" set "status" = 'accepted', "decidedAt" = $1 where "id" = $2`, [NOW.toISOString(), reservas!.id]);
    const titles = async (at: Date) => (await requests.joinableCards(lucia, "p1", at)).map((card) => card.title).sort();
    expect(await titles(new Date(NOW.getTime() + 1000))).toEqual(["Envíos", "Regalos"]);
    expect(await titles(new Date(NOW.getTime() + (DISMISSED_JOIN_DAYS + 1) * DAY))).toEqual(["Regalos"]);
    expect(regalos!.status).toBe("pending");
  });

  it("🔴 grouping twice attaches a request once", async () => {
    await note("vid-a", "¿envíos?");
    await note("vid-b", "¿envíos a Puebla?");
    const ids = await pendingIds();
    const grouping = { assistantId: lucia, projectId: "p1", locale: "es", at: NOW, newCards: [{ title: "Envíos", requestIds: ids }], joins: [], discard: [], retry: [] };
    const first = await requests.saveGrouping(grouping);
    expect(first).toHaveLength(1);
    // The same grouping again (a pass that read before the first one saved): no second card, no row moves.
    const second = await requests.saveGrouping(grouping);
    expect(second).toEqual([]);
    // Nor through a join to another card, nor into a discard or a retry.
    const other = await requests.saveGrouping({ ...grouping, newCards: [{ title: "Otra", requestIds: [] }], joins: [{ cardId: first[0]!.card.id, requestIds: ids }], discard: ids, retry: ids });
    expect(other).toEqual([]);
    const { rows } = await pg.query<{ cardId: string; attempts: number; discardedAt: string | null }>(`select "cardId", "attempts", "discardedAt" from "assistantRequests"`);
    expect(rows.every((r) => r.cardId === first[0]!.card.id && r.attempts === 0 && r.discardedAt === null)).toBe(true);
    const { rows: cards } = await pg.query(`select 1 from "assistantRequestCards"`);
    expect(cards).toHaveLength(1);
  });

  it("joining recounts the visitors and says how many there were before", async () => {
    await note("vid-a", "¿envíos?");
    const [first] = await requests.saveGrouping({ assistantId: lucia, projectId: "p1", locale: "es", at: NOW, newCards: [{ title: "Envíos", requestIds: await pendingIds() }], joins: [], discard: [], retry: [] });
    await note("vid-a", "¿y envíos el domingo?");
    await note("vid-b", "¿envían?");
    const later = new Date(NOW.getTime() + 60_000);
    const [joined] = await requests.saveGrouping({ assistantId: lucia, projectId: "p1", locale: "es", at: later, newCards: [], joins: [{ cardId: first!.card.id, requestIds: await pendingIds() }], discard: [], retry: [] });
    expect(joined!.isNew).toBe(false);
    expect(joined!.before).toBe(1);
    expect(joined!.card.visitors).toBe(2);
    expect(joined!.card.lastAt.toISOString()).toBe(later.toISOString());
  });

  it("a join to a card of another project, or one decided meanwhile, attaches nothing", async () => {
    await note("vid-a", "¿envíos?", NOW, "p2");
    const [p2card] = await requests.saveGrouping({ assistantId: lucia, projectId: "p2", locale: "es", at: NOW, newCards: [{ title: "Envíos", requestIds: (await requests.pendingRequests(lucia, "p2", 10)).map((r) => r.id) }], joins: [], discard: [], retry: [] });
    await note("vid-b", "¿envíos?");
    expect(await requests.saveGrouping({ assistantId: lucia, projectId: "p1", locale: "es", at: NOW, newCards: [], joins: [{ cardId: p2card!.card.id, requestIds: await pendingIds() }], discard: [], retry: [] })).toEqual([]);
    await pg.query(`update "assistantRequestCards" set "status" = 'accepted' where "id" = $1`, [p2card!.card.id]);
    await note("vid-c", "¿envíos?", NOW, "p2");
    const p2pending = (await requests.pendingRequests(lucia, "p2", 10)).map((r) => r.id);
    expect(await requests.saveGrouping({ assistantId: lucia, projectId: "p2", locale: "es", at: NOW, newCards: [], joins: [{ cardId: p2card!.card.id, requestIds: p2pending }], discard: [], retry: [] })).toEqual([]);
    expect(await requests.pendingRequests(lucia, "p2", 10)).toHaveLength(1);
  });

  it("retry adds an attempt and leaves the request waiting; discard takes it out", async () => {
    await note("vid-a", "¿envíos?", new Date(NOW.getTime() - 2000));
    await note("vid-b", "hola", new Date(NOW.getTime() - 1000));
    const [a, b] = await pendingIds();
    expect(await requests.saveGrouping({ assistantId: lucia, projectId: "p1", locale: "es", at: NOW, newCards: [], joins: [], discard: [b!], retry: [a!] })).toEqual([]);
    const left = await requests.pendingRequests(lucia, "p1", 10);
    expect(left.map((r) => [r.id, r.attempts])).toEqual([[a, 1]]);
  });
});

describe("forgetting", () => {
  it("deleting the assistant takes its requests and cards", async () => {
    await note("vid-a", "¿envíos?");
    await note("vid-b", "¿reservas?");
    const [a] = await pendingIds();
    await requests.saveGrouping({ assistantId: lucia, projectId: "p1", locale: "es", at: NOW, newCards: [{ title: "Envíos", requestIds: [a!] }], joins: [], discard: [], retry: [] });
    expect(await deleteAssistant("u1", lucia)).toBe(true);
    expect((await pg.query(`select 1 from "assistantRequests"`)).rows).toHaveLength(0);
    expect((await pg.query(`select 1 from "assistantRequestCards"`)).rows).toHaveLength(0);
  });

  it("requests and cards quiet for 90 days are pruned; a card's requests go with it, never back to waiting", async () => {
    const old = new Date(NOW.getTime() - 91 * DAY);
    await note("vid-a", "¿envíos?", old);
    await note("vid-b", "hola", old);
    const [a] = await pendingIds();
    await requests.saveGrouping({ assistantId: lucia, projectId: "p1", locale: "es", at: old, newCards: [{ title: "Envíos", requestIds: [a!] }], joins: [], discard: [], retry: [] });
    await note("vid-c", "¿regalos?");
    await requests.pruneRequests(NOW);
    expect((await requests.pendingRequests(lucia, "p1", 10)).map((r) => r.text)).toEqual(["¿regalos?"]);
    expect((await pg.query(`select 1 from "assistantRequestCards"`)).rows).toHaveLength(0);
  });
});

// Task 6: the owner's press decides a card once; a turn that couldn't start puts it back.
describe("deciding", () => {
  async function aCard(projectId = "p1", title = "Envíos") {
    await note(`vid-${title}`, `¿${title}?`, NOW, projectId);
    const ids = (await requests.pendingRequests(lucia, projectId, 10)).map((r) => r.id);
    const [saved] = await requests.saveGrouping({ assistantId: lucia, projectId, locale: "es", at: NOW, newCards: [{ title, requestIds: ids }], joins: [], discard: [], retry: [] });
    return saved!.card;
  }

  it("🔴 a card is decided once, whoever presses first, and only by its assistant", async () => {
    const card = await aCard();
    const [a, b] = await Promise.all([
      requests.decideCard(card.id, lucia, "accept", "u1", NOW),
      requests.decideCard(card.id, lucia, "dismiss", "u1", NOW),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(await requests.decideCard(card.id, lucia, "accept", "u1", NOW)).toBeNull();
    const other = await aCard("p1", "Reservas");
    expect(await requests.decideCard(other.id, "another-assistant", "accept", "u1", NOW)).toBeNull();
    const decided = await requests.decideCard(other.id, lucia, "accept", "u1", NOW);
    expect(decided).toMatchObject({ status: "accepted", decidedBy: "u1", failure: null });
    expect(decided!.decidedAt!.toISOString()).toBe(NOW.toISOString());
  });

  it("🔴 a turn that couldn't start puts an accepted card back, with why; only an accepted one", async () => {
    const card = await aCard();
    await requests.decideCard(card.id, lucia, "accept", "u1", NOW);
    await requests.setAcceptedRow(card.id, "row-1");
    await requests.reopenCard(card.id, "no_credits");
    const [back] = await requests.requestCardsOfAssistant(lucia, NOW);
    expect(back).toMatchObject({ id: card.id, status: "pending", failure: "no_credits", acceptedRowId: null, decidedAt: null, decidedBy: null });
    // Pressed again: the failure is cleared.
    expect(await requests.decideCard(card.id, lucia, "accept", "u1", NOW)).toMatchObject({ status: "accepted", failure: null });
    // A dismissed card is never put back.
    const dismissed = await aCard("p1", "Regalos");
    await requests.decideCard(dismissed.id, lucia, "dismiss", "u1", NOW);
    await requests.reopenCard(dismissed.id, "no_credits");
    expect((await requests.requestCardsOfAssistant(lucia, NOW)).find((c) => c.id === dismissed.id)).toMatchObject({ status: "dismissed", failure: null });
  });

  it("her cards: the waiting ones, and what was decided in the last 30 days, with each project's name", async () => {
    const waiting = await aCard("p1", "Envíos");
    const old = await aCard("p2", "Regalos");
    await requests.decideCard(old.id, lucia, "dismiss", "u1", new Date(NOW.getTime() - 31 * DAY));
    const recent = await aCard("p2", "Reservas");
    await requests.decideCard(recent.id, lucia, "accept", "u1", NOW);
    const cards = await requests.requestCardsOfAssistant(lucia, NOW);
    expect(cards.map((c) => [c.title, c.projectTitle]).sort()).toEqual([["Envíos", "Pastelería"], ["Reservas", "Tienda"]]);
    expect(cards.find((c) => c.id === waiting.id)!.status).toBe("pending");
  });

  it("a project's cards for the chat: the waiting ones and what was decided in 7 days, with her name and person", async () => {
    await aCard("p1", "Envíos");
    const decided = await aCard("p1", "Reservas");
    await requests.decideCard(decided.id, lucia, "dismiss", "u1", new Date(NOW.getTime() - 8 * DAY));
    await aCard("p2", "Regalos");
    const cards = await requests.requestCardsOfProject("p1", NOW);
    expect(cards.map((c) => c.title)).toEqual(["Envíos"]);
    expect(cards[0]).toMatchObject({ assistantName: "Lucía", personId: "u1" });
  });
});
