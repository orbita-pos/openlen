// @vitest-environment node
//
// THE MAILBOX between Len and the person's agents (spec local 2026-11-21-len-y-el-agente-conversan, §3 and decisions
// 6, 9 and 11): a message is written here before anything wakes, and counts as delivered only once a turn reads it.
// Against real Postgres (PGlite), with the tables as `npm run assistants:migrate` creates them over minimal users,
// projects and chat rows.
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/lib/db/schema";

import type { MessageDirection } from "./store";

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
const { createAssistant } = await import("../store");
const mailbox = await import("./store");
const { HELD_DAYS, RESUME_HOURS } = await import("./policy");

const NOW = new Date("2026-11-21T12:00:00Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const FINANZAS = { name: "Finanzas", look: { v: 1, shape: "drop", color: "#19c3b1", eyes: "oval", eyewear: "none", accessory: "none" }, tone: "friendly" } as const;
const LUCIA = { name: "Lucía", look: { v: 1, shape: "drop", color: "#f4a48b", eyes: "oval", eyewear: "none", accessory: "none" }, tone: "friendly" } as const;

let pg: PGlite;
let finanzas: string;
let lucia: string;

/** A message of the mailbox written `at` that time, with the status the test needs it in. */
async function put(o: { direction?: MessageDirection; assistantId?: string; projectId?: string; at: Date; status?: string; deliveringAt?: Date; text?: string }): Promise<string> {
  const row = await mailbox.addMessage({ assistantId: o.assistantId ?? finanzas, projectId: o.projectId ?? "budget", direction: o.direction ?? "to_agent", text: o.text ?? "hola", ownerWords: null });
  await pg.query(`update "agentLenMessages" set "createdAt" = $1, "status" = coalesce($2, "status"), "deliveringAt" = $3 where "id" = $4`, [o.at, o.status ?? null, o.deliveringAt ?? null, row.id]);
  return row.id;
}

const statusOf = async (id: string) => (await pg.query<{ status: string }>(`select "status" from "agentLenMessages" where "id" = $1`, [id])).rows[0]?.status;

/** A row of the project's chat: the person's when `origen` is null, one Len's server wrote when it isn't. */
async function chatRow(o: { id: string; projectId: string; conversation?: string | null; origen?: object | null; at: Date }) {
  await pg.query(`insert into "projectChatMessages" ("id", "projectId", "conversation", "origen", "createdAt") values ($1, $2, $3, $4::jsonb, $5)`, [
    o.id,
    o.projectId,
    o.conversation ?? null,
    o.origen ? JSON.stringify(o.origen) : null,
    o.at,
  ]);
}

beforeEach(async () => {
  pg = new PGlite();
  await pg.query(`create table "users" ("id" text primary key)`);
  await pg.query(`create table "projects" ("id" text primary key, "userId" text)`);
  await pg.query(
    `create table "projectChatMessages" ("id" text primary key, "projectId" text not null references "projects"("id") on delete cascade, "conversation" text, "origen" jsonb, "createdAt" timestamp not null default now())`,
  );
  await pg.query(`insert into "users" values ('u1')`);
  await pg.query(`insert into "projects" values ('home', 'u1'), ('budget', 'u1'), ('other', 'u1')`);
  for (const statement of CREATE_ASSISTANTS) await pg.query(statement);
  base.db = drizzle(pg, { schema });
  const f = await createAssistant({ personId: "u1", projectId: "home", input: FINANZAS });
  const l = await createAssistant({ personId: "u1", projectId: "other", input: LUCIA });
  if (!f.ok || !l.ok) throw new Error("setup");
  finanzas = f.assistant.id;
  lucia = l.assistant.id;
});

describe("the policy the mailbox keeps", () => {
  it("a held message waits 7 days; one that was waking a turn is resumed within 24 hours", () => {
    expect(HELD_DAYS).toBe(7);
    expect(RESUME_HOURS).toBe(24);
  });
});

describe("keeping a message", () => {
  it("🔴 a message is kept before anything else: pending, with the person's own words when it carries them", async () => {
    const row = await mailbox.addMessage({ assistantId: finanzas, projectId: "budget", direction: "to_len", text: "¿Cuál es el tope?", ownerWords: "usa 500 de tope" });
    expect(row).toMatchObject({ assistantId: finanzas, projectId: "budget", direction: "to_len", text: "¿Cuál es el tope?", ownerWords: "usa 500 de tope", status: "pending", heldReason: null, deliveringAt: null, deliveredAt: null });
    expect(row.createdAt).toBeInstanceOf(Date);
    const stored = await pg.query<Record<string, unknown>>(`select * from "agentLenMessages" where "id" = $1`, [row.id]);
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0]).toMatchObject({ status: "pending", direction: "to_len", ownerWords: "usa 500 de tope", readByRow: null });
  });

  it("two messages are two rows", async () => {
    const a = await mailbox.addMessage({ assistantId: finanzas, projectId: "budget", direction: "to_agent", text: "uno", ownerWords: null });
    const b = await mailbox.addMessage({ assistantId: finanzas, projectId: "budget", direction: "to_agent", text: "dos", ownerWords: null });
    expect(a.id).not.toBe(b.id);
  });

  it("markDelivering marks the one that woke a turn, and never takes back one a turn already read", async () => {
    const woke = await put({ at: ago(HOUR) });
    await mailbox.markDelivering(woke, NOW);
    const r = (await pg.query<{ status: string; deliveringAt: Date }>(`select "status", "deliveringAt" from "agentLenMessages" where "id" = $1`, [woke])).rows[0]!;
    expect(r.status).toBe("delivering");
    expect(r.deliveringAt.toISOString()).toBe(NOW.toISOString());

    const read = await put({ at: ago(HOUR), status: "delivered" });
    await mailbox.markDelivering(read, NOW);
    expect(await statusOf(read)).toBe("delivered");
  });

  it("hold keeps pending and delivering ones waiting with their reason, and leaves delivered and expired ones alone", async () => {
    const pending = await put({ at: ago(HOUR) });
    const delivering = await put({ at: ago(HOUR), status: "delivering", deliveringAt: ago(HOUR) });
    const delivered = await put({ at: ago(HOUR), status: "delivered" });
    const expired = await put({ at: ago(HOUR), status: "expired" });
    await mailbox.hold([pending, delivering, delivered, expired], "cap");
    expect(await statusOf(pending)).toBe("held");
    expect(await statusOf(delivering)).toBe("held");
    expect(await statusOf(delivered)).toBe("delivered");
    expect(await statusOf(expired)).toBe("expired");
    const reasons = await pg.query<{ id: string; heldReason: string | null }>(`select "id", "heldReason" from "agentLenMessages" where "id" in ($1, $2, $3)`, [pending, delivering, delivered]);
    expect(Object.fromEntries(reasons.rows.map((r) => [r.id, r.heldReason]))).toEqual({ [pending]: "cap", [delivering]: "cap", [delivered]: null });
    // Nothing to hold is no query.
    await expect(mailbox.hold([], "no_credits")).resolves.toBeUndefined();
  });
});

