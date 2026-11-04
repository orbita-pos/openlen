// @vitest-environment node
//
// Cards and their notice (spec local 2026-11-03-len-que-avisa, §7.6, §7.7): what `automation_notify` leaves for
// the owner, the `len_aviso` it schedules, and accepting or dismissing it once. Real Postgres (PGlite).
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/lib/db/schema";
import type { LenAvisoEvent } from "@/lib/notifications/types";

const base = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", async () => ({
  schema: await import("@/lib/db/schema"),
  get db() {
    return base.db;
  },
}));

const { CREATE_SCHEDULED_TASKS, CREATE_EVENT_TASKS, ALTER_EVENT_TASK_CARDS } = await import("@/scripts/scheduled-tasks-migrate-sql");
const store = await import("./store");
const cards = await import("./cards");
const { breaksQuietHours } = await import("@/lib/notifications/urgency");
const { mensajeFcm } = await import("@/lib/notifications/channels/fcm-transporte");
const { lenAvisoPush } = await import("@/lib/notifications/channels/webpush");

const NOW = new Date("2026-11-03T20:00:00Z");
let pg: PGlite;

beforeEach(async () => {
  pg = new PGlite();
  await pg.exec(`CREATE TABLE "users" ("id" text PRIMARY KEY); CREATE TABLE "projects" ("id" text PRIMARY KEY);
    INSERT INTO "users" VALUES ('u1'); INSERT INTO "projects" VALUES ('p1');`);
  for (const statement of [...CREATE_SCHEDULED_TASKS, ...CREATE_EVENT_TASKS, ...ALTER_EVENT_TASK_CARDS]) await pg.query(statement);
  base.db = drizzle(pg, { schema });
});

const newTask = () =>
  store.createEventTask({ projectId: "p1", createdBy: "u1", locale: "es", timeZone: "America/Mexico_City", title: "Reservas que chocan", prompt: "p", source: "app_rows", params: {}, state: {}, now: NOW });

function notifier() {
  const sent: { event: LenAvisoEvent; dedupeKey: string }[] = [];
  return { sent, notify: async (event: LenAvisoEvent, dedupeKey: string) => void sent.push({ event, dedupeKey }) };
}

const card = (task: Awaited<ReturnType<typeof newTask>>, title: string, n: ReturnType<typeof notifier>, subjectKey = title) =>
  cards.createCard(
    { task, recordId: "r1", title, summary: "La reserva de Ana choca con la de Luis.", actions: [{ kind: "project", text: "Escribirle a Ana para ofrecerle las 21:30." }], subjectKey },
    { notify: n.notify, siteUrl: "https://openlen.com" },
  );

