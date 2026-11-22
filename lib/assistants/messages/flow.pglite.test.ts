// @vitest-environment node
//
// A WHOLE CONVERSATION BETWEEN LEN AND AN AGENT (spec local 2026-11-21-len-y-el-agente-conversan, the plan's task 8).
// Every piece has its own test; this one drives them together, the way a turn would: `runSendMessage` (the tool of each
// side) over the REAL mailbox, handing each message to the REAL `wakeRecipient`, whose launchers only record the turn
// they would queue. What the queue does with a turn is done here by hand: run its `resolveAtStart` (the claim, in SQL)
// and write the chat row the route writes for it — a row Len's server wrote carries an `origen`, and is never the person.
// Against real Postgres (PGlite), with the tables as `npm run assistants:migrate` creates them over minimal users,
// projects and chat rows.
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentSession } from "@/lib/agent/tools";
import * as schema from "@/lib/db/schema";

import { framingForAgent, MESSAGE_CAP, rideAlongForLen } from "./policy";
import type { MessageStore, Waker } from "./tool";
import type { WakeDeps } from "./wake";

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
const { createAssistant, assistantById } = await import("../store");
const { titlesOf } = await import("../projects");
const mailbox = await import("./store");
const { runSendMessage } = await import("./tool");
const { wakeRecipient, resumeAgentLenMessages } = await import("./wake");
const { claimRideAlongForAgent, claimRideAlongForLen } = await import("./ride-along");

const FINANZAS = { name: "Finanzas", look: { v: 1, shape: "drop", color: "#19c3b1", eyes: "oval", eyewear: "none", accessory: "none" }, tone: "friendly" } as const;

// A clock the test owns: each message and each chat row happens one minute after the last, so the order the cap counts in
// never depends on how fast the database answers.
const BASE = Date.UTC(2026, 10, 21, 9, 0, 0);
const MINUTE = 60_000;
let minutes = 0;
const tick = () => new Date(BASE + ++minutes * MINUTE);
/** The moment a turn that is starting reads at: after everything written so far. */
const clockNow = () => new Date(BASE + minutes * MINUTE + MINUTE / 2);

type LenLaunch = { turn: Parameters<WakeDeps["launchForLen"]>[0]; options: Parameters<WakeDeps["launchForLen"]>[1] };
type AgentLaunch = Parameters<WakeDeps["launchForAgent"]>[0];

let pg: PGlite;
let finanzas: string;
let lenLaunches: LenLaunch[];
let agentLaunches: AgentLaunch[];
let turnSeq: number;

const agentChat = () => `assistant:${finanzas}`;

/** The mailbox as `runSendMessage` uses it: the real one, except that a message is dated by the test's clock. */
function realStore(): MessageStore {
  return {
    addMessage: async (m) => {
      const row = await mailbox.addMessage(m);
      const at = tick();
      await pg.query(`update "agentLenMessages" set "createdAt" = $1 where "id" = $2`, [at, row.id]);
      return { ...row, createdAt: at };
    },
    lastPersonMessageAt: mailbox.lastPersonMessageAt,
    messagesSince: mailbox.messagesSince,
    hold: mailbox.hold,
  };
}

/** What waking needs, all of it real but the two launchers (which record the turn) and the person's zone. */
function wakeDeps(): WakeDeps {
  return {
    store: mailbox,
    agentOf: async (id) => {
      const a = await assistantById(id);
      return a ? { id: a.id, personId: a.personId, name: a.name, homeProjectId: a.homeProjectId, locale: a.summaryLocale } : null;
    },
    titlesOf,
    zoneOf: async () => "Europe/Madrid",
    launchForLen: (turn, options) => void lenLaunches.push({ turn, options }),
    launchForAgent: (turn) => void agentLaunches.push(turn),
    now: clockNow,
    newRowId: () => `turn-${++turnSeq}`,
    enabled: () => true,
  };
}

const wake: Waker = (m, ctx) => wakeRecipient(m, ctx, wakeDeps());
const send = (session: AgentSession, args: Record<string, unknown>) => runSendMessage(session, args, { store: realStore(), wake });

