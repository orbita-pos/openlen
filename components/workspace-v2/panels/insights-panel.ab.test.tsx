// The Insights panel's A/B card (review item 29): an answer that lands after the person switched projects is not drawn, and
// the pinned card of a test the harm brake stopped can be put away.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";

import panelsB from "@/messages/en/panelsB.json";
import panelsChat from "@/messages/en/panelsChat.json";

vi.mock("../insights-sparkline", () => ({ Sparkline: () => null }));
vi.mock("./page-coach", () => ({ PageCoach: () => null, FunnelBar: () => null }));
vi.mock("../ab/ab-experiment-card", () => ({ AbExperimentCard: ({ experiment }: { experiment: { id: string } }) => <div data-pinned={experiment.id} /> }));

import { InsightsPanel } from "./insights-panel";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
type Deferred = { resolve: (body: unknown) => void };
let abAnswers: Record<string, Deferred>;

const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
const view = (id: string, over: Record<string, unknown> = {}) => ({ id, projectId: "p", name: id, targetPath: "/", status: "draft", decisionStatus: "none", bringState: null, endedAt: null, ...over });

function stubFetch() {
  abAnswers = {};
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      const ab = /\/api\/projects\/([^/]+)\/ab$/.exec(url);
      if (ab) {
        return new Promise<Response>((resolve) => {
          abAnswers[ab[1]!] = { resolve: (body) => resolve(new Response(JSON.stringify(body), { status: 200 })) };
        });
      }
      // The page numbers are not this test's business: they never arrive, the panel shows its skeleton, the A/B card is independent.
      if (url.includes("/insights") || url.includes("/funnel")) return new Promise<Response>(() => {});
      return Promise.resolve(new Response("{}", { status: 404 }));
    }),
  );
}

let root: Root;
let host: HTMLElement;
const render = (projectId: string) =>
  act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={{ panelsB, panelsChat }}>
        <InsightsPanel currentProjectId={projectId} />
      </NextIntlClientProvider>,
    );
  });

beforeEach(() => {
  stubFetch();
  window.localStorage.clear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  roots.push(root);
});
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("InsightsPanel's A/B card", () => {
  it("🔴 an answer for the project the person LEFT is not drawn over the one they are on", async () => {
    await render("p1");
    await render("p2");
    // p2 answers first, p1's (slower) answer lands afterwards
    await act(async () => abAnswers.p2!.resolve({ enabled: true, active: view("ab_of_p2"), experiments: [] }));
    await act(async () => abAnswers.p1!.resolve({ enabled: true, active: view("ab_of_p1"), experiments: [] }));
    expect(host.querySelector('[data-pinned="ab_of_p2"]')).not.toBeNull();
    expect(host.querySelector('[data-pinned="ab_of_p1"]')).toBeNull();
  });

  it("🔴 the pinned card of a test the harm brake stopped can be put away, and stays away", async () => {
    const harm = view("ab_harm0001", { status: "paused_harm", decisionStatus: "resolved", endedAt: ago(2), winnerVariant: "a" });
    await render("p1");
    await act(async () => abAnswers.p1!.resolve({ enabled: true, active: null, experiments: [harm] }));
    expect(host.querySelector('[data-ab-decision-card="ab_harm0001"]')).not.toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>("[data-ab-dismiss]")!.click());
    expect(host.querySelector('[data-ab-decision-card="ab_harm0001"]')).toBeNull();

    // A new visit to the panel doesn't bring it back.
    act(() => root.unmount());
    roots.pop();
    root = createRoot(host);
    roots.push(root);
    stubFetch();
    await render("p1");
    await act(async () => abAnswers.p1!.resolve({ enabled: true, active: null, experiments: [harm] }));
    expect(host.querySelector('[data-ab-decision-card="ab_harm0001"]')).toBeNull();
  });

  it("a harm stop older than 14 days is not pinned at all; a winner still to bring in is, and can't be put away", async () => {
    await render("p1");
    await act(async () =>
      abAnswers.p1!.resolve({
        enabled: true,
        active: null,
        experiments: [view("ab_old", { status: "paused_harm", endedAt: ago(30) }), view("ab_promoted", { status: "promoted_b", bringState: "conflict" })],
      }),
    );
    expect(host.querySelector('[data-ab-decision-card="ab_old"]')).toBeNull();
    expect(host.querySelector('[data-pinned="ab_promoted"]')).not.toBeNull();
    expect(host.querySelector("[data-ab-dismiss]")).toBeNull();
  });
});
