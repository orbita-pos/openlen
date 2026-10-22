import { describe, expect, it, vi } from "vitest";

import type { EmailQuotaEvent } from "@/lib/notifications/types";
import type { Plan } from "@/lib/plan";

import type { ResendClients, ResendEmail } from "./resend-clients";
import { sendProjectEmail, type SendDeps, type SendInput } from "./send";
import { memoryEmailStore } from "./store";
import type { EmailDomainStatus } from "./types";

const NOW = new Date("2026-10-22T10:00:00Z");

async function world(o: { plan?: Plan; status?: EmailDomainStatus; credits?: boolean; showAsRoot?: boolean } = {}) {
  const store = memoryEmailStore(() => NOW);
  await store.putDomain({
    projectId: "p1",
    domain: "taller.mx",
    sendingHost: o.showAsRoot ? "taller.mx" : "notify.taller.mx",
    showAsRoot: o.showAsRoot ?? false,
    resendDomainId: "rd_1",
    records: [],
    status: o.status ?? "ready",
    lastCheckedAt: null,
    verifiedAt: null,
  });
  const sent: { email: ResendEmail; key?: string }[] = [];
  let n = 0;
  const resend: ResendClients = {
    createDomain: vi.fn(),
    getDomain: vi.fn(),
    verifyDomain: vi.fn(),
    deleteDomain: vi.fn(),
    send: vi.fn(async (email: ResendEmail, key?: string) => {
      sent.push({ email, ...(key ? { key } : {}) });
      return { id: `re_${++n}` };
    }),
  };
  const debits: number[] = [];
  const notices: EmailQuotaEvent[] = [];
  const d: SendDeps = {
    store,
    resend,
    ownerOf: async () => ({ userId: "owner-1", email: "dueno@taller.mx" }),
    planOf: async () => o.plan ?? "pro",
    team: async () => ["dueno@taller.mx", "socia@taller.mx"],
    debitIfEnough: async (_u, c) => {
      if (o.credits === false) return false;
      debits.push(c);
      return true;
    },
    refund: async () => {},
    unsubscribeUrl: (p, a) => `https://openlen.com/u/${p}:${a}`,
    notify: async (e) => void notices.push(e),
    now: () => NOW,
  };
  return { d, store, sent, debits, notices, resend };
}

const input = (o: Omit<Partial<SendInput>, "email"> & { email?: Partial<ResendEmail> } = {}): SendInput => ({
  projectId: "p1",
  environment: "live",
  kind: "app",
  ...o,
  email: { from: "Taller <noreply@notify.taller.mx>", to: ["ana@cliente.mx"], subject: "Tu pedido", html: "<p>Listo</p>", text: "Listo", ...o.email },
});

describe("sendProjectEmail — the refusals, in order, each with Resend's name and logged", () => {
  it("a blocked project", async () => {
    const w = await world();
    await w.store.block("project", "p1", "spam");
    expect(await sendProjectEmail(input(), w.d)).toMatchObject({ kind: "rejected", error: { statusCode: 403, name: "suspended_api_key" } });
    expect((await w.store.recentMessages("p1", 5))[0]).toMatchObject({ status: "rejected", toAddress: "ana@cliente.mx", reason: expect.stringMatching(/paused/) });
  });

  it("the free plan", async () => {
    const w = await world({ plan: "free" });
    expect(await sendProjectEmail(input(), w.d)).toMatchObject({ kind: "rejected", error: { statusCode: 403, name: "validation_error", message: expect.stringMatching(/paid plans/) } });
  });

  it("a domain that isn't ready, with Resend's own sentence", async () => {
    const w = await world({ status: "verifying" });
    expect(await sendProjectEmail(input(), w.d)).toMatchObject({ kind: "rejected", error: { statusCode: 403, name: "validation_error", message: "The `notify.taller.mx` domain is not verified. Please, add and verify your domain." } });
  });

  it("a from outside the project's sending host; with «show as root», the root is the host", async () => {
    const w = await world();
    expect(await sendProjectEmail(input({ email: { from: "otro@gmail.com" } }), w.d)).toMatchObject({ kind: "rejected", error: { statusCode: 403, name: "validation_error", message: "The `gmail.com` domain is not verified. Please, add and verify your domain." } });
    const root = await world({ showAsRoot: true });
    expect(await sendProjectEmail(input({ email: { from: "Taller <hola@taller.mx>" } }), root.d)).toMatchObject({ kind: "sent" });
  });

  it("over 100 KB, over 50 recipients, or a malformed address", async () => {
    const w = await world();
    expect(await sendProjectEmail(input({ email: { html: "x".repeat(101 * 1024) } }), w.d)).toMatchObject({ error: { statusCode: 400, name: "validation_error" } });
    const many = Array.from({ length: 51 }, (_, i) => `a${i}@x.com`);
    expect(await sendProjectEmail(input({ email: { to: many } }), w.d)).toMatchObject({ error: { statusCode: 400, name: "validation_error", message: expect.stringMatching(/50/) } });
    expect(await sendProjectEmail(input({ email: { to: ["nope"] } }), w.d)).toMatchObject({ error: { statusCode: 400, name: "validation_error" } });
    expect(w.sent).toEqual([]);
  });
});

