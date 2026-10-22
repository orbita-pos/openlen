import { describe, expect, it, vi } from "vitest";

import type { Plan } from "@/lib/plan";
import type { EmailDomainEvent } from "@/lib/notifications/types";

import { checkDomain, connectDomain, disconnectDomain, normalizeDomain, sendingHostFor, type DomainDeps } from "./domain";
import type { ResendClients } from "./resend-clients";
import { memoryEmailStore } from "./store";

const RECORDS = [
  { type: "TXT" as const, name: "resend._domainkey.notify", value: "p=MIGf" },
  { type: "MX" as const, name: "send.notify", value: "feedback-smtp.us-east-1.amazonses.com", priority: 10 },
  { type: "TXT" as const, name: "send.notify", value: "v=spf1 include:amazonses.com ~all" },
];

function world(o: { plan?: Plan; resendStatus?: string } = {}) {
  let resendStatus = o.resendStatus ?? "not_started";
  const resend: ResendClients & { deleted: string[] } = {
    deleted: [],
    createDomain: vi.fn(async (name: string) => ({ id: `rd_${name}`, records: RECORDS, status: "not_started" })),
    getDomain: vi.fn(async () => ({ status: resendStatus, records: RECORDS })),
    verifyDomain: vi.fn(async () => {}),
    async deleteDomain(id) {
      resend.deleted.push(id);
    },
    send: vi.fn(),
  };
  const notices: EmailDomainEvent[] = [];
  const applied: string[] = [];
  const d: DomainDeps = {
    store: memoryEmailStore(),
    resend,
    planOfProject: async () => o.plan ?? "pro",
    ownerOf: async () => ({ userId: "owner-1", email: "dueno@taller.mx" }),
    notify: async (e) => void notices.push(e),
    applyFunctionEnv: async (p) => void applied.push(p),
    now: () => new Date("2026-10-22T10:00:00Z"),
  };
  return { d, resend, notices, applied, setResend: (s: string) => (resendStatus = s) };
}

describe("normalizeDomain and sendingHostFor (Review Focus 4)", () => {
  it("cleans what people type", () => {
    expect(normalizeDomain("https://Mi-Tienda.com/")).toBe("mi-tienda.com");
    expect(normalizeDomain("MI-TIENDA.COM.")).toBe("mi-tienda.com");
    expect(normalizeDomain("  www.mitienda.com/contacto  ")).toBe("mitienda.com");
    expect(normalizeDomain("tiendañ.mx")).toBe("xn--tienda-1wa.mx");
    expect(normalizeDomain("no es un dominio")).toBeNull();
    expect(normalizeDomain("localhost")).toBeNull();
    expect(normalizeDomain("192.168.0.1")).toBeNull();
  });

  it("sends from notify. unless shown as the root, and never notify.notify.", () => {
    expect(sendingHostFor("mitienda.com", false)).toBe("notify.mitienda.com");
    expect(sendingHostFor("mitienda.com", true)).toBe("mitienda.com");
    expect(sendingHostFor("notify.mitienda.com", false)).toBe("notify.mitienda.com");
  });
});

describe("connectDomain", () => {
  it("the free plan can't connect", async () => {
    const { d } = world({ plan: "free" });
    expect(await connectDomain("p1", { domain: "taller.mx", showAsRoot: false }, d)).toMatchObject({ kind: "free_plan" });
  });

  it("an invalid domain is refused before Resend is called", async () => {
    const { d, resend } = world();
    expect(await connectDomain("p1", { domain: "no es", showAsRoot: false }, d)).toMatchObject({ kind: "invalid_domain" });
    expect(resend.createDomain).not.toHaveBeenCalled();
  });

  it("creates the domain in Resend and stores it pending with its three records", async () => {
    const { d, resend } = world();
    const r = await connectDomain("p1", { domain: "https://Taller.mx", showAsRoot: false }, d);
    expect(resend.createDomain).toHaveBeenCalledWith("notify.taller.mx");
    expect(r).toMatchObject({ kind: "ok", row: { domain: "taller.mx", sendingHost: "notify.taller.mx", status: "pending", records: RECORDS } });
  });

  it("a host already used by another project is host_taken", async () => {
    const { d } = world();
    await connectDomain("p1", { domain: "taller.mx", showAsRoot: false }, d);
    expect(await connectDomain("p2", { domain: "taller.mx", showAsRoot: false }, d)).toMatchObject({ kind: "host_taken" });
  });

  it("connecting the same host again in the same project creates nothing new", async () => {
    const { d, resend } = world();
    await connectDomain("p1", { domain: "taller.mx", showAsRoot: false }, d);
    await connectDomain("p1", { domain: "TALLER.mx", showAsRoot: false }, d);
    expect(resend.createDomain).toHaveBeenCalledTimes(1);
  });

  it("another domain in the same project replaces the old one in Resend", async () => {
    const { d, resend } = world();
    await connectDomain("p1", { domain: "taller.mx", showAsRoot: false }, d);
    await connectDomain("p1", { domain: "otro.mx", showAsRoot: false }, d);
    expect(resend.deleted).toEqual(["rd_notify.taller.mx"]);
    expect((await d.store.getDomain("p1"))?.sendingHost).toBe("notify.otro.mx");
  });

  it("Resend refusing is provider_error and nothing is stored", async () => {
    const { d, resend } = world();
    vi.mocked(resend.createDomain).mockRejectedValueOnce(new Error("The domain is invalid"));
    expect(await connectDomain("p1", { domain: "taller.mx", showAsRoot: false }, d)).toMatchObject({ kind: "provider_error", message: "The domain is invalid" });
    expect(await d.store.getDomain("p1")).toBeNull();
  });
});

