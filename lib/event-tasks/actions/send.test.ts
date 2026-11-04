// The owner's reply to a person (spec local 2026-11-04-hazlo-que-se-puede-y-mas-fuentes, §7.3, §7.6.3, §7.6.6): stored
// work, as DeepSeek's channels send — recorded before the attempt, sent with the card's idempotency key, retried with
// a backoff of 5 s doubling to 300 s while the failure is a passing one, never sent twice.
import { describe, expect, it, vi } from "vitest";

import type { SendInput, SendOutcome } from "@/lib/project-email/send";

import type { EventTaskCardRow } from "../store";
import { retryPendingSends, sendReply, withdrawSend, type SendReplyDeps } from "./send";
import { EXPIRED, freshRecord, type CardActionRecord } from "./types";

vi.mock("server-only", () => ({}));

const NOW = new Date("2026-11-04T10:00:00Z");
const reply = { kind: "reply" as const, channel: "email" as const, to: "luis@ejemplo.com", subject: "Tu reserva", body: "Hola Luis.\n\nTe movimos a la mesa 6." };
const card = (rec: CardActionRecord, id = "c1") => ({ id, projectId: "p1", actions: [rec] }) as unknown as EventTaskCardRow;

function world(o: { answer?: (i: SendInput) => SendOutcome } = {}) {
  const order: string[] = [];
  const records: Record<string, unknown>[] = [];
  const delivered = new Map<string, string>();
  const d: SendReplyDeps = {
    log: vi.fn(async () => {}),
    fromOf: vi.fn(async () => "noreply@notify.lamesa.mx"),
    record: vi.fn(async (_cardId: string, _index: number, patch: Record<string, unknown>) => {
      order.push(`record:${String(patch.state)}`);
      records.push(patch);
    }),
    send: vi.fn(async (i: SendInput) => {
      order.push("send");
      if (o.answer) return o.answer(i);
      // A Resend that dedupes by idempotency key: a retry with the same key is the same email.
      const id = delivered.get(i.idempotencyKey!) ?? `re_${delivered.size + 1}`;
      delivered.set(i.idempotencyKey!, id);
      return { kind: "sent" as const, id, skipped: [] };
    }),
  };
  return { d, order, records, delivered };
}

describe("sendReply", () => {
  it("records the attempt before sending, and uses the card's idempotency key", async () => {
    const w = world();
    expect(await sendReply(card(freshRecord(reply)), 0, w.d, NOW)).toEqual({ state: "done", error: null });
    expect(w.order).toEqual(["record:sending", "send", "record:done"]);
    expect(w.records[0]).toMatchObject({ state: "sending", attempts: 1 });
    expect(w.d.send).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "p1",
        environment: "live",
        kind: "reply",
        idempotencyKey: "event-card:c1:reply",
        email: expect.objectContaining({ from: "noreply@notify.lamesa.mx", to: ["luis@ejemplo.com"], subject: "Tu reserva", text: reply.body }),
      }),
    );
    expect(w.records.at(-1)).toMatchObject({ state: "done", result: "luis@ejemplo.com" });
  });

  it("a passing failure is retried with backoff 5 s, 10 s, 20 s … up to 300 s", async () => {
    const w = world({ answer: () => ({ kind: "rejected", error: { statusCode: 503, name: "internal_server_error", message: "Resend is down" } }) });
    const waits: number[] = [];
    for (const attempts of [0, 1, 2, 6]) {
      const r = await sendReply(card({ ...freshRecord(reply), state: attempts === 0 ? "pending" : "sending", attempts }), 0, w.d, NOW);
      expect(r).toEqual({ state: "sending", error: "Resend is down" });
      waits.push((Date.parse(String(w.records.at(-1)!.nextAttemptAt)) - NOW.getTime()) / 1000);
    }
    expect(waits).toEqual([5, 10, 20, 300]);
  });

  it("a refusal for the month's quota is final, so the owner isn't told again every few minutes (final review I2)", async () => {
    const w = world({ answer: () => ({ kind: "rejected", error: { statusCode: 429, name: "monthly_quota_exceeded", message: "No credits left for more." } }) });
    expect(await sendReply(card(freshRecord(reply)), 0, w.d, NOW)).toEqual({ state: "failed", error: "No credits left for more." });
    expect(w.records.at(-1)).toMatchObject({ state: "failed", nextAttemptAt: null });
  });

  it("the hourly cap is still a passing refusal", async () => {
    const w = world({ answer: () => ({ kind: "rejected", error: { statusCode: 429, name: "rate_limit_exceeded", message: "At most 50 an hour." } }) });
    expect(await sendReply(card(freshRecord(reply)), 0, w.d, NOW)).toEqual({ state: "sending", error: "At most 50 an hour." });
  });

  it("a send still retrying a day after the press stops without another attempt: Resend keeps a key for a day (final review I2)", async () => {
    const w = world();
    const late = { ...card({ ...freshRecord(reply), state: "sending", attempts: 9 }), decidedAt: new Date(NOW.getTime() - 25 * 3_600_000) } as EventTaskCardRow;
    expect(await sendReply(late, 0, w.d, NOW)).toEqual({ state: "failed", error: EXPIRED });
    expect(w.d.send).not.toHaveBeenCalled();
    expect(w.records.at(-1)).toMatchObject({ state: "failed", error: EXPIRED, nextAttemptAt: null });
  });

  it("a reply that went out is written to the task's Registros (spec §7.3)", async () => {
    const w = world();
    const c = card(freshRecord(reply));
    await sendReply(c, 0, w.d, NOW);
    expect(w.d.log).toHaveBeenCalledWith(c, "sent", "luis@ejemplo.com");
  });

  it("a final refusal is failed with Resend's message", async () => {
    const w = world({ answer: () => ({ kind: "rejected", error: { statusCode: 422, name: "validation_error", message: "Invalid `to` field." } }) });
    expect(await sendReply(card(freshRecord(reply)), 0, w.d, NOW)).toEqual({ state: "failed", error: "Invalid `to` field." });
    expect(w.records.at(-1)).toMatchObject({ state: "failed", error: "Invalid `to` field.", nextAttemptAt: null });
  });

  it("a restart after the attempt was recorded sends again with the same key, never a second email (review focus 2)", async () => {
    const w = world();
    // The attempt was recorded and the process died before its answer was.
    await sendReply(card({ ...freshRecord(reply), state: "sending", attempts: 1 }), 0, w.d, NOW);
    await sendReply(card({ ...freshRecord(reply), state: "sending", attempts: 2 }), 0, w.d, NOW);
    expect(w.d.send).toHaveBeenCalledTimes(2);
    expect(new Set((w.d.send as ReturnType<typeof vi.fn>).mock.calls.map((c) => (c[0] as SendInput).idempotencyKey))).toEqual(new Set(["event-card:c1:reply"]));
    expect(w.delivered.size).toBe(1);
  });

  it("a send already done or withdrawn is not sent again", async () => {
    const w = world();
    expect(await sendReply(card({ ...freshRecord(reply), state: "done" }), 0, w.d, NOW)).toEqual({ state: "done", error: null });
    expect(await sendReply(card({ ...freshRecord(reply), state: "failed", error: "retirado por el dueño" }), 0, w.d, NOW)).toEqual({ state: "failed", error: "retirado por el dueño" });
    expect(w.d.send).not.toHaveBeenCalled();
  });

  it("without the project's email ready it fails, and says why (review focus 3)", async () => {
    const w = world();
    (w.d.fromOf as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    expect(await sendReply(card(freshRecord(reply)), 0, w.d, NOW)).toEqual({ state: "failed", error: "The project's email isn't ready." });
    expect(w.d.send).not.toHaveBeenCalled();
  });
});

