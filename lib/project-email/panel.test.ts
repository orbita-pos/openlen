import { generateKeyPairSync } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { Plan } from "@/lib/plan";

import { connectDomain } from "./domain";
import { dcState, dcStateProject, emailPanel, type PanelDeps } from "./panel";
import type { ResendClients } from "./resend-clients";
import { memoryEmailStore } from "./store";

const RECORDS = [
  { type: "MX" as const, name: "send.notify", value: "feedback-smtp.us-east-1.amazonses.com", priority: 10 },
  { type: "TXT" as const, name: "send.notify", value: "v=spf1 include:amazonses.com ~all" },
  { type: "TXT" as const, name: "resend._domainkey.notify", value: "p=MIGf" },
];
const PEM = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();

function world(o: { plan?: Plan; dc?: "godaddy-with-template" | "godaddy-without-template" | "none"; resendStatus?: string; custom?: string | null } = {}) {
  const resend: ResendClients = {
    createDomain: vi.fn(async () => ({ id: "rd_1", records: RECORDS, status: "not_started" })),
    getDomain: vi.fn(async () => ({ status: o.resendStatus ?? "not_started", records: RECORDS })),
    verifyDomain: vi.fn(async () => {}),
    deleteDomain: vi.fn(async () => {}),
    send: vi.fn(),
  };
  const dc = o.dc ?? "none";
  const d: PanelDeps = {
    store: memoryEmailStore(),
    resend,
    planOfProject: async () => o.plan ?? "pro",
    ownerOf: async () => ({ userId: "owner-1", email: "dueno@taller.mx" }),
    notify: async () => {},
    applyFunctionEnv: async () => {},
    now: () => new Date("2026-10-22T10:00:00Z"),
    dc: {
      resolveTxt: async (name) => {
        if (dc !== "none" && name === "_domainconnect.taller.mx") return [["domainconnect.godaddy.com"]];
        throw new Error("ENODATA");
      },
      fetch: (async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith("/settings")) return new Response(JSON.stringify({ providerId: "godaddy.com", providerName: "GoDaddy", urlAPI: "https://api.gd", urlSyncUX: "https://ux.gd" }), { status: 200 });
        return new Response(null, { status: dc === "godaddy-with-template" ? 200 : 404 });
      }) as typeof fetch,
    },
    resolveNs: async () => ["ns1.domaincontrol.com"],
    privateKeyPem: PEM,
    customDomainOf: async () => o.custom ?? null,
    returnUrl: "https://openlen.com/api/email/domain-connect/return",
    stateSecret: "secret",
  };
  return d;
}

describe("emailPanel", () => {
  it("the free plan sees its plan and no domain, and nothing is asked of Resend", async () => {
    const d = world({ plan: "free", custom: "taller.mx" });
    const p = await emailPanel("p1", d);
    expect(p).toMatchObject({ available: true, plan: "free", domain: null, usage: { sent: 0, included: 0, extraCenticredits: 0 }, suggestedDomain: "taller.mx" });
  });

  it("a connected domain shows its three records, its provider and its help page", async () => {
    const d = world();
    await connectDomain("p1", { domain: "taller.mx", showAsRoot: false }, d);
    const p = await emailPanel("p1", d);
    expect(p.domain).toMatchObject({ domain: "taller.mx", sendingHost: "notify.taller.mx", status: "pending", records: RECORDS, provider: "godaddy", oneClickUrl: null });
    expect(p.domain!.instructionsUrl).toMatch(/godaddy\.com/);
    expect(p.dmarc).toBeNull();
  });

  it("oneClickUrl only when the provider has OpenLen's template, and not once ready", async () => {
    expect((await panelAfterConnect(world({ dc: "godaddy-without-template" }))).domain!.oneClickUrl).toBeNull();
    const withTemplate = await panelAfterConnect(world({ dc: "godaddy-with-template" }));
    expect(withTemplate.domain!.oneClickUrl).toMatch(/^https:\/\/ux\.gd\/v2\/domainTemplates\/providers\/openlen\.app\/services\/email\/apply\?domain=taller\.mx&host=notify&/);
    const d = world({ dc: "godaddy-with-template", resendStatus: "verified" });
    await connectDomain("p1", { domain: "taller.mx", showAsRoot: false }, d);
    const { checkDomain } = await import("./domain");
    await checkDomain("p1", d);
    expect((await emailPanel("p1", d)).domain!.oneClickUrl).toBeNull();
  });

  it("without OpenLen's signing key there is no button", async () => {
    const d = { ...world({ dc: "godaddy-with-template" }), privateKeyPem: null };
    await connectDomain("p1", { domain: "taller.mx", showAsRoot: false }, d);
    expect((await emailPanel("p1", d)).domain!.oneClickUrl).toBeNull();
  });

  it("the month's usage against the plan, and what went past it in credits", async () => {
    const d = world({ plan: "pro" });
    await d.store.addUsage("owner-1", "2026-10", 1_200);
    expect((await emailPanel("p1", d)).usage).toEqual({ month: "2026-10", sent: 1_200, included: 1_000, extraCenticredits: 3_000 });
  });

  it("«show as @domain» proposes the DMARC line", async () => {
    const d = world();
    await connectDomain("p1", { domain: "taller.mx", showAsRoot: true }, d);
    expect((await emailPanel("p1", d)).dmarc).toEqual({ type: "TXT", name: "_dmarc", value: "v=DMARC1; p=none;" });
  });
});

async function panelAfterConnect(d: PanelDeps) {
  await connectDomain("p1", { domain: "taller.mx", showAsRoot: false }, d);
  return emailPanel("p1", d);
}

describe("the Domain Connect state", () => {
  it("round-trips the project and refuses a forged one", () => {
    const s = dcState("p1", "secret");
    expect(dcStateProject(s, "secret")).toBe("p1");
    expect(dcStateProject(s, "other-secret")).toBeNull();
    expect(dcStateProject(`${s.split(".")[0]}.AAAA`, "secret")).toBeNull();
    expect(dcStateProject("nope", "secret")).toBeNull();
  });
});