/** Len's turn in the budget project: the agents related to it are listed in his context. */
const lenSession = () =>
  ({ projectId: "budget", userId: "u1", relatedAgents: [{ id: finanzas, name: "Finanzas", homeProjectId: "home" }] }) as unknown as AgentSession;

/** The agent's turn, in its home. `woken`: Len's message started it, so what the route reads as the person's message is HIS
 *  text; otherwise it is `said`, what its person wrote. */
function agentSession(o: { woken: true; lenSaid: string } | { woken?: false; said: string }): AgentSession {
  return {
    projectId: "home",
    userId: "u1",
    mensajeDelUsuario: "lenSaid" in o ? o.lenSaid : o.said,
    assistant: { id: finanzas, name: "Finanzas", projects: [{ id: "budget", title: "Presupuesto" }], ...("lenSaid" in o ? { woken: true } : {}) },
  } as unknown as AgentSession;
}

const lenWrites = (message: string) => send(lenSession(), { to: "Finanzas", message });
const agentWrites = (message: string, session: AgentSession) => send(session, { project: "budget", message });

async function chatRow(o: { id: string; projectId: string; conversation: string | null; origen: object | null; at: Date }) {
  await pg.query(`insert into "projectChatMessages" ("id", "projectId", "conversation", "origen", "createdAt") values ($1, $2, $3, $4::jsonb, $5)`, [
    o.id,
    o.projectId,
    o.conversation,
    o.origen ? JSON.stringify(o.origen) : null,
    o.at,
  ]);
}

/** The person writes: a row with no `origen`, in the project's chat (to Len) or in the agent's conversation at its home. */
const personWrites = (id: string, where: "len" | "agent") =>
  chatRow({ id, projectId: where === "len" ? "budget" : "home", conversation: where === "len" ? null : agentChat(), origen: null, at: tick() });

/** What the queue does with the agent's turn the last message launched: it starts, claims what waits for it, and the route
 *  writes the turn's own row (the one the claim marks the messages read by). */
async function agentTurnStarts(launch: AgentLaunch) {
  const resolved = await launch.resolveAtStart!();
  if (resolved) await chatRow({ id: launch.filaId, projectId: launch.projectId, conversation: `assistant:${String(launch.extraBody?.assistantId)}`, origen: resolved.origin, at: tick() });
  return resolved;
}

/** The same for Len's turn, in the project's chat. */
async function lenTurnStarts(launch: LenLaunch["turn"]) {
  const resolved = await launch.resolveAtStart!();
  if (resolved) await chatRow({ id: launch.filaId, projectId: launch.projectId, conversation: null, origen: resolved.origin, at: tick() });
  return resolved;
}

type Row = { direction: string; text: string; ownerWords: string | null; status: string; heldReason: string | null; readByRow: string | null };
const mailboxRows = async () =>
  (await pg.query<Row>(`select "direction", "text", "ownerWords", "status", "heldReason", "readByRow" from "agentLenMessages" order by "createdAt", "id"`)).rows;

beforeEach(async () => {
  minutes = 0;
  turnSeq = 0;
  lenLaunches = [];
  agentLaunches = [];
  pg = new PGlite();
  await pg.query(`create table "users" ("id" text primary key)`);
  await pg.query(`create table "projects" ("id" text primary key, "userId" text, "title" text)`);
  await pg.query(
    `create table "projectChatMessages" ("id" text primary key, "projectId" text not null references "projects"("id") on delete cascade, "conversation" text, "origen" jsonb, "createdAt" timestamp not null default now())`,
  );
  await pg.query(`insert into "users" values ('u1')`);
  await pg.query(`insert into "projects" values ('home', 'u1', 'Espacio de Finanzas'), ('budget', 'u1', 'Presupuesto')`);
  for (const statement of CREATE_ASSISTANTS) await pg.query(statement);
  base.db = drizzle(pg, { schema });
  const f = await createAssistant({ personId: "u1", projectId: "home", input: FINANZAS });
  if (!f.ok) throw new Error("setup");
  finanzas = f.assistant.id;
});