describe("the count of messages back and forth", () => {
  const FINANZAS_CHAT = () => `assistant:${finanzas}`;

  it("🔴 the count starts again when the person writes in the project's chat", async () => {
    await put({ at: ago(5 * HOUR), direction: "to_agent" });
    await put({ at: ago(4 * HOUR), direction: "to_len" });
    await put({ at: ago(3 * HOUR), direction: "to_agent" });
    await chatRow({ id: "person-1", projectId: "budget", at: ago(2 * HOUR) });
    await put({ at: ago(HOUR), direction: "to_len" });

    const since = await mailbox.lastPersonMessageAt(finanzas, "budget", "home");
    expect(since?.toISOString()).toBe(ago(2 * HOUR).toISOString());
    expect(await mailbox.messagesSince(finanzas, "budget", since)).toBe(1);
    expect(await mailbox.messagesSince(finanzas, "budget", null)).toBe(4);
  });

  it("🔴 and when the person writes in the agent's own conversation, at the agent's home", async () => {
    await put({ at: ago(5 * HOUR) });
    await put({ at: ago(4 * HOUR) });
    await put({ at: ago(3 * HOUR) });
    await chatRow({ id: "person-2", projectId: "home", conversation: FINANZAS_CHAT(), at: ago(2 * HOUR) });
    await put({ at: ago(HOUR) });

    const since = await mailbox.lastPersonMessageAt(finanzas, "budget", "home");
    expect(since?.toISOString()).toBe(ago(2 * HOUR).toISOString());
    expect(await mailbox.messagesSince(finanzas, "budget", since)).toBe(1);
  });

  it("the later of the two chats is the one that counts", async () => {
    await chatRow({ id: "in-project", projectId: "budget", at: ago(3 * HOUR) });
    await chatRow({ id: "in-agent", projectId: "home", conversation: FINANZAS_CHAT(), at: ago(HOUR) });
    expect((await mailbox.lastPersonMessageAt(finanzas, "budget", "home"))?.toISOString()).toBe(ago(HOUR).toISOString());
  });

  it("🔴 Len's own server rows — a request of an agent, a scheduled task — are not the person writing", async () => {
    await chatRow({ id: "from-agent", projectId: "budget", origen: { kind: "assistant" }, at: ago(HOUR) });
    await chatRow({ id: "from-agent-chat", projectId: "home", conversation: FINANZAS_CHAT(), origen: { kind: "scheduled" }, at: ago(HOUR) });
    expect(await mailbox.lastPersonMessageAt(finanzas, "budget", "home")).toBeNull();
  });

  it("the person writing somewhere else is not this pair's: another project, another agent, an archived chat", async () => {
    await chatRow({ id: "other-project", projectId: "other", at: ago(HOUR) });
    await chatRow({ id: "other-agent", projectId: "home", conversation: `assistant:${lucia}`, at: ago(HOUR) });
    await chatRow({ id: "archived", projectId: "budget", conversation: "archived-chat-1", at: ago(HOUR) });
    // The agent's conversation is read at its home only.
    await chatRow({ id: "wrong-home", projectId: "budget", conversation: FINANZAS_CHAT(), at: ago(HOUR) });
    expect(await mailbox.lastPersonMessageAt(finanzas, "budget", "home")).toBeNull();
  });

  it("only this pair's messages count, in either direction, and never an expired one", async () => {
    await put({ at: ago(HOUR), direction: "to_agent" });
    await put({ at: ago(HOUR), direction: "to_len" });
    await put({ at: ago(HOUR), status: "expired" });
    await put({ at: ago(HOUR), projectId: "other" });
    await put({ at: ago(HOUR), assistantId: lucia });
    expect(await mailbox.messagesSince(finanzas, "budget", null)).toBe(2);
    expect(await mailbox.messagesSince(finanzas, "budget", ago(2 * HOUR))).toBe(2);
    expect(await mailbox.messagesSince(finanzas, "budget", NOW)).toBe(0);
  });
});