describe("checkDomain", () => {
  it("pending → verifying → ready calls applyFunctionEnv once and tells the owner it's ready", async () => {
    const { d, notices, applied, setResend } = world();
    await connectDomain("p1", { domain: "taller.mx", showAsRoot: false }, d);
    setResend("pending");
    expect(await checkDomain("p1", d)).toBe("verifying");
    setResend("verified");
    expect(await checkDomain("p1", d)).toBe("ready");
    expect(await checkDomain("p1", d)).toBe("ready");
    expect(applied).toEqual(["p1"]);
    expect(notices).toEqual([{ type: "email_domain", projectId: "p1", recipientUserId: "owner-1", domain: "taller.mx", status: "ready" }]);
    expect(await d.store.getDomain("p1")).toMatchObject({ status: "ready", verifiedAt: new Date("2026-10-22T10:00:00Z") });
  });

  it("partially_verified is ready: with one of the sending CNAMEs still pending Resend sends normally (resend.com/docs/dashboard/domains/manage-domains, read 22/10)", async () => {
    const { d, setResend } = world();
    await connectDomain("p1", { domain: "taller.mx", showAsRoot: false }, d);
    setResend("partially_verified");
    expect(await checkDomain("p1", d)).toBe("ready");
    setResend("partially_failed");
    expect(await checkDomain("p1", d)).toBe("offline");
  });

  it("🔴 a check doesn't ask Resend to verify a domain it is already checking or has verified: Resend's verify flips it to pending for a while (measured 22/10)", async () => {
    const { d, resend, setResend } = world();
    await connectDomain("p1", { domain: "taller.mx", showAsRoot: false }, d);
    setResend("not_started");
    expect(await checkDomain("p1", d)).toBe("verifying");
    expect(resend.verifyDomain).toHaveBeenCalledTimes(1);
    setResend("pending");
    expect(await checkDomain("p1", d)).toBe("verifying");
    setResend("partially_verified");
    expect(await checkDomain("p1", d)).toBe("ready");
    setResend("verified");
    expect(await checkDomain("p1", d)).toBe("ready");
    expect(resend.verifyDomain).toHaveBeenCalledTimes(1);
    setResend("temporary_failure");
    expect(await checkDomain("p1", d)).toBe("offline");
    expect(resend.verifyDomain).toHaveBeenCalledTimes(2);
  });

  it("🔴 a ready domain that Resend shows as pending for a moment (someone pressed verify) stays ready, without a notice", async () => {
    const { d, notices, setResend } = world({ resendStatus: "verified" });
    await connectDomain("p1", { domain: "taller.mx", showAsRoot: false }, d);
    expect(await checkDomain("p1", d)).toBe("ready");
    const before = notices.length;
    setResend("pending");
    expect(await checkDomain("p1", d)).toBe("ready");
    expect(notices).toHaveLength(before);
  });

  it("ready → offline notifies the owner and reapplies the env", async () => {
    const { d, notices, applied, setResend } = world({ resendStatus: "verified" });
    await connectDomain("p1", { domain: "taller.mx", showAsRoot: false }, d);
    await checkDomain("p1", d);
    setResend("failed");
    expect(await checkDomain("p1", d)).toBe("offline");
    expect(applied).toEqual(["p1", "p1"]);
    expect(notices.map((n) => n.status)).toEqual(["ready", "offline"]);
  });

  it("a domain Resend no longer has is offline if it was ready, failed otherwise", async () => {
    const { d, resend } = world({ resendStatus: "verified" });
    await connectDomain("p1", { domain: "taller.mx", showAsRoot: false }, d);
    vi.mocked(resend.getDomain).mockResolvedValueOnce(null);
    expect(await checkDomain("p1", d)).toBe("failed");
    await checkDomain("p1", d);
    vi.mocked(resend.getDomain).mockResolvedValueOnce(null);
    expect(await checkDomain("p1", d)).toBe("offline");
  });

  it("a project without a domain is null", async () => {
    const { d } = world();
    expect(await checkDomain("nope", d)).toBeNull();
  });
});

describe("disconnectDomain", () => {
  it("deletes in Resend and in the store and reapplies the env", async () => {
    const { d, resend, applied } = world();
    await connectDomain("p1", { domain: "taller.mx", showAsRoot: false }, d);
    await disconnectDomain("p1", d);
    expect(resend.deleted).toEqual(["rd_notify.taller.mx"]);
    expect(await d.store.getDomain("p1")).toBeNull();
    expect(applied).toEqual(["p1"]);
  });

  it("Resend failing to delete doesn't keep the domain connected here", async () => {
    const { d, resend } = world();
    await connectDomain("p1", { domain: "taller.mx", showAsRoot: false }, d);
    resend.deleteDomain = async () => {
      throw new Error("Domain not found");
    };
    await disconnectDomain("p1", d);
    expect(await d.store.getDomain("p1")).toBeNull();
  });
});
