// The publish that waits for the Len Watch fix (spec local 2026-10-30-len-watch, §5.5 step 5): the fix Len published
// from its branch isn't in the draft yet, so publishing would bring the crash back. «Traer el arreglo» brings it and
// publishes again; «Publicar igual» publishes without it.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";

import modalsDeploy from "@/messages/es/modalsDeploy.json";
import { onFolderChanged } from "@/lib/lienzo/carpeta-cambiada";

import { LenWatchFixPending } from "./fix-pending";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const T = modalsDeploy.lenWatch.fixPending;
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

async function mount(props: Partial<React.ComponentProps<typeof LenWatchFixPending>> = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  const p = { projectId: "p1", incidentId: "i1", busy: false, onPublishAgain: vi.fn(), onPublishAnyway: vi.fn(), onCancel: vi.fn(), ...props };
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="es" messages={{ modalsDeploy }}>
        <LenWatchFixPending {...p} />
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

describe("the publish that waits for the Len Watch fix", () => {
  it("says why it stopped and offers both ways", async () => {
    answer({});
    const { host } = await mount();
    expect(host.textContent).toContain(T.title);
    expect(button(host, T.bring)).toBeDefined();
    expect(button(host, T.publishAnyway)).toBeDefined();
  });

  it("«Traer el arreglo» brings it in, then publishes again", async () => {
    const calls = answer({ status: "brought" });
    const { host, p } = await mount();
    await click(button(host, T.bring));
    expect(calls[0]).toEqual({ url: "/api/projects/p1/len-watch/bring", method: "POST", body: JSON.stringify({ incidentId: "i1" }) });
    expect(p.onPublishAgain).toHaveBeenCalledTimes(1);
  });

  it("🔴 a fix brought in tells the workspace its folder changed (the canvas, the notice over the chat)", async () => {
    answer({ status: "brought" });
    const changed = vi.fn();
    const stop = onFolderChanged("p1", changed);
    try {
      const { host } = await mount();
      await click(button(host, T.bring));
      expect(changed.mock.calls).toEqual([[{ outside: true }]]);
    } finally {
      stop();
    }
  });

  it("it collided: Len brings it in, and nothing is published yet", async () => {
    answer({ status: "handed_to_len" });
    const { host, p } = await mount();
    await click(button(host, T.bring));
    expect(host.textContent).toContain(T.handedToLen);
    expect(p.onPublishAgain).not.toHaveBeenCalled();
  });

  it("«Publicar igual» publishes without it, and asks the server nothing", async () => {
    const calls = answer({});
    const { host, p } = await mount();
    await click(button(host, T.publishAnyway));
    expect(p.onPublishAnyway).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(0);
  });
});