describe("a turn reading its messages", () => {
  it("🔴 claiming takes held and pending ones, oldest first, once", async () => {
    const newest = await put({ at: ago(HOUR) });
    const oldest = await put({ at: ago(3 * HOUR), status: "held" });
    const middle = await put({ at: ago(2 * HOUR), status: "delivering", deliveringAt: ago(2 * HOUR) });
    const first = await mailbox.claimForAgent(finanzas, "row-1", NOW);
    expect(first.map((m) => m.id)).toEqual([oldest, middle, newest]);
    expect(first.every((m) => m.status === "delivered" && m.deliveredAt?.toISOString() === NOW.toISOString())).toBe(true);
    const stored = await pg.query<{ status: string; readByRow: string }>(`select "status", "readByRow" from "agentLenMessages" order by "createdAt"`);
    expect(stored.rows).toEqual([
      { status: "delivered", readByRow: "row-1" },
      { status: "delivered", readByRow: "row-1" },
      { status: "delivered", readByRow: "row-1" },
    ]);
    expect(await mailbox.claimForAgent(finanzas, "row-2", NOW)).toEqual([]);
  });

  it("🔴 two turns at the same moment take a message once", async () => {
    await put({ at: ago(HOUR) });
    await put({ at: ago(2 * HOUR) });
    const [a, b] = await Promise.all([mailbox.claimForAgent(finanzas, "row-a", NOW), mailbox.claimForAgent(finanzas, "row-b", NOW)]);
    expect(a.length + b.length).toBe(2);
    expect([a.length, b.length].sort()).toEqual([0, 2]);
  });

  it("an agent takes what is for it, from all its projects, and nothing for Len or for another agent", async () => {
    const here = await put({ at: ago(3 * HOUR), projectId: "budget" });
    const there = await put({ at: ago(2 * HOUR), projectId: "other" });
    await put({ at: ago(HOUR), direction: "to_len" });
    await put({ at: ago(HOUR), assistantId: lucia });
    expect((await mailbox.claimForAgent(finanzas, "row-1", NOW)).map((m) => m.id)).toEqual([here, there]);
  });

  it("Len takes what is for the project it works in, from any agent, and nothing for an agent or for another project", async () => {
    const fromFinanzas = await put({ at: ago(3 * HOUR), direction: "to_len" });
    const fromLucia = await put({ at: ago(2 * HOUR), direction: "to_len", assistantId: lucia });
    await put({ at: ago(HOUR), direction: "to_agent" });
    await put({ at: ago(HOUR), direction: "to_len", projectId: "other" });
    const taken = await mailbox.claimForLen("budget", "len-row", NOW);
    expect(taken.map((m) => m.id)).toEqual([fromFinanzas, fromLucia]);
    expect(taken[0]).toMatchObject({ direction: "to_len", assistantId: finanzas, projectId: "budget", status: "delivered" });
    expect(await mailbox.claimForLen("budget", "len-row-2", NOW)).toEqual([]);
  });

  it("what waited longer than 7 days, or already expired, is not taken", async () => {
    await put({ at: ago(HELD_DAYS * DAY + HOUR), status: "held" });
    await put({ at: ago(HELD_DAYS * DAY + HOUR) });
    await put({ at: ago(HOUR), status: "expired" });
    const inTime = await put({ at: ago(HELD_DAYS * DAY - HOUR), status: "held" });
    expect((await mailbox.claimForAgent(finanzas, "row-1", NOW)).map((m) => m.id)).toEqual([inTime]);
  });

  it("a claimed message whose turn didn't run goes back to held, and the next turn takes it again", async () => {
    const id = await put({ at: ago(HOUR) });
    const [taken] = await mailbox.claimForAgent(finanzas, "row-1", NOW);
    expect(taken!.id).toBe(id);
    await mailbox.releaseToHeld([id], "no_credits");
    const r = (await pg.query<{ status: string; heldReason: string; deliveredAt: Date | null; readByRow: string | null }>(`select "status", "heldReason", "deliveredAt", "readByRow" from "agentLenMessages" where "id" = $1`, [id])).rows[0]!;
    expect(r).toEqual({ status: "held", heldReason: "no_credits", deliveredAt: null, readByRow: null });
    expect((await mailbox.claimForAgent(finanzas, "row-2", NOW)).map((m) => m.id)).toEqual([id]);
  });

  it("releasing puts back only what was claimed: a pending or expired one stays as it is", async () => {
    const pending = await put({ at: ago(HOUR) });
    const expired = await put({ at: ago(HOUR), status: "expired" });
    await mailbox.releaseToHeld([pending, expired], "no_credits");
    expect(await statusOf(pending)).toBe("pending");
    expect(await statusOf(expired)).toBe("expired");
    await expect(mailbox.releaseToHeld([], "no_credits")).resolves.toBeUndefined();
  });
});

