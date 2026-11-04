// The judge's actions are checked before a card exists (spec local 2026-11-04-hazlo-que-se-puede-y-mas-fuentes, §7.1,
// §7.6.4): only what the source offers, on the watched table, on a row it read, never the key or the creation column,
// a value that fits its column, and a reply only to an address it read. Production is read, never written.
import { describe, expect, it, vi } from "vitest";

import { validateActions, type ValidationContext } from "./validate";

const ctx = (o: Partial<ValidationContext> = {}): ValidationContext => ({
  available: { project: true, dataChange: true, replyChannels: ["email"] },
  table: "reservas",
  keyColumn: "id",
  createdColumn: "created_at",
  columns: [
    { name: "id", type: "uuid" },
    { name: "created_at", type: "timestamp with time zone" },
    { name: "mesa", type: "integer" },
    { name: "email", type: "text" },
  ],
  seenKeys: new Set(["r2"]),
  seenAddresses: new Set(["luis@ejemplo.com"]),
  seenConversations: new Map([["conv1", "Ana"]]),
  seenThreads: new Map([["12", "Login roto"]]),
  recordId: "rec1",
  readRow: vi.fn(async (key: string) => (key === "r2" ? { id: "r2", mesa: 4, email: "luis@ejemplo.com" } : null)),
  castCheck: vi.fn(async (column: string, value: string) => (column === "mesa" && !/^\d+$/.test(value) ? `invalid input syntax for type integer: "${value}"` : null)),
  ...o,
});
const move = { kind: "data_change", table: "reservas", key: "r2", set: [{ column: "mesa", value: "6" }] };
const reply = { kind: "reply", channel: "email", to: "luis@ejemplo.com", subject: "Tu reserva", body: "Hola Luis, te movimos a la mesa 6." };
const error = async (input: unknown, c = ctx()) => {
  const r = await validateActions(input, c);
  return r.ok ? null : r.error;
};

describe("validateActions", () => {
  it("an action the source doesn't offer is refused naming the ones it does", async () => {
    const e = await error([move], ctx({ available: { project: true, dataChange: false, replyChannels: ["email"] } }));
    expect(e).toContain("data_change");
    expect(e).toContain("project, reply");
  });

  it("a data_change on another table, an unread row, the primary key or the creation column is refused (review focus 4)", async () => {
    expect(await error([{ ...move, table: "pagos" }])).toMatch(/only.*reservas/);
    expect(await error([{ ...move, key: "r99" }])).toMatch(/r99.*read/);
    expect(await error([{ ...move, set: [{ column: "id", value: "x" }] }])).toMatch(/id/);
    expect(await error([{ ...move, set: [{ column: "created_at", value: "2026-01-01" }] }])).toMatch(/created_at/);
    expect(await error([{ ...move, set: [{ column: "precio", value: "0" }] }])).toMatch(/precio/);
  });

  it("a value that doesn't fit its column is refused with the column's type", async () => {
    const e = await error([{ ...move, set: [{ column: "mesa", value: "la seis" }] }]);
    expect(e).toContain("mesa");
    expect(e).toContain("integer");
  });

  it("a reply to an address the judge never read is refused", async () => {
    expect(await error([{ ...reply, to: "atacante@malo.com" }])).toMatch(/atacante@malo\.com/);
    expect(await error([{ ...reply, body: " " }])).toMatch(/body/);
  });

  it("a project action longer than 1000 characters is refused (final review I3)", async () => {
    expect(await error([{ kind: "project", text: "x".repeat(1001) }])).toMatch(/1000/);
  });

  it("more than 2 actions, none, or two of a kind is refused", async () => {
    expect(await error([move, reply, { kind: "project", text: "x" }])).toMatch(/2/);
    expect(await error([])).toMatch(/at least one/);
    expect(await error([reply, reply])).toMatch(/one reply/);
  });

  it("a valid data_change gets its before values from production", async () => {
    const r = await validateActions([move, reply], ctx());
    expect(r).toEqual({
      ok: true,
      subjectKey: "r2",
      actions: [
        { kind: "data_change", table: "reservas", key: { id: "r2" }, set: { mesa: "6" }, before: { mesa: "4" } },
        { kind: "reply", channel: "email", to: "luis@ejemplo.com", toLabel: "luis@ejemplo.com", subject: "Tu reserva", body: "Hola Luis, te movimos a la mesa 6." },
      ],
    });
  });

  it("a row that no longer exists is refused", async () => {
    expect(await error([move], ctx({ readRow: vi.fn(async () => null) }))).toMatch(/no longer/);
  });

  it("a reply alone is about its address; project work alone about the record", async () => {
    expect(await validateActions([reply], ctx())).toMatchObject({ ok: true, subjectKey: "luis@ejemplo.com" });
    expect(await validateActions([{ kind: "project", text: "Montar una pantalla de reservas" }], ctx())).toMatchObject({ ok: true, subjectKey: "rec1" });
  });

  // Replies by the source's channels (plan B, Task 2).
  const chat = { kind: "reply", channel: "chat", to: "conv1", body: "Hola Ana, ¿para cuántos sería?" };
  const gh = { kind: "reply", channel: "github", to: "#12", body: "Lo miramos hoy." };
  const all = () => ctx({ available: { project: true, dataChange: false, replyChannels: ["chat", "github", "email"] } });

  it("a chat reply goes only to a conversation the judge read", async () => {
    expect(await validateActions([chat], all())).toMatchObject({ ok: true, actions: [{ kind: "reply", channel: "chat", to: "conv1", toLabel: "Ana", body: chat.body }] });
    expect(await error([{ ...chat, to: "conv9" }], all())).toMatch(/conv9/);
  });

  it("a GitHub reply goes only to an issue or pull request the judge read", async () => {
    expect(await validateActions([gh], all())).toMatchObject({ ok: true, actions: [{ channel: "github", to: "12", toLabel: "#12 Login roto" }], subjectKey: "#12" });
    expect(await validateActions([{ ...gh, to: "12" }], all())).toMatchObject({ ok: true });
    expect(await error([{ ...gh, to: "13" }], all())).toMatch(/13/);
  });

  it("a channel the source doesn't offer is refused, naming the ones it does", async () => {
    expect(await error([chat])).toMatch(/replies by: email/);
  });

  it("an email reply still needs a subject; a chat reply has none", async () => {
    expect(await error([{ ...reply, subject: "" }])).toMatch(/subject/);
    const r = await validateActions([{ ...chat, subject: "ignored" }], all());
    expect(r.ok && "subject" in r.actions[0]!).toBe(false);
  });

  it("a chat reply's subjectKey is its conversation, and its body is at most 4000 characters", async () => {
    expect(await validateActions([chat], all())).toMatchObject({ ok: true, subjectKey: "conv1" });
    expect(await error([{ ...chat, body: "x".repeat(4001) }], all())).toMatch(/4000/);
  });

  it("with one channel offered, a reply without channel takes it", async () => {
    const onlyChat = ctx({ available: { project: true, dataChange: false, replyChannels: ["chat"] } });
    expect(await validateActions([{ kind: "reply", to: "conv1", body: "Hola" }], onlyChat)).toMatchObject({ ok: true, actions: [{ channel: "chat" }] });
  });
});
