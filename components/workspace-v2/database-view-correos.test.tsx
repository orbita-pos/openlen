// @vitest-environment jsdom
//
// The Correos tab of the Database view (spec local 2026-10-22-email-integration,
// 4 and 6.9), with the REAL Spanish texts and a fake `fetch`: it shows even on a
// page with no backend nor functions, and walks the owner from the plan to a
// ready domain.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";

import wsChrome from "@/messages/es/wsChrome.json";
import panelsChat from "@/messages/es/panelsChat.json";
import { DatabaseView } from "./database-view";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Call = { url: string; method: string; body: unknown };
let calls: Call[];
let root: Root;
let host: HTMLDivElement;

const RECORDS = [
  { type: "TXT", name: "resend._domainkey.notify", value: "p=MIGfMA0GCSq" },
  { type: "MX", name: "send.notify", value: "feedback-smtp.us-east-1.amazonses.com", priority: 10 },
  { type: "TXT", name: "send.notify", value: "v=spf1 include:amazonses.com ~all" },
];
const DOMAIN = (o: Record<string, unknown> = {}) => ({
  domain: "taller.mx",
  sendingHost: "notify.taller.mx",
  showAsRoot: false,
  records: RECORDS,
  status: "verifying",
  verifiedAt: null,
  provider: "godaddy",
  instructionsUrl: "https://www.godaddy.com/help/add-a-txt-record-19232",
  oneClickUrl: null,
  ...o,
});
const PANEL = (o: Record<string, unknown> = {}) => ({
  available: true,
  plan: "pro",
  domain: null,
  dmarc: null,
  suggestedDomain: null,
  usage: { month: "2026-10", sent: 0, included: 1000, extraCenticredits: 0 },
  recent: [],
  suppressions: [],
  ...o,
});

function stubFetch(email: (c: Call) => unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const c: Call = { url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null };
      calls.push(c);
      // A page with no backend and no functions: only the email answers.
      const body = url.includes("/email") ? email(c) : url.endsWith("/backend") ? { status: "none" } : { available: false };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
}

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const text = () => host.textContent ?? "";
const button = (label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);
async function click(el: Element | undefined) {
  if (!el) throw new Error("not there");
  await act(async () => { (el as HTMLElement).click(); });
  await settle();
}
async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="es" messages={{ wsChrome, panelsChat }}>
        <DatabaseView projectId="p1" />
      </NextIntlClientProvider>,
    );
  });
  await settle();
}
async function openTab() {
  await render();
  await click(button(wsChrome.database.tabs.email));
}

beforeEach(() => {
  calls = [];
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const e = wsChrome.database.email;

describe("the Correos tab", () => {
  it("a page without backend shows the Correos tab", async () => {
    stubFetch(() => PANEL());
    await render();
    expect(button(wsChrome.database.tabs.email)).toBeDefined();
  });

  it("with the email off there is no tab", async () => {
    stubFetch(() => ({ available: false }));
    await render();
    expect(button(wsChrome.database.tabs.email)).toBeUndefined();
  });

  it("free plan sees the upgrade, not the form", async () => {
    stubFetch(() => PANEL({ plan: "free" }));
    await openTab();
    expect(text()).toContain(e.free.title);
    expect(host.querySelector('a[href^="/api/billing/checkout"]')).not.toBeNull();
    expect(host.querySelector("#email-domain")).toBeNull();
  });

  it("without a domain it proposes the project's own and connects it", async () => {
    stubFetch((c) => (c.method === "POST" ? PANEL({ domain: DOMAIN() }) : PANEL({ suggestedDomain: "taller.mx" })));
    await openTab();
    const input = host.querySelector<HTMLInputElement>("#email-domain")!;
    expect(input.value).toBe("taller.mx");
    await type(input, "taller.mx");
    await click(button(e.connect));
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ action: "connect", domain: "taller.mx", showAsRoot: false });
    expect(text()).toContain("notify.taller.mx");
  });

  it("the three records render with copy buttons", async () => {
    stubFetch(() => PANEL({ domain: DOMAIN(), dmarc: { type: "TXT", name: "_dmarc", value: "v=DMARC1; p=none;" } }));
    await openTab();
    for (const r of RECORDS) expect(text()).toContain(r.value);
    expect([...host.querySelectorAll("button")].filter((b) => b.textContent?.trim() === e.copy).length).toBeGreaterThanOrEqual(6);
    expect(text()).toContain(e.optional);
    expect(host.querySelector('a[href="https://www.godaddy.com/help/add-a-txt-record-19232"]')).not.toBeNull();
  });

  it("the one-click button shows only with oneClickUrl", async () => {
    stubFetch(() => PANEL({ domain: DOMAIN() }));
    await openTab();
    expect(text()).not.toContain(e.oneClick);
    act(() => root.unmount());
    root = createRoot(host);
    stubFetch(() => PANEL({ domain: DOMAIN({ oneClickUrl: "https://dc.godaddy.com/v2/domainTemplates/providers/openlen.app/services/email/apply?x=1" }) }));
    await openTab();
    const a = [...host.querySelectorAll("a")].find((x) => x.textContent?.trim() === e.oneClick);
    expect(a?.getAttribute("href")).toContain("dc.godaddy.com");
  });

  it("a ready domain shows the month, the latest emails and the list, and an address can come off it", async () => {
    const ready = PANEL({
      domain: DOMAIN({ status: "ready", verifiedAt: "2026-10-20T10:00:00.000Z" }),
      usage: { month: "2026-10", sent: 1200, included: 1000, extraCenticredits: 3000 },
      recent: [{ toAddress: "ana@x.com", subject: "Tu pedido", kind: "app", status: "delivered", reason: null, createdAt: "2026-10-22T09:00:00.000Z" }],
      suppressions: [{ address: "beto@x.com", reason: "bounced", createdAt: "2026-10-21T09:00:00.000Z" }],
    });
    stubFetch(() => ready);
    await openTab();
    expect(text()).toContain(e.usage.replace("{sent}", "1200").replace("{included}", "1000"));
    expect(text()).toContain(e.extra.replace("{credits}", "30"));
    expect(text()).toContain("Tu pedido");
    expect(text()).toContain("beto@x.com");
    await click(button(e.unsuppress));
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ action: "unsuppress", address: "beto@x.com" });
  });

  it("disconnect asks to type the domain", async () => {
    stubFetch((c) => (c.method === "DELETE" ? PANEL() : PANEL({ domain: DOMAIN({ status: "ready" }) })));
    await openTab();
    await click(button(e.disconnect));
    const confirm = button(e.disconnectConfirm)!;
    expect(confirm.disabled).toBe(true);
    await type(host.querySelector<HTMLInputElement>("#email-disconnect")!, "taller.mx");
    expect(button(e.disconnectConfirm)!.disabled).toBe(false);
    await click(button(e.disconnectConfirm));
    expect(calls.some((c) => c.method === "DELETE")).toBe(true);
    // Afterwards: which lines it can take off its DNS.
    expect(text()).toContain(e.cleanupDns);
  });
});
