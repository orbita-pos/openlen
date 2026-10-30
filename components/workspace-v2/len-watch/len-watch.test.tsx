// @vitest-environment jsdom
//
// LEN WATCH in the workspace, with the REAL Spanish texts and fetch faked: the notice over the chat
// (its button, a gate sending to Publish) and the switches in Publish (publishing alone waits for
// fixing alone). Manual react-dom + act() harness, like mensaje-del-equipo.test.tsx.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";

import modalsDeploy from "@/messages/es/modalsDeploy.json";
import panelsChat from "@/messages/es/panelsChat.json";
import type { LenWatchStatus } from "@/lib/len-watch/types";

import { LenWatchBanner } from "./len-watch-banner";
import { LenWatchSettings } from "./len-watch-settings";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SETTINGS = { autoFix: false, autoPublish: false, muted: false, locale: null };
const status = (incident: LenWatchStatus["incident"], isOwner = true): LenWatchStatus => ({ enabled: true, isOwner, settings: SETTINGS, incident });
const READY = { id: "i1", status: "fix_ready" as const, reason: null, summary: "Arreglado.", shipsUnpublished: true, createdAt: "2026-10-30T12:00:00.000Z" };

const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

function fakeFetch(get: LenWatchStatus, post?: { status: number; body: unknown }) {
  const calls: { url: string; method: string; body?: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? "GET", body: init?.body as string | undefined });
      if ((init?.method ?? "GET") === "GET") return new Response(JSON.stringify(get), { status: 200 });
      if (init?.method === "PUT") return new Response(JSON.stringify({ settings: { ...SETTINGS, ...JSON.parse(String(init.body)), locale: "es" } }), { status: 200 });
      return new Response(JSON.stringify(post?.body ?? {}), { status: post?.status ?? 200 });
    }),
  );
  return calls;
}

async function mount(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="es" messages={{ panelsChat, modalsDeploy }}>
        {node}
      </NextIntlClientProvider>,
    );
  });
  await act(async () => new Promise((r) => setTimeout(r, 0)));
  return host;
}

describe("the Len Watch notice", () => {
  it("shows nothing without an incident", async () => {
    fakeFetch(status(null));
    const host = await mount(<LenWatchBanner projectId="p1" />);
    expect(host.querySelector("[data-len-watch-banner]")).toBeNull();
  });

  it("🔴 a fix waiting: says what would go out, and a gate sends to Publish", async () => {
    const calls = fakeFetch(status(READY), { status: 428, body: { error: "security_findings" } });
    const onOpenPublish = vi.fn();
    const host = await mount(<LenWatchBanner projectId="p1" onOpenPublish={onOpenPublish} />);
    const banner = host.querySelector('[data-len-watch-banner="ready"]');
    expect(banner?.textContent).toContain(panelsChat.lenWatch.ready);
    expect(banner?.textContent).toContain(panelsChat.lenWatch.shipsUnpublished);
    const button = [...host.querySelectorAll("button")].find((b) => b.textContent === panelsChat.lenWatch.approve)!;
    await act(async () => button.click());
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(calls.some((c) => c.method === "POST" && c.url === "/api/projects/p1/len-watch/approve")).toBe(true);
    expect(onOpenPublish).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain(panelsChat.lenWatch.review);
  });

  it("🔴 the draft changed after Len's fix: says so, and «Publish anyway» confirms it", async () => {
    const calls = fakeFetch(status(READY), { status: 409, body: { error: "changed_since_fix" } });
    const host = await mount(<LenWatchBanner projectId="p1" />);
    await act(async () => [...host.querySelectorAll("button")].find((b) => b.textContent === panelsChat.lenWatch.approve)!.click());
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(host.textContent).toContain(panelsChat.lenWatch.changed);
    await act(async () => [...host.querySelectorAll("button")].find((b) => b.textContent === panelsChat.lenWatch.publishAnyway)!.click());
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    const posts = calls.filter((c) => c.method === "POST");
    expect(posts.map((c) => c.body && JSON.parse(c.body))).toEqual([{}, { confirmChanged: true }]);
  });

  it("a reader sees the notice but no button", async () => {
    fakeFetch(status({ ...READY, status: "needs_owner" }));
    const host = await mount(<LenWatchBanner projectId="p1" soloLectura />);
    expect(host.querySelector('[data-len-watch-banner="down"]')).toBeTruthy();
    expect(host.querySelector("button")).toBeNull();
  });
});

// Spec §5.5: Len published a fix from its branch; the draft doesn't have it until the owner brings it in.
describe("«Traer el arreglo» over the chat", () => {
  const FIX = modalsDeploy.lenWatch.fixPending;
  /** The state answers with the pending fix until it has been brought. */
  function bringFetch(answer: string) {
    let brought = false;
    const calls: { url: string; method: string; body?: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, method: init?.method ?? "GET", body: init?.body as string | undefined });
        if ((init?.method ?? "GET") === "GET") return new Response(JSON.stringify({ ...status(null), pendingFix: brought ? null : { incidentId: "i1", branch: "len-watch/i1" } }), { status: 200 });
        if (answer === "brought") brought = true;
        return new Response(JSON.stringify({ status: answer }), { status: 200 });
      }),
    );
    return calls;
  }
  const bringButton = (host: HTMLElement) => [...host.querySelectorAll("button")].find((b) => b.textContent === FIX.bring)!;

  it("with a fix to bring, the banner offers «Traer el arreglo», and once brought, it goes", async () => {
    const calls = bringFetch("brought");
    const host = await mount(<LenWatchBanner projectId="p1" />);
    expect(host.querySelector('[data-len-watch-banner="bring"]')).toBeTruthy();
    expect(host.textContent).toContain(FIX.title);
    await act(async () => {
      bringButton(host).click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(calls.find((c) => c.method === "POST")).toEqual({ url: "/api/projects/p1/len-watch/bring", method: "POST", body: JSON.stringify({ incidentId: "i1" }) });
    expect(host.querySelector("[data-len-watch-banner]")).toBeNull();
  });

  it("handed to Len: the banner says Len is bringing it in", async () => {
    bringFetch("handed_to_len");
    const host = await mount(<LenWatchBanner projectId="p1" />);
    await act(async () => {
      bringButton(host).click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(host.textContent).toContain(FIX.handedToLen);
  });
});

describe("the Len Watch switches", () => {
  it("publishing alone stays off until fixing alone is on; a change goes out with the interface language", async () => {
    const calls = fakeFetch(status(null));
    const host = await mount(<LenWatchSettings projectId="p1" />);
    const boxes = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(boxes.map((b) => [b.checked, b.disabled])).toEqual([[true, false], [false, false], [false, true]]);
    await act(async () => boxes[1]!.click());
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    const put = calls.find((c) => c.method === "PUT")!;
    expect(JSON.parse(put.body!)).toEqual({ autoFix: true, locale: "es" });
    expect(host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[2]!.disabled).toBe(false);
  });

  it("someone who isn't the owner can't touch them", async () => {
    fakeFetch(status(null, false));
    const host = await mount(<LenWatchSettings projectId="p1" />);
    expect([...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].every((b) => b.disabled)).toBe(true);
    expect(host.textContent).toContain(modalsDeploy.lenWatch.ownerOnly);
  });
});