describe("a whole conversation between Len and an agent", () => {
  it("🔴 Len asks, the agent answers, Len finishes; a fifth exchange waits for the person", async () => {
    // The owner asked Len for the budget page: the person's last word in the project's chat.
    await personWrites("owner-asks-len", "len");

    // 1. Len asks the agent. The message is written, and it wakes the agent in its home, as itself.
    const one = await lenWrites("¿De qué color va la factura?");
    expect(one.response).toEqual({ ok: true, status: "waking", tool_result: "Sent to Finanzas; it reads it with its next turn, which starts now if it can." });
    expect(lenLaunches).toHaveLength(0);
    expect(agentLaunches).toHaveLength(1);
    expect(agentLaunches[0]).toMatchObject({
      userId: "u1",
      projectId: "home",
      texto: "¿De qué color va la factura?",
      filaId: "turn-1",
      extraBody: { assistantId: finanzas },
      origin: { kind: "len-message", projectId: "budget", projectTitle: "Presupuesto" },
    });
    expect((await mailboxRows()).map((r) => r.status)).toEqual(["delivering"]);
    // The turn starts and claims it: framed with the project and how to answer, read by the turn's own chat row.
    const agentReads = await agentTurnStarts(agentLaunches[0]!);
    expect(agentReads?.framing).toBe(framingForAgent({ projectTitle: "Presupuesto", projectId: "budget", messages: [{ text: "¿De qué color va la factura?" }] }));
    expect(agentReads?.framing).toContain("Presupuesto");
    expect(agentReads?.framing).toContain("message_len (project: budget)");
    expect(await mailboxRows()).toEqual([
      { direction: "to_agent", text: "¿De qué color va la factura?", ownerWords: null, status: "delivered", heldReason: null, readByRow: "turn-1" },
    ]);

    // 2. The agent answers Len. Its turn was woken, so its owner's words are not carried: the message that started it was Len's.
    const two = await agentWrites("Azul, #1E40AF.", agentSession({ woken: true, lenSaid: "¿De qué color va la factura?" }));
    expect(two.response).toEqual({ ok: true, status: "waking", tool_result: "Sent to Len; it reads it with its next turn, which starts now if it can." });
    expect(agentLaunches).toHaveLength(1);
    expect(lenLaunches).toHaveLength(1);
    expect(lenLaunches[0]!.turn).toMatchObject({
      userId: "u1",
      projectId: "budget",
      texto: "Azul, #1E40AF.",
      filaId: "turn-2",
      origin: { kind: "assistant", assistantId: finanzas, assistantName: "Finanzas", message: true },
    });
    // Len read it and wrote nothing: that is a turn that ran, not one that didn't.
    expect(lenLaunches[0]!.options).toEqual({ quietWhenNoReply: true });
    const lenReads = await lenTurnStarts(lenLaunches[0]!.turn);
    expect(lenReads?.framing).toBe(rideAlongForLen([{ agentName: "Finanzas", messages: [{ text: "Azul, #1E40AF.", ownerWords: null }] }]));
    expect(lenReads?.framing).not.toContain("own words");
    expect(lenReads?.origin).toEqual({ kind: "assistant", assistantId: finanzas, assistantName: "Finanzas", message: true });
    expect((await mailboxRows())[1]).toEqual({ direction: "to_len", text: "Azul, #1E40AF.", ownerWords: null, status: "delivered", heldReason: null, readByRow: "turn-2" });

    // 3. Back and forth until the cap: four messages pass and wake...
    const three = await lenWrites("¿Y el total lleva IVA?");
    expect(three.response).toMatchObject({ ok: true, status: "waking" });
    expect(agentLaunches).toHaveLength(2);
    await agentTurnStarts(agentLaunches[1]!);
    const four = await agentWrites("Sí, con el 21 % incluido.", agentSession({ woken: true, lenSaid: "¿Y el total lleva IVA?" }));
    expect(four.response).toMatchObject({ ok: true, status: "waking" });
    expect(lenLaunches).toHaveLength(2);
    await lenTurnStarts(lenLaunches[1]!.turn);
    expect((await mailboxRows()).map((r) => r.status)).toEqual(["delivered", "delivered", "delivered", "delivered"]);

    // ...and the fifth is written and kept: it wakes nobody.
    const five = await lenWrites("¿Podéis confirmar el total con el cliente?");
    expect(five.response).toMatchObject({ ok: true, status: "held", reason: "cap" });
    expect((five.response as { tool_result: string }).tool_result).toContain(`${MESSAGE_CAP} times without the person`);
    expect(agentLaunches).toHaveLength(2);
    expect(lenLaunches).toHaveLength(2);
    const rows = await mailboxRows();
    expect(rows.map((r) => [r.direction, r.status, r.heldReason, r.readByRow])).toEqual([
      ["to_agent", "delivered", null, "turn-1"],
      ["to_len", "delivered", null, "turn-2"],
      ["to_agent", "delivered", null, "turn-3"],
      ["to_len", "delivered", null, "turn-4"],
      ["to_agent", "held", "cap", null],
    ]);
    // The rows the woken turns wrote carry an origen: none of them is the person, so none reset the count.
    const since = await mailbox.lastPersonMessageAt(finanzas, "budget", "home");
    expect(since?.toISOString()).toBe(new Date(BASE + MINUTE).toISOString());
    expect(await mailbox.messagesSince(finanzas, "budget", since)).toBe(5);

    // 4. The person writes to the agent: the agent's turn for them claims what was held for it, once.
    await personWrites("person-turn", "agent");
    const ridden = await claimRideAlongForAgent(finanzas, "person-turn", clockNow());
    expect(ridden).toEqual({
      ids: [expect.any(String)],
      framing: framingForAgent({ projectTitle: "Presupuesto", projectId: "budget", messages: [{ text: "¿Podéis confirmar el total con el cliente?" }] }),
    });
    expect(await claimRideAlongForAgent(finanzas, "person-turn-2", clockNow())).toBeNull();
    expect((await mailboxRows())[4]).toMatchObject({ direction: "to_agent", status: "delivered", heldReason: "cap", readByRow: "person-turn" });

    // 5. And the count started again: the next message wakes, and reads only itself.
    const afterPerson = await mailbox.lastPersonMessageAt(finanzas, "budget", "home");
    expect(await mailbox.messagesSince(finanzas, "budget", afterPerson)).toBe(0);
    const six = await lenWrites("Gracias por avisar: la factura sale hoy, ¿la envío ya?");
    expect(six.response).toMatchObject({ ok: true, status: "waking" });
    expect(agentLaunches).toHaveLength(3);
    const sixth = await agentTurnStarts(agentLaunches[2]!);
    expect(sixth?.framing).toBe(framingForAgent({ projectTitle: "Presupuesto", projectId: "budget", messages: [{ text: "Gracias por avisar: la factura sale hoy, ¿la envío ya?" }] }));
    expect(sixth?.framing).not.toContain("confirmar el total");
    expect(await mailbox.messagesSince(finanzas, "budget", afterPerson)).toBe(1);
  });

  it("🔴 a held message and the next one are read together by the turn the next one wakes, oldest first", async () => {
    await personWrites("owner-asks-len", "len");
    await lenWrites("uno");
    await agentTurnStarts(agentLaunches[0]!);
    await agentWrites("dos", agentSession({ woken: true, lenSaid: "uno" }));
    await lenTurnStarts(lenLaunches[0]!.turn);
    await lenWrites("tres");
    await agentTurnStarts(agentLaunches[1]!);
    await agentWrites("cuatro", agentSession({ woken: true, lenSaid: "tres" }));
    await lenTurnStarts(lenLaunches[1]!.turn);
    expect((await lenWrites("cinco")).response).toMatchObject({ status: "held", reason: "cap" });

    // The owner writes to LEN this time, in the project's chat: the count starts again, and nobody read the held one.
    await personWrites("owner-again", "len");
    expect((await lenWrites("seis")).response).toMatchObject({ ok: true, status: "waking" });
    expect(agentLaunches).toHaveLength(3);
    const resolved = await agentTurnStarts(agentLaunches[2]!);
    // One turn reads both, in the order they were written, under one framing with its count.
    expect(resolved?.framing).toBe(
      framingForAgent({ projectTitle: "Presupuesto", projectId: "budget", messages: [{ text: "cinco" }, { text: "seis" }] }),
    );
    expect(resolved?.framing).toContain("sent you 2 messages");
    // Both were read by the turn «seis» woke (the fifth, held, woke none): the fifth waking turn of the conversation.
    expect(agentLaunches[2]!.filaId).toBe("turn-5");
    expect((await mailboxRows()).slice(4).map((r) => [r.text, r.status, r.readByRow])).toEqual([
      ["cinco", "delivered", "turn-5"],
      ["seis", "delivered", "turn-5"],
    ]);
  });

  it("🔴 the other way round: the owner's words travel with the agent's first message, and what the agent's fifth left waiting rides with the owner's next turn on Len", async () => {
    // The owner talks to the agent: its message to Len carries what the owner said, verbatim.
    const said = "Dile a Len que la factura va en azul";
    await personWrites("owner-tells-agent", "agent");
    const one = await agentWrites("La factura va en azul.", agentSession({ said }));
    expect(one.response).toMatchObject({ ok: true, status: "waking" });
    expect((await mailboxRows())[0]).toMatchObject({ direction: "to_len", ownerWords: said });
    const lenReads = await lenTurnStarts(lenLaunches[0]!.turn);
    expect(lenReads?.framing).toBe(rideAlongForLen([{ agentName: "Finanzas", messages: [{ text: "La factura va en azul.", ownerWords: said }] }]));
    expect(lenReads?.framing).toContain(`Your owner's own words that Finanzas passed on, verbatim`);
    expect(lenReads?.framing).toContain(said);

    // Len answers; the agent's woken turn answers back with no owner words (Len's text is what started it); and so on.
    expect((await lenWrites("¿Qué azul?")).response).toMatchObject({ status: "waking" });
    await agentTurnStarts(agentLaunches[0]!);
    expect((await agentWrites("#1E40AF", agentSession({ woken: true, lenSaid: "¿Qué azul?" }))).response).toMatchObject({ status: "waking" });
    expect((await mailboxRows())[2]).toMatchObject({ direction: "to_len", text: "#1E40AF", ownerWords: null });
    await lenTurnStarts(lenLaunches[1]!.turn);
    expect((await lenWrites("¿Y el botón?")).response).toMatchObject({ status: "waking" });
    await agentTurnStarts(agentLaunches[1]!);

    // The fifth message of the pair is the agent's: kept, waking nobody.
    const fifth = await agentWrites("También en azul.", agentSession({ woken: true, lenSaid: "¿Y el botón?" }));
    expect(fifth.response).toMatchObject({ ok: true, status: "held", reason: "cap" });
    expect((fifth.response as { tool_result: string }).tool_result).toContain(`${MESSAGE_CAP} times without your owner`);
    expect(lenLaunches).toHaveLength(2);
    expect((await mailboxRows()).map((r) => [r.direction, r.status])).toEqual([
      ["to_len", "delivered"],
      ["to_agent", "delivered"],
      ["to_len", "delivered"],
      ["to_agent", "delivered"],
      ["to_len", "held"],
    ]);

    // The owner's next turn on Len claims it — once — read under the agent's name.
    await personWrites("owner-next", "len");
    const ridden = await claimRideAlongForLen("budget", "owner-next", clockNow(), new Map([[finanzas, "Finanzas"]]));
    expect(ridden?.framing).toBe(rideAlongForLen([{ agentName: "Finanzas", messages: [{ text: "También en azul.", ownerWords: null }] }]));
    expect(await claimRideAlongForLen("budget", "owner-next-2", clockNow(), new Map([[finanzas, "Finanzas"]]))).toBeNull();
    expect((await mailboxRows())[4]).toMatchObject({ direction: "to_len", status: "delivered", heldReason: "cap", readByRow: "owner-next" });
  });
});

