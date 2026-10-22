import { describe, expect, it, vi } from "vitest";

import { resendClients } from "./resend-clients";

type Seen = { url: string; method: string; headers: Record<string, string>; body: unknown };

function fakeFetch(answer: (req: Seen) => { status: number; body: unknown }) {
  const seen: Seen[] = [];
  const f = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const req: Seen = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
    };
    seen.push(req);
    const a = answer(req);
    return new Response(a.body === null ? null : JSON.stringify(a.body), { status: a.status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { f, seen };
}

// The shape Resend answers POST /domains with (resend.com/docs/api-reference/domains/create-domain).
const created = {
  id: "4dd369bc-aa82-4ff3-97de-514ae3000ee0",
  name: "notify.taller.mx",
  status: "not_started",
  region: "us-east-1",
  records: [
    { record: "SPF", name: "send.notify", type: "MX", ttl: "Auto", status: "not_started", value: "feedback-smtp.us-east-1.amazonses.com", priority: 10 },
    { record: "SPF", name: "send.notify", value: "\"v=spf1 include:amazonses.com ~all\"", type: "TXT", ttl: "Auto", status: "not_started" },
    { record: "DKIM", name: "resend._domainkey.notify", value: "p=MIGfMA0GCSqGSIb3DQEB", type: "TXT", status: "not_started", ttl: "Auto" },
    { record: "Receiving", name: "notify", type: "MX", ttl: "Auto", status: "not_started", value: "inbound-smtp.us-east-1.amazonaws.com", priority: 10 },
  ],
};

describe("resendClients — the customers' Resend account (spec 0.7)", () => {
  it("createDomain posts the name with the send return path and keeps only the SPF and DKIM records", async () => {
    const { f, seen } = fakeFetch(() => ({ status: 201, body: created }));
    const r = await resendClients("re_clients_key", f).createDomain("notify.taller.mx");
    expect(seen[0]).toMatchObject({ url: "https://api.resend.com/domains", method: "POST", body: { name: "notify.taller.mx", custom_return_path: "send" } });
    expect(r.id).toBe(created.id);
    expect(r.records).toEqual([
      { type: "MX", name: "send.notify", value: "feedback-smtp.us-east-1.amazonses.com", priority: 10 },
      { type: "TXT", name: "send.notify", value: "v=spf1 include:amazonses.com ~all" },
      { type: "TXT", name: "resend._domainkey.notify", value: "p=MIGfMA0GCSqGSIb3DQEB" },
    ]);
  });

  it("the key goes as a Bearer header and nowhere else", async () => {
    const { f, seen } = fakeFetch(() => ({ status: 200, body: { id: "re_1" } }));
    await resendClients("re_clients_key", f).send({ from: "Taller <noreply@notify.taller.mx>", to: ["ana@x.com"], subject: "Hola", html: "<p>Hola</p>" }, "idem-1");
    expect(seen[0]!.headers.authorization).toBe("Bearer re_clients_key");
    expect(seen[0]!.headers["idempotency-key"]).toBe("idem-1");
    expect(seen[0]!.url).toBe("https://api.resend.com/emails");
    expect(JSON.stringify(seen[0]!.body)).not.toContain("re_clients_key");
  });

  it("a 4xx from send comes back as { error } with Resend's own name and message", async () => {
    const { f } = fakeFetch(() => ({ status: 422, body: { statusCode: 422, name: "validation_error", message: "Invalid `to` field." } }));
    const r = await resendClients("k", f).send({ from: "a@notify.taller.mx", to: ["nope"], subject: "s", text: "t" });
    expect(r).toEqual({ error: { statusCode: 422, name: "validation_error", message: "Invalid `to` field." } });
  });

  it("a send answer without Resend's error shape still comes back as an error", async () => {
    const { f } = fakeFetch(() => ({ status: 502, body: null }));
    const r = await resendClients("k", f).send({ from: "a@notify.taller.mx", to: ["a@x.com"], subject: "s", text: "t" });
    expect(r).toEqual({ error: { statusCode: 502, name: "application_error", message: "Resend answered 502" } });
  });

  it("getDomain reads status and records; a 404 is null", async () => {
    const { f } = fakeFetch((req) => (req.url.endsWith("/missing") ? { status: 404, body: { statusCode: 404, name: "not_found", message: "Domain not found" } } : { status: 200, body: { ...created, status: "verified" } }));
    const c = resendClients("k", f);
    expect(await c.getDomain(created.id)).toMatchObject({ status: "verified", records: expect.arrayContaining([expect.objectContaining({ name: "resend._domainkey.notify" })]) });
    expect(await c.getDomain("missing")).toBeNull();
  });

  it("verify and delete hit their endpoints; a failed domain call throws with Resend's message", async () => {
    const { f, seen } = fakeFetch((req) => (req.method === "DELETE" ? { status: 500, body: { statusCode: 500, name: "application_error", message: "boom" } } : { status: 200, body: { object: "domain", id: "d1" } }));
    const c = resendClients("k", f);
    await c.verifyDomain("d1");
    expect(seen[0]).toMatchObject({ url: "https://api.resend.com/domains/d1/verify", method: "POST" });
    await expect(c.deleteDomain("d1")).rejects.toThrow("boom");
    expect(seen[1]).toMatchObject({ url: "https://api.resend.com/domains/d1", method: "DELETE" });
  });
});