describe("the suppression list (Review Focus 1 and 2)", () => {
  it("an address on the list is skipped whatever its case and spaces", async () => {
    const w = await world();
    await w.store.suppress("p1", "ana@cliente.mx", "unsubscribed");
    expect(await sendProjectEmail(input({ email: { to: [" Ana@Cliente.MX "] } }), w.d)).toMatchObject({ kind: "rejected", error: { statusCode: 400, name: "validation_error" } });
    expect(w.sent).toEqual([]);
  });

  it("with several recipients, the others get it and only they are charged", async () => {
    const w = await world();
    await w.store.suppress("p1", "beto@cliente.mx", "bounced");
    const r = await sendProjectEmail(input({ email: { to: ["ana@cliente.mx", "beto@cliente.mx", "caro@cliente.mx"] } }), w.d);
    expect(r).toMatchObject({ kind: "sent", skipped: ["beto@cliente.mx"] });
    expect(w.sent.map((s) => s.email.to)).toEqual([["ana@cliente.mx"], ["caro@cliente.mx"]]);
    expect(await w.store.usage("owner-1", "2026-10")).toBe(2);
  });
});

describe("the hourly cap (Review Focus 3)", () => {
  it("two sends at once at 99 of 100: only one goes out", async () => {
    const w = await world();
    for (let i = 0; i < 99; i++) await w.store.logMessage({ projectId: "p1", ownerId: "owner-1", environment: "live", kind: "app", toAddress: `x${i}@x.com`, subject: "s", status: "sent", reason: null, resendId: null, tag: null });
    const [a, b] = await Promise.all([sendProjectEmail(input(), w.d), sendProjectEmail(input({ email: { to: ["beto@cliente.mx"] } }), w.d)]);
    expect([a.kind, b.kind].sort()).toEqual(["rejected", "sent"]);
    expect([a, b].find((r) => r.kind === "rejected")).toMatchObject({ error: { statusCode: 429, name: "rate_limit_exceeded" } });
  });

  it("sign-in emails have their own, bigger cap", async () => {
    const w = await world();
    for (let i = 0; i < 100; i++) await w.store.logMessage({ projectId: "p1", ownerId: "owner-1", environment: "live", kind: "app", toAddress: `x${i}@x.com`, subject: "s", status: "sent", reason: null, resendId: null, tag: null });
    expect(await sendProjectEmail(input(), w.d)).toMatchObject({ kind: "rejected", error: { name: "rate_limit_exceeded" } });
    expect(await sendProjectEmail(input({ kind: "auth" }), w.d)).toMatchObject({ kind: "sent" });
  });
});

describe("the draft", () => {
  it("to a team address it sends; to anyone else it's not_sent_draft and costs nothing", async () => {
    const w = await world();
    expect(await sendProjectEmail(input({ environment: "draft", email: { to: ["Socia@taller.mx"] } }), w.d)).toMatchObject({ kind: "sent" });
    const r = await sendProjectEmail(input({ environment: "draft", email: { to: ["socia@taller.mx", "ana@cliente.mx"] } }), w.d);
    expect(r).toMatchObject({ kind: "not_sent_draft", id: expect.stringMatching(/^draft_/) });
    expect(w.sent).toHaveLength(1);
    expect(await w.store.usage("owner-1", "2026-10")).toBe(1);
    expect((await w.store.recentMessages("p1", 10)).filter((m) => m.status === "not_sent_draft").map((m) => m.toAddress).sort()).toEqual(["ana@cliente.mx", "socia@taller.mx"]);
  });
});

