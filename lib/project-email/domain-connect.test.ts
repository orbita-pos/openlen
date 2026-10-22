import { generateKeyPairSync, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { applyUrl, DC_KEY_HOST, discover, dmarcSuggestion, templateSupported, templateVars, type DcDeps, type DcSettings } from "./domain-connect";

const SETTINGS: DcSettings = {
  providerId: "godaddy.com",
  providerName: "GoDaddy",
  providerDisplayName: "GoDaddy",
  urlSyncUX: "https://dcc.godaddy.com/manage",
  urlAPI: "https://domainconnect.api.godaddy.com",
};

function deps(o: { txt?: Record<string, string[][]>; http?: (url: string) => { status: number; body: unknown } } = {}): DcDeps & { urls: string[] } {
  const urls: string[] = [];
  return {
    urls,
    resolveTxt: vi.fn(async (name: string) => {
      const r = o.txt?.[name];
      if (!r) throw Object.assign(new Error(`queryTxt ENODATA ${name}`), { code: "ENODATA" });
      return r;
    }),
    fetch: vi.fn(async (input: string | URL | Request) => {
      urls.push(String(input));
      const a = o.http?.(String(input)) ?? { status: 404, body: null };
      return new Response(a.body === null ? null : JSON.stringify(a.body), { status: a.status });
    }) as unknown as typeof fetch,
  };
}

describe("Domain Connect discovery (spec: _domainconnect TXT, then /v2/{domain}/settings)", () => {
  it("follows the TXT and reads the settings", async () => {
    const d = deps({ txt: { "_domainconnect.taller.mx": [["domainconnect.godaddy.com"]] }, http: () => ({ status: 200, body: SETTINGS }) });
    expect(await discover("taller.mx", d)).toEqual(SETTINGS);
    expect(d.urls).toEqual(["https://domainconnect.godaddy.com/v2/taller.mx/settings"]);
  });

  it("no TXT, or a 404 from the settings, is null", async () => {
    expect(await discover("taller.mx", deps())).toBeNull();
    expect(await discover("taller.mx", deps({ txt: { "_domainconnect.taller.mx": [["dc.example"]] } }))).toBeNull();
  });

  it("templateSupported is true only on 2xx from the provider's API", async () => {
    const ok = deps({ http: () => ({ status: 200, body: { version: 1 } }) });
    expect(await templateSupported(SETTINGS, ok)).toBe(true);
    expect(ok.urls[0]).toBe("https://domainconnect.api.godaddy.com/v2/domainTemplates/providers/openlen.app/services/email");
    expect(await templateSupported(SETTINGS, deps())).toBe(false);
  });
});

describe("the synchronous apply URL", () => {
  it("the signature verifies with the public key over the query without sig and key", () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const url = applyUrl(
      { settings: SETTINGS, domain: "taller.mx", host: "notify", vars: { dkim: "p=MIG f/+=", mxhost: "feedback-smtp.us-east-1.amazonses.com" }, redirectUri: "https://openlen.com/api/email/domain-connect/return", state: "st 1" },
      privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    );
    expect(url.startsWith("https://dcc.godaddy.com/manage/v2/domainTemplates/providers/openlen.app/services/email/apply?domain=taller.mx&host=notify&")).toBe(true);
    const query = url.slice(url.indexOf("?") + 1);
    const signed = query.slice(0, query.indexOf("&sig="));
    const sig = decodeURIComponent(/&sig=([^&]+)/.exec(query)![1]!);
    expect(query.endsWith(`&key=${DC_KEY_HOST}`)).toBe(true);
    expect(signed).toContain("dkim=p%3DMIG%20f%2F%2B%3D");
    expect(signed).toContain("state=st%201");
    expect(verify("sha256", Buffer.from(signed), publicKey, Buffer.from(sig, "base64"))).toBe(true);
  });

  it("a root domain goes without host", () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const url = applyUrl({ settings: SETTINGS, domain: "taller.mx", host: "", vars: {}, redirectUri: "https://openlen.com/r", state: "s" }, privateKey.export({ type: "pkcs8", format: "pem" }).toString());
    expect(url).toContain("apply?domain=taller.mx&redirect_uri=");
  });
});

describe("the template and its variables", () => {
  const records = [
    { type: "MX" as const, name: "send.notify", value: "feedback-smtp.us-east-1.amazonses.com", priority: 10 },
    { type: "TXT" as const, name: "send.notify", value: "v=spf1 include:amazonses.com ~all" },
    { type: "TXT" as const, name: "resend._domainkey.notify", value: "p=MIGfMA0" },
  ];

  it("templateVars takes the DKIM value and the MX host from Resend's records, and the host from the sending host", () => {
    expect(templateVars(records, "notify.taller.mx", "taller.mx")).toEqual({ dkim: "p=MIGfMA0", mxhost: "feedback-smtp.us-east-1.amazonses.com", host: "notify" });
    expect(templateVars(records, "taller.mx", "taller.mx").host).toBe("");
  });

  it("the template file has exactly the three records of the spec and parses as JSON", () => {
    const t = JSON.parse(readFileSync(join(process.cwd(), "infra/domain-connect/openlen.app.email.json"), "utf8"));
    expect(t).toMatchObject({ providerId: "openlen.app", serviceId: "email", syncPubKeyDomain: "openlen.app" });
    expect(t.records).toEqual([
      { type: "TXT", host: "resend._domainkey", data: "%dkim%", ttl: 3600 },
      { type: "MX", host: "send", pointsTo: "%mxhost%", priority: 10, ttl: 3600 },
      { type: "TXT", host: "send", data: "v=spf1 include:amazonses.com ~all", ttl: 3600 },
    ]);
  });

  it("dmarcSuggestion proposes p=none only when there is no _dmarc TXT", async () => {
    expect(await dmarcSuggestion("taller.mx", deps())).toEqual({ type: "TXT", name: "_dmarc", value: "v=DMARC1; p=none;" });
    expect(await dmarcSuggestion("taller.mx", deps({ txt: { "_dmarc.taller.mx": [["v=DMARC1; p=quarantine;"]] } }))).toBeNull();
  });
});
