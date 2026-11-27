// @vitest-environment jsdom
//
// La tarjeta de publicar de Len y la app del escritorio (spec local 2026-11-26-apps-en-el-escritorio, §5): hay UNA
// producción, la del sitio y la de la app instalada, y publicar migra lo que usa la versión congelada del escritorio.
// Así que la tarjeta —que es el diálogo de publicar de `publish`— lo dice igual que `PublishModal` cuando alguien tiene la
// app instalada, y calla cuando nadie. Textos REALES en español.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";

import wsPage from "@/messages/es/wsPage.json";
import modalsDomain from "@/messages/es/modalsDomain.json";
import panelsChat from "@/messages/es/panelsChat.json";
import { AgentConfirmCard, type AgentConfirm } from "./agent-confirm-card";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let urls: string[];
let root: Root;
let host: HTMLDivElement;

function stubFetch(reply: (url: string) => { status: number; body: unknown }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      urls.push(url);
      const r = reply(url);
      return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
    }),
  );
}

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const NOTICE = panelsChat.desktopInstall.publishNotice;

async function render(props: { esApp?: boolean } = {}) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="es" messages={{ wsPage, modalsDomain, panelsChat }}>
        <AgentConfirmCard projectId="p1" confirm={BASE} onPublished={() => {}} {...props} />
      </NextIntlClientProvider>,
    );
  });
  await settle();
}

const BASE: AgentConfirm = { action: "publish", subdominio: "tienda", idiomas: [], republicar: true };

beforeEach(() => {
  urls = [];
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("la tarjeta de publicar de Len y la app del escritorio", () => {
  it("Len's publish card shows the desktop notice when a desktop app exists", async () => {
    stubFetch(() => ({ status: 200, body: { installed: true } }));
    await render();
    // La pregunta es la de quien publica (`?for=publish`), no la lectura del dueño.
    expect(urls).toEqual(["/api/projects/p1/desktop?for=publish"]);
    expect(NOTICE).toBe("La app de tu escritorio usa estos mismos datos.");
    expect(host.textContent).toContain(NOTICE);
    expect(host.querySelector("[data-desktop-notice]")).not.toBeNull();
  });

  it("Len's publish card shows no desktop notice when none exists", async () => {
    stubFetch(() => ({ status: 200, body: { installed: false } }));
    await render();
    expect(urls).toEqual(["/api/projects/p1/desktop?for=publish"]);
    expect(host.textContent).not.toContain(NOTICE);
    expect(host.querySelector("[data-desktop-notice]")).toBeNull();
  });

  it("no answer is no notice (a 404: no access, or the switch is off)", async () => {
    stubFetch(() => ({ status: 404, body: { error: "not_found" } }));
    await render();
    expect(urls).toEqual(["/api/projects/p1/desktop?for=publish"]);
    expect(host.textContent).not.toContain(NOTICE);
  });

  it("a page (not an app) never asks", async () => {
    stubFetch(() => ({ status: 200, body: { installed: true } }));
    await render({ esApp: false });
    expect(urls).toEqual([]);
    expect(host.textContent).not.toContain(NOTICE);
  });
});