describe("the month's allowance", () => {
  it("past it, 15 centicredits per recipient; without credits, 429 and one notice", async () => {
    const w = await world();
    await w.store.addUsage("owner-1", "2026-10", 999);
    await sendProjectEmail(input({ email: { to: ["a@x.com", "b@x.com"] } }), w.d);
    expect(w.debits).toEqual([15]);
    const broke = await world({ credits: false });
    await broke.store.addUsage("owner-1", "2026-10", 1_000);
    expect(await sendProjectEmail(input(), broke.d)).toMatchObject({ kind: "rejected", error: { statusCode: 429, name: "monthly_quota_exceeded" } });
    expect(broke.notices).toEqual([{ type: "email_quota", projectId: "p1", recipientUserId: "owner-1", percent: 100, sent: 1_000, included: 1_000, noCredits: true }]);
  });

  it("crossing 80 % and 100 % notifies once each", async () => {
    const w = await world();
    await w.store.addUsage("owner-1", "2026-10", 799);
    await sendProjectEmail(input(), w.d);
    await sendProjectEmail(input(), w.d);
    await w.store.addUsage("owner-1", "2026-10", 198);
    await sendProjectEmail(input(), w.d);
    expect(w.notices.map((n) => n.percent)).toEqual([80, 100]);
  });

  it("a notice that fails doesn't turn an email that went out into an error", async () => {
    const w = await world();
    await w.store.addUsage("owner-1", "2026-10", 799);
    w.d.notify = async () => {
      throw new Error("notifications down");
    };
    await expect(sendProjectEmail(input(), w.d)).resolves.toMatchObject({ kind: "sent" });
  });
});

describe("what goes out", () => {
  it("app and form get the unsubscribe footer and both headers; auth doesn't", async () => {
    for (const kind of ["app", "form"] as const) {
      const w = await world();
      await sendProjectEmail(input({ kind }), w.d);
      const e = w.sent[0]!.email;
      expect(e.headers).toEqual({ "List-Unsubscribe": "<https://openlen.com/u/p1:ana@cliente.mx>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
      expect(e.html).toContain('href="https://openlen.com/u/p1:ana@cliente.mx"');
      expect(e.text).toContain("https://openlen.com/u/p1:ana@cliente.mx");
    }
    const w = await world();
    await sendProjectEmail(input({ kind: "auth" }), w.d);
    expect(w.sent[0]!.email.headers).toBeUndefined();
    expect(w.sent[0]!.email.html).toBe("<p>Listo</p>");
  });

  it("reply_to defaults to the owner, and one given is kept", async () => {
    const w = await world();
    await sendProjectEmail(input(), w.d);
    await sendProjectEmail(input({ email: { reply_to: ["ventas@taller.mx"] } }), w.d);
    expect(w.sent.map((s) => s.email.reply_to)).toEqual([["dueno@taller.mx"], ["ventas@taller.mx"]]);
  });

  it("each recipient's send is logged with Resend's id, and the idempotency key is per recipient", async () => {
    const w = await world();
    const r = await sendProjectEmail(input({ idempotencyKey: "k1", email: { to: ["a@x.com", "b@x.com"] } }), w.d);
    expect(r).toMatchObject({ kind: "sent", id: "re_1" });
    expect(w.sent.map((s) => s.key)).toEqual(["k1:a@x.com", "k1:b@x.com"]);
    expect((await w.store.recentMessages("p1", 5)).map((m) => [m.toAddress, m.resendId, m.status]).sort()).toEqual([
      ["a@x.com", "re_1", "sent"],
      ["b@x.com", "re_2", "sent"],
    ]);
  });

  it("Resend refusing comes back with its error and is logged", async () => {
    const w = await world();
    vi.mocked(w.resend.send).mockResolvedValueOnce({ error: { statusCode: 422, name: "validation_error", message: "Invalid `to` field." } });
    expect(await sendProjectEmail(input(), w.d)).toMatchObject({ kind: "rejected", error: { name: "validation_error", message: "Invalid `to` field." } });
    expect((await w.store.recentMessages("p1", 1))[0]).toMatchObject({ status: "rejected", reason: "Invalid `to` field." });
    expect(await w.store.usage("owner-1", "2026-10")).toBe(0);
  });
});
