// «Lanzar 50/50» in the A vs B dialog (seen in production on 23/11): the first press met variant B's security review
// still running and the dialog printed «Security review requires attention before launching Variant B.» — English, in the
// Spanish interface, and worded as a finding. Now it waits for the review like Publish does and launches by itself; a real
// finding is said in the person's language.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";

import es from "@/messages/es/panelsChat.json";
import type { AbExperimentView } from "@/lib/ab/types";

import { AbCompareModal } from "./ab-compare-modal";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FP = "f".repeat(64);
const ENGLISH = "Security review requires attention before launching Variant B.";
const draft = { id: "ab_1", projectId: "p1", name: "Titular", hypothesis: "", status: "draft" } as unknown as AbExperimentView;
const running = { ...draft, status: "running" } as unknown as AbExperimentView;

const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

/** The server: the launch answers each of `launches` in turn; the review answers `done` when asked. */
function server(launches: { status: number; body: unknown }[]) {
  const asked: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    asked.push(`${init?.method ?? "GET"} ${url}`);
    if (url.includes("/security-review")) {
      return new Response(JSON.stringify({ view: { fingerprint: FP, status: "done", blocking: [], medium: [], accepted: [] } }), { status: 200 });
    }
    const r = launches.shift()!;
    return new Response(JSON.stringify(r.body), { status: r.status });
  }));
  return asked;
}

async function mount() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  const onUpdated = vi.fn();
  const onClose = vi.fn();
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="es" messages={{ panelsChat: es }}>
        <AbCompareModal experiment={draft} onClose={onClose} onUpdated={onUpdated} />
      </NextIntlClientProvider>,
    );
  });
  return { host, onUpdated, onClose };
}

async function pressLaunch(host: HTMLElement) {
  await act(async () => {
    (host.querySelector("[data-ab-launch]") as HTMLButtonElement).click();
  });
  // Let the waits and the second launch settle.
  for (let i = 0; i < 10; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
}

describe("«Lanzar 50/50» and the security review", () => {
  it("a review still running is waited for and the test launches without a second press", async () => {
    const asked = server([
      { status: 428, body: { error: "security_review_pending", message: ENGLISH, fingerprint: FP } },
      { status: 200, body: { experiment: running } },
    ]);
    const { host, onUpdated, onClose } = await mount();
    await pressLaunch(host);
    expect(onUpdated).toHaveBeenCalledWith(running);
    expect(onClose).toHaveBeenCalled();
    expect(host.textContent).not.toContain(ENGLISH);
    expect(asked.filter((a) => a.startsWith("POST") && a.endsWith("/launch"))).toHaveLength(2);
  });

  it("a finding is said in the person's language, never as the server's English sentence", async () => {
    server([{ status: 428, body: { error: "security_findings", message: ENGLISH, fingerprint: FP, blocking: [{ key: "k" }] } }]);
    const { host, onUpdated } = await mount();
    await pressLaunch(host);
    expect(onUpdated).not.toHaveBeenCalled();
    const alert = host.querySelector("[role=alert]")?.textContent ?? "";
    expect(alert).toBe(es.ownAssistant.ab.securityFindings);
    expect(host.textContent).not.toContain(ENGLISH);
  });

  it("any other refusal is the translated failure, not the server's sentence", async () => {
    server([{ status: 409, body: { error: "base_moved", message: "The published page changed since Variant B was made." } }]);
    const { host } = await mount();
    await pressLaunch(host);
    expect(host.querySelector("[role=alert]")?.textContent).toBe(es.ownAssistant.ab.failed);
  });
});
