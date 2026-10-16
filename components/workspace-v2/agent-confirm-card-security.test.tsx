// @vitest-environment jsdom
//
// Len's publish card with the security review (spec local 2026-10-15): what
// Len was told first now reaches the owner, who decides. REAL Spanish texts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";

import wsPage from "@/messages/es/wsPage.json";
import modalsDomain from "@/messages/es/modalsDomain.json";
import panelsChat from "@/messages/es/panelsChat.json";
import type { Finding } from "@/lib/security-review/types";

import { AgentConfirmCard, type AgentConfirm } from "./agent-confirm-card";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FP = "b".repeat(64);
const rls: Finding = { key: "rls_disabled:public.productos", source: "rule", severity: "HIGH", category: "rls_disabled", file: null, line: null, description: "", exploitScenario: "", recommendation: "", params: { table: "productos" } };
const testKey: Finding = { key: "k4", source: "rule", severity: "MEDIUM", category: "test_secret_in_client", file: "/js/p.js", line: 4, description: "", exploitScenario: "", recommendation: "", params: { provider: "Stripe" } };
const BASE: AgentConfirm = { action: "publish", subdominio: "tienda", idiomas: [], republicar: true };

type Call = { url: string; body: Record<string, unknown> | undefined };
let calls: Call[];
let root: Root;
let host: HTMLDivElement;

function stubFetch(reply: (c: Call, publishN: number) => { status: number; body: unknown }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const c: Call = { url, body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined };
      calls.push(c);
      const r = reply(c, calls.filter((x) => x.url.endsWith("/publish")).length);
      return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
    }),
  );
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

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const button = (label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);

async function render(confirm: AgentConfirm) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="es" messages={{ wsPage, modalsDomain, panelsChat }}>
        <AgentConfirmCard projectId="p1" confirm={confirm} onPublished={() => {}} />
      </NextIntlClientProvider>,
    );
  });
  await settle();
}

describe("Len's publish card with the security review", () => {
  it("🔴 with what Len was told, the owner sees it and only «Publicar igual» publishes, with the fingerprint", async () => {
    stubFetch(() => ({ status: 200, body: { url: "https://tienda.openlen.app" } }));
    await render({ ...BASE, seguridad: { fingerprint: FP, blocking: [rls], medium: [] } });
    expect(host.textContent).toContain("La tabla productos no tiene RLS");
    expect(button("Publicar")).toBeUndefined();
    await act(async () => { button("Publicar igual")!.click(); });
    await settle();
    expect(calls.find((c) => c.url.endsWith("/publish"))?.body).toMatchObject({ acceptSecurityFingerprint: FP, locale: "es" });
  });

  it("a 428 security_findings from the route turns the card into the findings", async () => {
    stubFetch((_c, n) => (n === 1 ? { status: 428, body: { error: "security_findings", fingerprint: FP, status: "done", blocking: [rls], medium: [], accepted: [] } } : { status: 200, body: { url: "https://tienda.openlen.app" } }));
    await render(BASE);
    await act(async () => { button("Publicar")!.click(); });
    await settle();
    expect(host.textContent).toContain("La tabla productos no tiene RLS");
    await act(async () => { button("Publicar igual")!.click(); });
    await settle();
    expect(calls.filter((c) => c.url.endsWith("/publish")).at(-1)?.body).toMatchObject({ acceptSecurityFingerprint: FP });
  });

  it("warnings only: shown in amber, and the usual Publicar is there", async () => {
    stubFetch(() => ({ status: 200, body: {} }));
    await render({ ...BASE, seguridad: { fingerprint: FP, blocking: [], medium: [testKey] } });
    expect(host.textContent).toContain("Avisos de seguridad");
    expect(button("Publicar")).toBeDefined();
  });
});
