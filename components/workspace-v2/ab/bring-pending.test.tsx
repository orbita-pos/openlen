// The publish that waits for a promoted A/B winner (review item 26): the owner brings it into the draft or discards it, and
// only then does the publish go on.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";

import modalsDeploy from "@/messages/en/modalsDeploy.json";

import { AbBringPending } from "./bring-pending";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const T = modalsDeploy.abBringPending;
const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

function answer(body: unknown, status = 200) {
  const calls: { url: string; method: string; body: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? "GET", body: String(init?.body ?? "") });
      return new Response(JSON.stringify(body), { status });
    }),
  );
  return calls;
}

async function mount() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  const p = { projectId: "p1", experimentId: "ab_promo0001", name: "Hero test", busy: false, onPublishAgain: vi.fn(), onCancel: vi.fn() };
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={{ modalsDeploy }}>
        <AbBringPending {...p} />
      </NextIntlClientProvider>,
    );
  });
  return { host, p };
}
const button = (host: HTMLElement, text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === text)!;
const click = async (b: HTMLButtonElement) => act(async () => {
  b.click();
  await new Promise((r) => setTimeout(r, 0));
});

describe("the publish that waits for a promoted winner", () => {
  it("says why it stopped, names the test, and offers both ways", async () => {
    answer({});
    const { host } = await mount();
    expect(host.textContent).toContain(T.title);
    expect(host.textContent).toContain("Hero test");
    expect(button(host, T.bring)).toBeDefined();
    expect(button(host, T.discard)).toBeDefined();
  });

  it("🔴 «Bring in, then publish» merges it and, if it came in, publishes again", async () => {
    const calls = answer({ ok: true, status: "brought" });
    const { host, p } = await mount();
    await click(button(host, T.bring));
    expect(calls[0]).toEqual({ url: "/api/projects/p1/ab/ab_promo0001/bring", method: "POST", body: JSON.stringify({ action: "retry" }) });
    expect(p.onPublishAgain).toHaveBeenCalledTimes(1);
  });

  it("it still clashes: nothing is published, and it says so", async () => {
    answer({ ok: true, status: "conflict", paths: ["/index.html"] });
    const { host, p } = await mount();
    await click(button(host, T.bring));
    expect(host.textContent).toContain(T.conflict);
    expect(p.onPublishAgain).not.toHaveBeenCalled();
  });

  it("Len is working: it is queued, and nothing is published", async () => {
    answer({ ok: true, status: "queued" });
    const { host, p } = await mount();
    await click(button(host, T.bring));
    expect(host.textContent).toContain(T.queued);
    expect(p.onPublishAgain).not.toHaveBeenCalled();
  });

  it("🔴 «Discard and publish» asks the server to discard it, then publishes", async () => {
    const calls = answer({ ok: true, status: "discarded" });
    const { host, p } = await mount();
    await click(button(host, T.discard));
    expect(JSON.parse(calls[0]!.body)).toEqual({ action: "discard" });
    expect(p.onPublishAgain).toHaveBeenCalledTimes(1);
  });

  it("a server error says it failed and publishes nothing", async () => {
    answer({ error: "invalid_state" }, 409);
    const { host, p } = await mount();
    await click(button(host, T.discard));
    expect(host.textContent).toContain(T.failed);
    expect(p.onPublishAgain).not.toHaveBeenCalled();
  });
});
