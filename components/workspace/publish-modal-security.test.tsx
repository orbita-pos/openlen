// @vitest-environment jsdom
//
// The publish dialog with the security review (spec local 2026-10-15): the
// review starts when it opens, what is serious holds the button back, and
// «Publicar igual» / «Arreglar con Len» do what they say. REAL Spanish texts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";

import modalsDomain from "@/messages/es/modalsDomain.json";
import panelsChat from "@/messages/es/panelsChat.json";

import { PublishModal } from "./publish-modal";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FP = "a".repeat(64);
const rls = { key: "rls_disabled:public.productos", source: "rule", severity: "HIGH", category: "rls_disabled", file: null, line: null, description: "", exploitScenario: "", recommendation: "", params: { table: "productos" } };
const blockedView = { fingerprint: FP, status: "done", blocking: [rls], medium: [], accepted: [] };

let root: Root;
let host: HTMLDivElement;
let publishBodies: Record<string, unknown>[];

beforeEach(() => {
  publishBodies = [];
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/security-review") && init?.method === "POST") return new Response(JSON.stringify({ view: blockedView }));
      if (url.endsWith("/publish") && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        publishBodies.push(body);
        return body.acceptSecurityFingerprint === FP
          ? new Response(JSON.stringify({ url: "https://tienda.openlen.app" }))
          : new Response(JSON.stringify({ error: "security_findings", ...blockedView }), { status: 428 });
      }
      return new Response("{}", { status: 404 });
    }),
  );
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const button = (label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);

async function render(onFixWithLen?: (text: string) => void, onClose = () => {}) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="es" messages={{ modalsDomain, panelsChat }}>
        <PublishModal
          open
          onClose={onClose}
          onSuccess={() => {}}
          {...(onFixWithLen ? { onFixWithLen } : {})}
          project={{ id: "p1", subdomain: "tienda", publishedAt: new Date(), hasUnpublishedChanges: true, languages: [] }}
        />
      </NextIntlClientProvider>,
    );
  });
  await settle();
}

describe("the publish dialog with the security review", () => {
  it("shows what blocks as soon as it opens, and the publish button looks disabled", async () => {
    await render();
    expect(host.textContent).toContain("La tabla productos no tiene RLS");
    const publish = button("Volver a publicar");
    expect(publish?.disabled).toBe(true);
  });

  it("«Publicar igual» publishes with the fingerprint it accepted and the language", async () => {
    await render();
    await act(async () => { button("Publicar igual")!.click(); });
    await settle();
    expect(publishBodies.at(-1)).toMatchObject({ acceptSecurityFingerprint: FP, locale: "es" });
  });

  it("«Arreglar con Len» hands Len the list and closes", async () => {
    const onFixWithLen = vi.fn();
    const onClose = vi.fn();
    await render(onFixWithLen, onClose);
    await act(async () => { button("Arreglar con Len")!.click(); });
    expect(onFixWithLen).toHaveBeenCalledWith("Arregla estos problemas de seguridad antes de publicar:\n- La tabla productos no tiene RLS");
    expect(onClose).toHaveBeenCalled();
  });

  it("without onFixWithLen there is no «Arreglar con Len»", async () => {
    await render();
    expect(button("Arreglar con Len")).toBeUndefined();
  });
});
