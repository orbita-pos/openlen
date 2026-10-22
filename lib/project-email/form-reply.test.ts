import { describe, expect, it, vi } from "vitest";

import type { Plan } from "@/lib/plan";

import { formReplyConfig, renderReply, replyAddress, sendFormReply } from "./form-reply";
import type { ResendClients, ResendEmail } from "./resend-clients";
import type { SendDeps } from "./send";
import { memoryEmailStore } from "./store";
import type { EmailDomainStatus } from "./types";

const NOW = new Date("2026-10-22T10:00:00Z");
const HOSTS = ["taller.openlen.app", "taller.mx"];

describe("replyAddress (Review Focus 5)", () => {
  it("the field named like an email first, then any single address", () => {
    expect(replyAddress({ nombre: "Ana", correo: "Ana@X.com" })).toBe("ana@x.com");
    expect(replyAddress({ nombre: "Ana", contacto: "ana@x.com" })).toBe("ana@x.com");
    expect(replyAddress({ nombre: "Ana" })).toBeNull();
  });

  it("a list or a line break is no address: nothing is sent", () => {
    expect(replyAddress({ email: "a@x.com, b@y.com" })).toBeNull();
    expect(replyAddress({ email: "a@x.com\r\nBcc: z@w.com" })).toBeNull();
    expect(replyAddress({ email: "a@x.com b@y.com" })).toBeNull();
  });
});

describe("renderReply", () => {
  it("fills {{field}} from the form, escaped, and keeps the paragraphs", () => {
    const r = renderReply({ subject: "Gracias, {{nombre}}", body: "Hola {{nombre}}:\n\nTe escribimos pronto.\nVisita https://taller.mx/menu" }, { nombre: "<Ana>" }, HOSTS);
    expect(r).toEqual({
      subject: "Gracias, <Ana>",
      html: "<p>Hola &lt;Ana&gt;:</p><p>Te escribimos pronto.<br>Visita https://taller.mx/menu</p>",
      text: "Hola <Ana>:\n\nTe escribimos pronto.\nVisita https://taller.mx/menu",
    });
  });

  it("a link to another site is refused", () => {
    expect(renderReply({ subject: "Hola", body: "Mira https://otro-sitio.com/oferta" }, {}, HOSTS)).toEqual({ error: expect.stringMatching(/otro-sitio\.com/) });
    expect(renderReply({ subject: "Hola", body: "En https://www.taller.mx/ o https://notify.taller.mx" }, {}, HOSTS)).not.toHaveProperty("error");
  });

  it("a line break in the subject from a field doesn't open a header", () => {
    expect(renderReply({ subject: "Hola {{nombre}}", body: "x" }, { nombre: "Ana\r\nBcc: z@w.com" }, HOSTS)).toMatchObject({ subject: "Hola Ana Bcc: z@w.com" });
  });
});

describe("formReplyConfig", () => {
  it("the form's own id, then page:index, then the index, as the lead notice resolves them", () => {
    const forms = { "f-1": { autoReply: { subject: "a", body: "a" } }, "menu:0": { autoReply: { subject: "b", body: "b" } }, "0": { autoReply: { subject: "c", body: "c" } }, "2": { notifyEmail: "x@y.z" } };
    expect(formReplyConfig(forms, "f-1", 0, "menu")).toEqual({ key: "f-1", reply: { subject: "a", body: "a" } });
    expect(formReplyConfig(forms, null, 0, "menu")).toEqual({ key: "menu:0", reply: { subject: "b", body: "b" } });
    expect(formReplyConfig(forms, null, 0, null)).toEqual({ key: "0", reply: { subject: "c", body: "c" } });
    expect(formReplyConfig(forms, null, 2, null)).toBeNull();
    expect(formReplyConfig(undefined, null, 0, null)).toBeNull();
  });
});

async function world(o: { plan?: Plan; status?: EmailDomainStatus } = {}) {
  const store = memoryEmailStore(() => NOW);
  await store.putDomain({ projectId: "p1", domain: "taller.mx", sendingHost: "notify.taller.mx", showAsRoot: false, resendDomainId: "rd", records: [], status: o.status ?? "ready", lastCheckedAt: null, verifiedAt: null });
  const sent: ResendEmail[] = [];
  const resend: ResendClients = { createDomain: vi.fn(), getDomain: vi.fn(), verifyDomain: vi.fn(), deleteDomain: vi.fn(), send: vi.fn(async (e: ResendEmail) => (sent.push(e), { id: `re_${sent.length}` })) };
  const d: SendDeps = {
    store,
    resend,
    ownerOf: async () => ({ userId: "u1", email: "dueno@taller.mx" }),
    planOf: async () => o.plan ?? "pro",
    team: async () => [],
    debitIfEnough: async () => true,
    refund: async () => {},
    unsubscribeUrl: () => "https://openlen.com/u/t",
    notify: async () => {},
    now: () => NOW,
  };
  return { d, sent };
}

const input = { projectId: "p1", formKey: "contacto", fromName: "Taller", hosts: HOSTS, reply: { subject: "Gracias, {{nombre}}", body: "Te escribimos pronto." } };

describe("sendFormReply", () => {
  it("replies once to whoever filled it, from the project's domain, as a form email", async () => {
    const w = await world();
    const r = await sendFormReply({ ...input, data: { nombre: "Ana", email: "ana@x.com" } }, w.d);
    expect(r).toMatchObject({ kind: "sent" });
    expect(w.sent[0]).toMatchObject({ from: "Taller <noreply@notify.taller.mx>", to: ["ana@x.com"], subject: "Gracias, Ana" });
    expect(w.sent[0]!.headers?.["List-Unsubscribe"]).toBe("<https://openlen.com/u/t>");
  });

  it("the second submit of the same address the same day gets no reply", async () => {
    const w = await world();
    await sendFormReply({ ...input, data: { email: "ana@x.com" } }, w.d);
    expect(await sendFormReply({ ...input, data: { email: "ANA@x.com" } }, w.d)).toBeNull();
    expect(w.sent).toHaveLength(1);
  });

  it("past 20 replies an hour for one form, no more", async () => {
    const w = await world();
    for (let i = 0; i < 20; i++) await sendFormReply({ ...input, data: { email: `p${i}@x.com` } }, w.d);
    expect(await sendFormReply({ ...input, data: { email: "late@x.com" } }, w.d)).toBeNull();
    expect(w.sent).toHaveLength(20);
  });

  it("no paid plan, no ready domain, no address or a bad template → null, and the form works as today", async () => {
    expect(await sendFormReply({ ...input, data: { email: "ana@x.com" } }, (await world({ plan: "free" })).d)).toBeNull();
    expect(await sendFormReply({ ...input, data: { email: "ana@x.com" } }, (await world({ status: "verifying" })).d)).toBeNull();
    expect(await sendFormReply({ ...input, data: { nombre: "Ana" } }, (await world()).d)).toBeNull();
    expect(await sendFormReply({ ...input, reply: { subject: "x", body: "https://spam.example" }, data: { email: "ana@x.com" } }, (await world()).d)).toBeNull();
  });
});
