import { describe, expect, it, vi } from "vitest";

import { hashSecretKey } from "@/lib/backend/keys";

import { handleEmailRequest, type EmailGatewayDeps } from "./gateway";
import type { ResendClients, ResendEmail } from "./resend-clients";
import { memoryEmailStore } from "./store";

const KEY = "sb_secret_abcdefghijklmnopqrstuvwx";

async function deps(o: { enabled?: boolean; environment?: "draft" | "live" } = {}) {
  const store = memoryEmailStore();
  await store.putDomain({ projectId: "p1", domain: "taller.mx", sendingHost: "notify.taller.mx", showAsRoot: false, resendDomainId: "rd", records: [], status: "ready", lastCheckedAt: null, verifiedAt: null });
  const sent: ResendEmail[] = [];
  let n = 0;
  const resend: ResendClients = {
    createDomain: vi.fn(),
    getDomain: vi.fn(),
    verifyDomain: vi.fn(),
    deleteDomain: vi.fn(),
    send: vi.fn(async (e: ResendEmail) => {
      sent.push(e);
      return { id: `re_${++n}` };
    }),
  };
  const d: EmailGatewayDeps = {
    enabled: () => o.enabled ?? true,
    resolve: async () => ({ projectId: "p1", environment: o.environment ?? "live", secretKeyHash: hashSecretKey(KEY) }),
    store,
    resend,
    ownerOf: async () => ({ userId: "u1", email: "dueno@taller.mx" }),
    planOf: async () => "pro",
    team: async () => ["dueno@taller.mx"],
    debitIfEnough: async () => true,
    refund: async () => {},
    unsubscribeUrl: (p, a) => `https://openlen.com/u/${p}.${a}`,
    notify: async () => {},
    now: () => new Date("2026-10-22T10:00:00Z"),
  };
  return { d, sent };
}

const req = (path: string, body: unknown, o: { key?: string | null; method?: string; header?: "bearer" | "apikey"; idem?: string } = {}) => {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const key = o.key === undefined ? KEY : o.key;
  if (key) headers[o.header === "apikey" ? "apikey" : "authorization"] = o.header === "apikey" ? key : `Bearer ${key}`;
  if (o.idem) headers["idempotency-key"] = o.idem;
  return new Request(`https://iolmg.openlen.app${path}`, { method: o.method ?? "POST", headers, ...(o.method === "GET" ? {} : { body: JSON.stringify(body) }) });
};

// What `resend.emails.send` 6.32.1 puts on the wire (parseEmailToApiOptions): `to` may be a string,
// camelCase becomes snake_case, and the unset fields are dropped by JSON.
const SDK_BODY = { from: "Taller <noreply@notify.taller.mx>", to: "ana@cliente.mx", subject: "Tu pedido", html: "<p>Listo</p>", reply_to: "ventas@taller.mx", tags: [{ name: "kind", value: "order" }] };

describe("the /email/v1 gateway speaks Resend's API", () => {
  it("the Resend SDK's own request is accepted and answered { id }", async () => {
    const { d, sent } = await deps();
    const r = await handleEmailRequest(req("/email/v1/emails", SDK_BODY), d);
    expect([r.status, await r.json()]).toEqual([200, { id: "re_1" }]);
    expect(sent[0]).toMatchObject({ to: ["ana@cliente.mx"], reply_to: ["ventas@taller.mx"], tags: [{ name: "kind", value: "order" }] });
  });

  it("the apikey header works too, and the idempotency key goes through", async () => {
    const { d } = await deps();
    vi.spyOn(d.resend, "send");
    await handleEmailRequest(req("/email/v1/emails", SDK_BODY, { header: "apikey", idem: "k-1" }), d);
    expect(vi.mocked(d.resend.send).mock.calls[0]![1]).toBe("k-1:ana@cliente.mx");
  });

  it("no key is 401 missing_api_key; the publishable key or a wrong one is 401 validation_error", async () => {
    const { d } = await deps();
    const none = await handleEmailRequest(req("/email/v1/emails", SDK_BODY, { key: null }), d);
    expect([none.status, await none.json()]).toEqual([401, { statusCode: 401, name: "missing_api_key", message: "Missing API Key" }]);
    for (const key of ["sb_publishable_abc", "sb_secret_wrongwrongwrongwrong"]) {
      const r = await handleEmailRequest(req("/email/v1/emails", SDK_BODY, { key }), d);
      expect([r.status, (await r.json()).name]).toEqual([401, "validation_error"]);
    }
  });

  it("batch answers { data: [{ id }] }", async () => {
    const { d } = await deps();
    const r = await handleEmailRequest(req("/email/v1/emails/batch", [SDK_BODY, { ...SDK_BODY, to: ["beto@cliente.mx"] }]), d);
    expect(await r.json()).toEqual({ data: [{ id: "re_1" }, { id: "re_2" }] });
  });

  it("fields we don't take are a validation_error naming the field", async () => {
    const { d, sent } = await deps();
    for (const extra of [{ attachments: [{ filename: "a.pdf", content: "x" }] }, { cc: "b@x.com" }, { bcc: ["c@x.com"] }, { scheduled_at: "in 1 hour" }, { template: { id: "t" } }]) {
      const r = await handleEmailRequest(req("/email/v1/emails", { ...SDK_BODY, ...extra }), d);
      const j = await r.json();
      expect([r.status, j.name]).toEqual([400, "validation_error"]);
      expect(j.message).toContain(Object.keys(extra)[0]);
    }
    expect(sent).toEqual([]);
  });

  it("a refusal from the core keeps its status and Resend's body", async () => {
    const { d } = await deps();
    const r = await handleEmailRequest(req("/email/v1/emails", { ...SDK_BODY, from: "x@gmail.com" }), d);
    expect([r.status, await r.json()]).toEqual([403, { statusCode: 403, name: "validation_error", message: "The `gmail.com` domain is not verified. Please, add and verify your domain." }]);
  });

  it("in the draft, to someone outside the team: 200 with a draft id and the header that says it wasn't sent", async () => {
    const { d, sent } = await deps({ environment: "draft" });
    const r = await handleEmailRequest(req("/email/v1/emails", SDK_BODY), d);
    expect(r.status).toBe(200);
    expect((await r.json()).id).toMatch(/^draft_/);
    expect(r.headers.get("x-openlen-email")).toBe("not-sent-draft");
    expect(sent).toEqual([]);
  });

  it("other paths are not_found, other methods method_not_allowed, and email off is service_unavailable", async () => {
    const { d } = await deps();
    expect((await (await handleEmailRequest(req("/email/v1/domains", {}), d)).json()).name).toBe("not_found");
    expect((await (await handleEmailRequest(req("/email/v1/emails", null, { method: "GET" }), d)).json()).name).toBe("method_not_allowed");
    const off = await deps({ enabled: false });
    const r = await handleEmailRequest(req("/email/v1/emails", SDK_BODY), off.d);
    expect([r.status, (await r.json()).name]).toEqual([503, "service_unavailable"]);
  });

  it("a body that isn't JSON is a validation_error", async () => {
    const { d } = await deps();
    const r = await handleEmailRequest(new Request("https://iolmg.openlen.app/email/v1/emails", { method: "POST", headers: { authorization: `Bearer ${KEY}` }, body: "{nope" }), d);
    expect([r.status, (await r.json()).name]).toEqual([400, "validation_error"]);
  });
});