describe("createCard", () => {
  it("schedules one len_aviso to the task's creator, in their language, keyed by the task", async () => {
    const task = await newTask();
    const n = notifier();
    const c = await card(task, "Reserva de las 21:00 choca con la mesa 4", n);
    expect(n.sent).toHaveLength(1);
    // Keyed by the TASK: a notice held by quiet hours folds into the newest card instead of each firing (review I11).
    expect(n.sent[0]!.dedupeKey).toBe(`len_aviso:${task.id}`);
    expect(n.sent[0]!.event).toMatchObject({
      type: "len_aviso",
      projectId: "p1",
      recipientUserId: "u1",
      cardId: c.id,
      title: "Reservas que chocan",
      push: "Reserva de las 21:00 choca con la mesa 4",
      emailSubject: "🔔 Reservas que chocan: Reserva de las 21:00 choca con la mesa 4",
    });
    expect(n.sent[0]!.event.emailText).toContain("Len propone: Escribirle a Ana para ofrecerle las 21:30.");
    expect(n.sent[0]!.event.emailText).toContain(`card=${c.id}`);
  });

  it("a card never enters what Len reads in the project chat: it writes no chat row", async () => {
    await pg.exec(`CREATE TABLE "projectChatMessages" ("id" text PRIMARY KEY, "projectId" text, "userText" text);`);
    await card(await newTask(), "Reserva de las 21:00 choca con la mesa 4", notifier());
    expect((await pg.query(`SELECT 1 FROM "projectChatMessages"`)).rows).toEqual([]);
  });

  it("a card stores its actions with state pending and zero attempts", async () => {
    const task = await newTask();
    const made = await cards.createCard(
      {
        task,
        recordId: "r1",
        title: "Choque",
        summary: "Ana y Luis.",
        actions: [
          { kind: "data_change", table: "reservas", key: { id: "r2" }, set: { mesa: "6" }, before: { mesa: "4" } },
          { kind: "reply", channel: "email", to: "luis@ejemplo.com", subject: "Tu reserva", body: "Hola Luis" },
        ],
        subjectKey: "r2",
      },
      { notify: notifier().notify, siteUrl: "https://openlen.com" },
    );
    expect(made.subjectKey).toBe("r2");
    expect(made.actions).toEqual([
      { action: { kind: "data_change", table: "reservas", key: { id: "r2" }, set: { mesa: "6" }, before: { mesa: "4" } }, state: "pending", attempts: 0, nextAttemptAt: null, error: null, result: null },
      { action: { kind: "reply", channel: "email", to: "luis@ejemplo.com", subject: "Tu reserva", body: "Hola Luis" }, state: "pending", attempts: 0, nextAttemptAt: null, error: null, result: null },
    ]);
    expect(made.proposedAction).toContain("reservas");
  });

  it("two pending cards of one task about different rows both stay pending, and a third about the first row replaces only it (review focus 5)", async () => {
    const [a, b] = [await newTask(), await newTask()];
    const n = notifier();
    const r1 = await card(a, "uno", n, "r1");
    const r2 = await card(a, "dos", n, "r2");
    const other = await card(b, "otra tarea", n, "r1");
    const again = await card(a, "uno otra vez", n, "r1");
    const status = Object.fromEntries((await pg.query<{ id: string; status: string }>(`SELECT "id", "status" FROM "eventTaskCards"`)).rows.map((r) => [r.id, r.status]));
    expect(status[r1.id]).toBe("replaced");
    expect(status[r2.id]).toBe("pending");
    expect(status[other.id]).toBe("pending");
    expect(status[again.id]).toBe("pending");
    expect((await cards.pendingCardsOfTask(a.id)).map((c) => c.id).sort()).toEqual([r2.id, again.id].sort());
  });

  it("updateCardAction changes one action's record and leaves the other", async () => {
    const task = await newTask();
    const made = await cards.createCard(
      {
        task,
        recordId: "r1",
        title: "Choque",
        summary: "Ana y Luis.",
        actions: [
          { kind: "data_change", table: "reservas", key: { id: "r2" }, set: { mesa: "6" }, before: { mesa: "4" } },
          { kind: "reply", channel: "email", to: "luis@ejemplo.com", subject: "Tu reserva", body: "Hola" },
        ],
        subjectKey: "r2",
      },
      { notify: notifier().notify, siteUrl: "https://openlen.com" },
    );
    await cards.updateCardAction(made.id, 0, { state: "done", result: "mesa 4 → 6" });
    const after = (await cards.getCard(made.id))!.actions!;
    expect(after[0]).toMatchObject({ state: "done", result: "mesa 4 → 6", attempts: 0 });
    expect(after[1]).toMatchObject({ state: "pending", result: null });
  });

  it("the migration adds the new columns to existing tables, and running it twice is harmless", async () => {
    for (const statement of [...ALTER_EVENT_TASK_CARDS, ...ALTER_EVENT_TASK_CARDS]) await pg.query(statement);
    const cols = (await pg.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns WHERE column_name IN ('actions', 'subjectKey', 'dismissNote', 'lookedAgain', 'note') ORDER BY table_name, column_name`,
    )).rows.map((r) => `${r.table_name}.${r.column_name}`);
    expect(cols).toEqual(["eventTaskCards.actions", "eventTaskCards.dismissNote", "eventTaskCards.lookedAgain", "eventTaskCards.subjectKey", "eventTaskRecords.note"]);
  });
});

describe("pendingCardsOfProjects", () => {
  it("the pending cards of these projects, newest first; decided ones are not", async () => {
    const n = notifier();
    const task = await newTask();
    const first = await card(task, "Primero", n);
    const other = await store.createEventTask({ projectId: "p1", createdBy: "u1", locale: "es", timeZone: "UTC", title: "Otra", prompt: "p", source: "form_submissions", params: {}, state: {}, now: NOW });
    const second = await card(other, "Segundo", n);
    await cards.decideCard("p1", first.id, "dismiss", "u1", NOW);
    expect((await cards.pendingCardsOfProjects(["p1"])).map((c) => c.id)).toEqual([second.id]);
    expect(await cards.pendingCardsOfProjects([])).toEqual([]);
  });
});

describe("decideCard", () => {
  it("two concurrent decisions on one card: one wins, the other gets not_pending", async () => {
    const c = await card(await newTask(), "t", notifier());
    const [x, y] = await Promise.all([cards.decideCard("p1", c.id, "accept", "u1", NOW), cards.decideCard("p1", c.id, "dismiss", "u1", NOW)]);
    expect([x.ok, y.ok].sort()).toEqual([false, true]);
    expect([x, y].find((r) => !r.ok)).toEqual({ ok: false, reason: "not_pending" });
  });

  it("«Ahora no» with a note keeps the note on the card; without one it keeps none", async () => {
    const task = await newTask();
    const n = notifier();
    const a = await card(task, "a", n, "a");
    const b = await card(task, "b", n, "b");
    expect(await cards.decideCard("p1", a.id, "dismiss", "u1", NOW, "Ofrécele la 8.")).toMatchObject({ ok: true, card: { dismissNote: "Ofrécele la 8." } });
    expect(await cards.decideCard("p1", b.id, "accept", "u1", NOW, "ignored")).toMatchObject({ ok: true, card: { dismissNote: null } });
  });

  it("cardOfRecord since a time finds only the cards made since then: a requeued record's old card doesn't count", async () => {
    const c = await card(await newTask(), "t", notifier());
    expect((await cards.cardOfRecord("r1", new Date(c.createdAt.getTime() - 1000)))?.id).toBe(c.id);
    expect(await cards.cardOfRecord("r1", new Date(c.createdAt.getTime() + 1000))).toBeNull();
  });

  it("answerLookAgain writes Len's answer on the record's card that asked to look again — a blocked change, or a dismissal with a note — and nowhere else", async () => {
    const task = await newTask();
    const n = notifier();
    const blocked = await card(task, "bloqueada", n, "a");
    await cards.decideCard("p1", blocked.id, "accept", "u1", NOW);
    await cards.updateCardAction(blocked.id, 0, { state: "blocked", result: "mesa 3" });
    const noted = await card(task, "con nota", n, "b");
    await cards.decideCard("p1", noted.id, "dismiss", "u1", NOW, "mejor a las 22:00");
    const plain = await card(task, "descartada", n, "c");
    await cards.decideCard("p1", plain.id, "dismiss", "u1", NOW);
    const waiting = await card(task, "pendiente", n, "d");
    await cards.answerLookAgain("r1", "Ya no choca con ninguna: no hay nada que hacer.");
    const after = async (id: string) => (await cards.getCard(id))!.lookedAgain;
    expect(await after(blocked.id)).toBe("Ya no choca con ninguna: no hay nada que hacer.");
    expect(await after(noted.id)).toBe("Ya no choca con ninguna: no hay nada que hacer.");
    expect(await after(plain.id)).toBeNull();
    expect(await after(waiting.id)).toBeNull();
  });

  it("the judge's list of waiting cards is the chat's: this week's, the newest ten (final review I3)", async () => {
    const task = await newTask();
    const n = notifier();
    const old = await card(task, "vieja", n, "old");
    await pg.query(`UPDATE "eventTaskCards" SET "createdAt" = now() - interval '8 days' WHERE id = $1`, [old.id]);
    for (let i = 0; i < 12; i++) await card(task, `c${i}`, n, `s${i}`);
    const list = await cards.pendingCardsOfTask(task.id, new Date(Date.now() - 7 * 86_400_000));
    expect(list).toHaveLength(10);
    expect(list.map((c) => c.id)).not.toContain(old.id);
  });

  it("interruptedCards: accepted before a time with an action still pending, and nothing else (final review I1)", async () => {
    const task = await newTask();
    const n = notifier();
    const BEFORE = new Date(NOW.getTime() - 10 * 60_000);
    const cut = await card(task, "cortada", n, "a");
    await cards.decideCard("p1", cut.id, "accept", "u1", BEFORE);
    const pressing = await card(task, "en curso", n, "b");
    await cards.decideCard("p1", pressing.id, "accept", "u1", NOW);
    const finished = await card(task, "terminada", n, "c");
    await cards.decideCard("p1", finished.id, "accept", "u1", BEFORE);
    await cards.updateCardAction(finished.id, 0, { state: "done" });
    await card(task, "esperando", n, "d");
    expect((await cards.interruptedCards(new Date(NOW.getTime() - 120_000))).map((c) => c.id)).toEqual([cut.id]);
  });

  it("an unknown card is not_found", async () => {
    expect(await cards.decideCard("p1", "nope", "accept", "u1", NOW)).toEqual({ ok: false, reason: "not_found" });
  });

  it("a card can't be decided from another project: not_found, and it stays pending (review C2)", async () => {
    const c = await card(await newTask(), "t", notifier());
    expect(await cards.decideCard("p2", c.id, "dismiss", "u1", NOW)).toEqual({ ok: false, reason: "not_found" });
    expect((await cards.getCard(c.id))!.status).toBe("pending");
  });

  it("a replaced card is reported to the next judge", async () => {
    const task = await newTask();
    const n = notifier();
    const first = await card(task, "uno", n, "r1");
    await card(task, "uno otra vez", n, "r1");
    expect((await cards.decisionsSince(task.id, new Date(Date.now() - 60_000))).map((d) => ({ id: d.id, status: d.status }))).toEqual([{ id: first.id, status: "replaced" }]);
  });

  it("the decisions since a time are what the judge reads next", async () => {
    const task = await newTask();
    const c = await card(task, "t", notifier());
    await cards.decideCard("p1", c.id, "dismiss", "u1", NOW);
    expect((await cards.decisionsSince(task.id, new Date(NOW.getTime() - 1))).map((d) => ({ id: d.id, status: d.status }))).toEqual([{ id: c.id, status: "dismissed" }]);
  });
});

describe("the notice", () => {
  it("pushText of a 300-char title is 199 chars plus … on one line, without markdown", () => {
    const text = cards.pushText(`**Reserva**\n${"x".repeat(300)}`);
    expect(text).toHaveLength(200);
    expect(text.endsWith("…")).toBe(true);
    expect(text).not.toMatch(/[\n*`#]/);
  });

  const event: LenAvisoEvent = { type: "len_aviso", projectId: "p1", recipientUserId: "u1", cardId: "c1", title: "Reservas", push: "Choca la mesa 4", emailSubject: "s", emailText: "t" };

  it("len_aviso is held by quiet hours", () => {
    expect(breaksQuietHours(event)).toBe(false);
  });

  it("len_aviso goes to push with the card to open", () => {
    expect(mensajeFcm(event, "tok").message.notification).toEqual({ title: "Reservas", body: "Choca la mesa 4" });
    expect(mensajeFcm(event, "tok").message.data).toMatchObject({ type: "len_aviso", tarjeta: "c1" });
    expect(lenAvisoPush(event)).toEqual({ title: "Reservas", body: "Choca la mesa 4", url: "/new?project=p1&chat=1&card=c1" });
  });
});