describe("what happens to the turns a message wakes", () => {
  it("🔴 two messages written before the turn begins are read by one turn; the second wake finds nothing and does not run", async () => {
    await personWrites("owner-asks-len", "len");
    await lenWrites("uno");
    await lenWrites("dos");
    // Each message woke a turn, but the agent had not started either: both are on their way.
    expect(agentLaunches).toHaveLength(2);
    expect((await mailboxRows()).map((r) => r.status)).toEqual(["delivering", "delivering"]);

    const first = await agentTurnStarts(agentLaunches[0]!);
    expect(first?.framing).toBe(framingForAgent({ projectTitle: "Presupuesto", projectId: "budget", messages: [{ text: "uno" }, { text: "dos" }] }));
    expect(await agentTurnStarts(agentLaunches[1]!)).toBeNull();
    expect((await mailboxRows()).map((r) => [r.status, r.readByRow])).toEqual([
      ["delivered", "turn-1"],
      ["delivered", "turn-1"],
    ]);
  });

  it("🔴 a turn that can't run gives its messages back, and the person's next turn reads them; one cut after reading them keeps them read", async () => {
    await personWrites("owner-asks-len", "len");
    // A deploy cut the turn after it read «uno»: it was read.
    await lenWrites("uno");
    await agentLaunches[0]!.resolveAtStart!();
    await agentLaunches[0]!.fail(null, true);
    // No credits after it claimed «dos»: it goes back to waiting.
    await lenWrites("dos");
    await agentLaunches[1]!.resolveAtStart!();
    await agentLaunches[1]!.fail(null, false);
    // No credits before it claimed anything: «tres» is kept as it is.
    await lenWrites("tres");
    await agentLaunches[2]!.fail(null, false);
    expect((await mailboxRows()).map((r) => [r.text, r.status, r.heldReason, r.readByRow])).toEqual([
      ["uno", "delivered", null, "turn-1"],
      ["dos", "held", "no_credits", null],
      ["tres", "held", "no_credits", null],
    ]);

    // Nobody woke for them; the agent's next turn for its person reads both, oldest first, once.
    expect(agentLaunches).toHaveLength(3);
    await personWrites("person-turn", "agent");
    const ridden = await claimRideAlongForAgent(finanzas, "person-turn", clockNow());
    expect(ridden?.framing).toBe(framingForAgent({ projectTitle: "Presupuesto", projectId: "budget", messages: [{ text: "dos" }, { text: "tres" }] }));
    expect(await claimRideAlongForAgent(finanzas, "person-turn-2", clockNow())).toBeNull();
  });

  it("🔴 a restart between the wake and the turn: what was on its way wakes each recipient once, and its turn reads it", async () => {
    await personWrites("owner-asks-len", "len");
    await lenWrites("uno");
    await lenWrites("dos");
    const said = "Dile a Len el dato";
    await agentWrites("El dato.", agentSession({ said }));
    // The server stops before any of the three turns begins: its queue is gone.
    expect(agentLaunches).toHaveLength(2);
    expect(lenLaunches).toHaveLength(1);
    agentLaunches.length = 0;
    lenLaunches.length = 0;

    expect(await resumeAgentLenMessages(clockNow(), wakeDeps())).toBe(2);
    expect(agentLaunches).toHaveLength(1);
    expect(lenLaunches).toHaveLength(1);
    const agent = await agentTurnStarts(agentLaunches[0]!);
    expect(agent?.framing).toBe(framingForAgent({ projectTitle: "Presupuesto", projectId: "budget", messages: [{ text: "uno" }, { text: "dos" }] }));
    const len = await lenTurnStarts(lenLaunches[0]!.turn);
    expect(len?.framing).toBe(rideAlongForLen([{ agentName: "Finanzas", messages: [{ text: "El dato.", ownerWords: said }] }]));
    expect((await mailboxRows()).map((r) => r.status)).toEqual(["delivered", "delivered", "delivered"]);
    // Nothing was left on its way: a second restart wakes nobody.
    expect(await resumeAgentLenMessages(clockNow(), wakeDeps())).toBe(0);
  });
});