describe("when the server starts", () => {
  it("🔴 delivering under 24 h comes back; older ones, and held or pending over 7 days, expire", async () => {
    const young = await put({ at: ago(2 * HOUR), status: "delivering", deliveringAt: ago(HOUR) });
    const younger = await put({ at: ago(3 * HOUR), status: "delivering", deliveringAt: ago(RESUME_HOURS * HOUR - HOUR) });
    const stale = await put({ at: ago(2 * DAY), status: "delivering", deliveringAt: ago(RESUME_HOURS * HOUR + HOUR) });
    const oldHeld = await put({ at: ago(HELD_DAYS * DAY + HOUR), status: "held" });
    const oldPending = await put({ at: ago(HELD_DAYS * DAY + HOUR) });
    const freshHeld = await put({ at: ago(DAY), status: "held" });
    const freshPending = await put({ at: ago(HOUR) });
    const delivered = await put({ at: ago(HELD_DAYS * DAY + HOUR), status: "delivered" });

    const resumed = await mailbox.toResume(NOW);
    expect(resumed.map((m) => m.id).sort()).toEqual([young, younger].sort());
    expect(resumed.every((m) => m.status === "delivering")).toBe(true);

    expect(await statusOf(young)).toBe("delivering");
    expect(await statusOf(younger)).toBe("delivering");
    expect(await statusOf(stale)).toBe("expired");
    expect(await statusOf(oldHeld)).toBe("expired");
    expect(await statusOf(oldPending)).toBe("expired");
    // Held ones never wake anything by themselves: they wait for the next turn of whoever they are for.
    expect(await statusOf(freshHeld)).toBe("held");
    expect(await statusOf(freshPending)).toBe("pending");
    expect(await statusOf(delivered)).toBe("delivered");
  });

  it("with nothing waiting it resumes nothing, and a second pass finds the same", async () => {
    expect(await mailbox.toResume(NOW)).toEqual([]);
    const young = await put({ at: ago(HOUR), status: "delivering", deliveringAt: ago(HOUR) });
    expect((await mailbox.toResume(NOW)).map((m) => m.id)).toEqual([young]);
    expect((await mailbox.toResume(NOW)).map((m) => m.id)).toEqual([young]);
  });
});

describe("what the mailbox belongs to", () => {
  it("🔴 deleting the agent deletes its messages, and no one else's", async () => {
    await put({ at: ago(HOUR) });
    const kept = await put({ at: ago(HOUR), assistantId: lucia });
    await pg.query(`delete from "assistants" where "id" = $1`, [finanzas]);
    expect((await pg.query<{ id: string }>(`select "id" from "agentLenMessages"`)).rows.map((r) => r.id)).toEqual([kept]);
  });

  it("🔴 deleting the project deletes the messages about it, and no other project's", async () => {
    await put({ at: ago(HOUR), projectId: "budget" });
    const kept = await put({ at: ago(HOUR), projectId: "other" });
    await pg.query(`delete from "projects" where "id" = 'budget'`);
    expect((await pg.query<{ id: string }>(`select "id" from "agentLenMessages"`)).rows.map((r) => r.id)).toEqual([kept]);
  });
});
