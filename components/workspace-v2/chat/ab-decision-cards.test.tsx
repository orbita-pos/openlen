// The chat's A/B cards (review item 28): with A/B testing off they ask ONE thing, once (GET /api/ab), and never poll;
// with it on they load and look again every five minutes — not every minute.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("../ab/ab-experiment-card", () => ({ AbExperimentCard: () => null }));
vi.mock("../ab/ab-decision-card", () => ({
  AbDecisionCard: ({ experiment, onDismiss }: { experiment: { id: string; status: string }; onDismiss?: () => void }) => (
    <div data-card={experiment.id}>{experiment.status === "paused_harm" && onDismiss ? <button data-dismiss="" onClick={onDismiss} /> : null}</div>
  ),
}));

import { AB_POLL_MS, AbDecisionCards } from "./ab-decision-cards";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
let calls: string[] = [];

function server(abOn: boolean, experiments: unknown[] = [{ id: "ab_1", status: "winner_ready", decisionStatus: "pending", bringState: null, endedAt: null }]) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls.push(url);
      if (url === "/api/ab") return new Response(JSON.stringify(abOn ? { available: true } : { error: "ab_off" }), { status: abOn ? 200 : 404 });
      return new Response(JSON.stringify({ enabled: true, experiments }), { status: 200 });
    }),
  );
}

async function mount() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(<AbDecisionCards projectId="p1" busy={false} />);
  });
  return host;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("AbDecisionCards — a harm stop put away", () => {
  const harm = { id: "ab_harm", status: "paused_harm", decisionStatus: "resolved", bringState: null, endedAt: new Date(Date.now() - 86_400_000).toISOString() };

  it("🔴 the card of a test the harm brake stopped shows, can be put away, and stays away after a reload", async () => {
    window.localStorage.clear();
    server(true, [harm]);
    const host = await mount();
    await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
    expect(host.querySelector('[data-card="ab_harm"]')).not.toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>("[data-dismiss]")!.click());
    expect(host.querySelector('[data-card="ab_harm"]')).toBeNull();

    document.body.innerHTML = "";
    server(true, [harm]);
    const again = await mount();
    await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
    expect(again.querySelector('[data-card="ab_harm"]')).toBeNull();
  });
});

describe("AbDecisionCards", () => {
  it("🔴 A/B testing off: it asks once whether it is on, draws nothing and never polls the project", async () => {
    server(false);
    const host = await mount();
    await act(async () => void (await vi.advanceTimersByTimeAsync(30 * 60_000)));
    expect(calls).toEqual(["/api/ab"]);
    expect(host.querySelector("[data-card]")).toBeNull();
  });

  it("🔴 A/B testing on: it loads at once and looks again every FIVE minutes", async () => {
    expect(AB_POLL_MS).toBe(5 * 60_000);
    server(true);
    const host = await mount();
    await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
    const projectCalls = () => calls.filter((c) => c.startsWith("/api/projects/p1/ab")).length;
    expect(projectCalls()).toBe(1);
    expect(host.querySelector('[data-card="ab_1"]')).not.toBeNull();
    await act(async () => void (await vi.advanceTimersByTimeAsync(4 * 60_000)));
    expect(projectCalls()).toBe(1); // a minute-by-minute poll would be at 5 by now
    await act(async () => void (await vi.advanceTimersByTimeAsync(61_000)));
    expect(projectCalls()).toBe(2);
  });
});
