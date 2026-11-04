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

const { CREATE_SCHEDULED_TASKS, CREATE_EVENT_TASKS } = await import("@/scripts/scheduled-tasks-migrate-sql");
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
  for (const statement of [...CREATE_SCHEDULED_TASKS, ...CREATE_EVENT_TASKS]) await pg.query(statement);
  base.db = drizzle(pg, { schema });
});

const newTask = () =>
  store.createEventTask({ projectId: "p1", createdBy: "u1", locale: "es", timeZone: "America/Mexico_City", title: "Reservas que chocan", prompt: "p", source: "app_rows", params: {}, state: {}, now: NOW });

function notifier() {
  const sent: { event: LenAvisoEvent; dedupeKey: string }[] = [];
  return { sent, notify: async (event: LenAvisoEvent, dedupeKey: string) => void sent.push({ event, dedupeKey }) };
}

const card = (task: Awaited<ReturnType<typeof newTask>>, title: string, n: ReturnType<typeof notifier>) =>
  cards.createCard({ task, recordId: "r1", title, summary: "La reserva de Ana choca con la de Luis.", proposedAction: "Escribirle a Ana para ofrecerle las 21:30." }, { notify: n.notify, siteUrl: "https://openlen.com" });

describe("createCard", () => {
  it("schedules one len_aviso to the task's creator, in their language, keyed by the card", async () => {
    const task = await newTask();
    const n = notifier();
    const c = await card(task, "Reserva de las 21:00 choca con la mesa 4", n);
    expect(n.sent).toHaveLength(1);
    expect(n.sent[0]!.dedupeKey).toBe(c.id);
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

  it("a new card replaces the pending one of the same task, not of another task", async () => {
    const [a, b] = [await newTask(), await newTask()];
    const n = notifier();
    const first = await card(a, "uno", n);
    const other = await card(b, "otra tarea", n);
    await card(a, "dos", n);
    const status = Object.fromEntries((await pg.query<{ id: string; status: string }>(`SELECT "id", "status" FROM "eventTaskCards"`)).rows.map((r) => [r.id, r.status]));
    expect(status[first.id]).toBe("replaced");
    expect(status[other.id]).toBe("pending");
  });
});

describe("pendingCardsOfProjects", () => {
  it("the pending cards of these projects, newest first; decided ones are not", async () => {
    const n = notifier();
    const task = await newTask();
    const first = await card(task, "Primero", n);
    const other = await store.createEventTask({ projectId: "p1", createdBy: "u1", locale: "es", timeZone: "UTC", title: "Otra", prompt: "p", source: "form_submissions", params: {}, state: {}, now: NOW });
    const second = await card(other, "Segundo", n);
    await cards.decideCard(first.id, "dismiss", "u1", NOW);
    expect((await cards.pendingCardsOfProjects(["p1"])).map((c) => c.id)).toEqual([second.id]);
    expect(await cards.pendingCardsOfProjects([])).toEqual([]);
  });
});

describe("decideCard", () => {
  it("two concurrent decisions on one card: one wins, the other gets not_pending", async () => {
    const c = await card(await newTask(), "t", notifier());
    const [x, y] = await Promise.all([cards.decideCard(c.id, "accept", "u1", NOW), cards.decideCard(c.id, "dismiss", "u1", NOW)]);
    expect([x.ok, y.ok].sort()).toEqual([false, true]);
    expect([x, y].find((r) => !r.ok)).toEqual({ ok: false, reason: "not_pending" });
  });

  it("an unknown card is not_found", async () => {
    expect(await cards.decideCard("nope", "accept", "u1", NOW)).toEqual({ ok: false, reason: "not_found" });
  });

  it("the decisions since a time are what the judge reads next", async () => {
    const task = await newTask();
    const c = await card(task, "t", notifier());
    await cards.decideCard(c.id, "dismiss", "u1", NOW);
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