describe("retrying and withdrawing", () => {
  it("retryPendingSends sends only the sends that are due", async () => {
    const w = world();
    const due = card({ ...freshRecord(reply), state: "sending", attempts: 1, nextAttemptAt: new Date(NOW.getTime() - 1000).toISOString() }, "due");
    const later = card({ ...freshRecord(reply), state: "sending", attempts: 1, nextAttemptAt: new Date(NOW.getTime() + 60_000).toISOString() }, "later");
    await retryPendingSends(NOW, { ...w.d, sending: async () => [due, later] });
    expect((w.d.send as ReturnType<typeof vi.fn>).mock.calls.map((c) => (c[0] as SendInput).idempotencyKey)).toEqual(["event-card:due:reply"]);
  });

  it("the owner can withdraw a send that keeps failing", async () => {
    const record = vi.fn(async () => {});
    await withdrawSend("c1", 0, { record });
    expect(record).toHaveBeenCalledWith("c1", 0, { state: "failed", nextAttemptAt: null, error: "retirado por el dueño" });
  });

  // Every channel through the same stored work (plan B, Task 2).
  const chat = { kind: "reply" as const, channel: "chat" as const, to: "conv1", toLabel: "Ana", body: "Hola Ana" };

  it("a reply goes by its channel's sender", async () => {
    const w = world();
    const sender = vi.fn(async () => ({ kind: "sent" as const, result: "Ana" }));
    const d = { ...w.d, senders: { chat: sender } };
    expect(await sendReply(card(freshRecord(chat)), 0, d, NOW)).toEqual({ state: "done", error: null });
    expect(sender).toHaveBeenCalledWith(expect.objectContaining({ id: "c1" }), chat, 1, NOW);
    expect(w.d.send).not.toHaveBeenCalled();
    expect(w.records.at(-1)).toMatchObject({ state: "done", result: "Ana" });
  });

  it("a channel with no sender fails without trying", async () => {
    const w = world();
    const gh = { kind: "reply" as const, channel: "github" as const, to: "12", toLabel: "#12 Login", body: "Hola" };
    expect(await sendReply(card(freshRecord(gh)), 0, w.d, NOW)).toEqual({ state: "failed", error: "This channel can't send." });
    expect(w.order).toEqual(["record:failed"]);
  });

  it("a passing failure of any channel backs off 5 s doubling to 300 s, a final one fails", async () => {
    const w = world();
    const d = { ...w.d, senders: { chat: vi.fn(async () => ({ kind: "failed" as const, message: "busy", passing: true })) } };
    const waits: number[] = [];
    for (const attempts of [0, 1, 2, 6]) {
      expect(await sendReply(card({ ...freshRecord(chat), state: attempts === 0 ? "pending" : "sending", attempts }), 0, d, NOW)).toEqual({ state: "sending", error: "busy" });
      waits.push((Date.parse(String(w.records.at(-1)!.nextAttemptAt)) - NOW.getTime()) / 1000);
    }
    expect(waits).toEqual([5, 10, 20, 300]);
    const final = { ...w.d, senders: { chat: vi.fn(async () => ({ kind: "failed" as const, message: "gone", passing: false })) } };
    expect(await sendReply(card(freshRecord(chat)), 0, final, NOW)).toEqual({ state: "failed", error: "gone" });
  });
});

describe("the lease of an attempt (final review I1)", () => {
  it("the attempt is recorded with a lease, so a pass during it doesn't send it again", async () => {
    const w = world();
    await sendReply(card(freshRecord(reply)), 0, w.d, NOW);
    expect(w.records[0]).toMatchObject({ state: "sending", attempts: 1, nextAttemptAt: new Date(NOW.getTime() + 120_000).toISOString() });
  });
});
