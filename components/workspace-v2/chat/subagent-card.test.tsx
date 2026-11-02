// LEN'S SUBAGENTS IN THE CHAT (spec local 2026-11-01-subagentes-de-len, §4.8): a card per child, live, with its
// type, how it goes, its steps and what it told Len; its ■ stops it. The launch's step is the card.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next-intl", () => ({
  useTranslations: () => (clave: string, v?: Record<string, unknown>) => (v ? `${clave} ${JSON.stringify(v)}` : clave),
  useLocale: () => "es",
}));

import { SubagentCard, SubagentCards } from "./subagent-card";
import { subagentsLive, type SubagentRunView } from "./subagents-live";
import { LiveBar } from "./live-bar";
import { UserMessage } from "./chat-turn";
import { visibleSteps } from "./steps-card";
import { restoreTurn } from "./use-agent-chat";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
  subagentsLive.forget();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function paint(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(node));
  return host;
}

const RUN: SubagentRunView = {
  id: "r1", projectId: "p1", preset: "Explore", description: "Find the menu", status: "running",
  actions: [{ tool: "Read", status: "done", summary: "/menu/index.html" }], finalText: null, toolUses: 1, durationMs: null,
};

describe("a subagent's card", () => {
  it("while it runs: its description, its type, «working» and the ■, which stops it", () => {
    const onStop = vi.fn();
    const host = paint(<SubagentCard run={RUN} onStop={onStop} />);
    expect(host.textContent).toContain('subagent.title {"description":"Find the menu"}');
    expect(host.querySelector("[data-subagent-preset]")!.textContent).toBe("Explore");
    expect(host.querySelector("[data-subagent-status]")!.textContent).toBe("subagent.status.running");
    const stop = host.querySelector<HTMLButtonElement>('button[aria-label="subagent.stop"]')!;
    act(() => stop.click());
    expect(onStop).toHaveBeenCalledWith("r1");
  });

  it("a general-purpose one has no type chip", () => {
    const host = paint(<SubagentCard run={{ ...RUN, preset: "general-purpose" }} onStop={() => {}} />);
    expect(host.querySelector("[data-subagent-preset]")).toBeNull();
  });

  it("once it ended: no ■; opened, its steps and what it told Len", () => {
    const host = paint(<SubagentCard run={{ ...RUN, status: "completed", finalText: "In /menu/index.html:12." }} onStop={() => {}} />);
    expect(host.querySelector('button[aria-label="subagent.stop"]')).toBeNull();
    expect(host.textContent).not.toContain("/menu/index.html:12.");
    act(() => host.querySelector<HTMLButtonElement>("button[aria-expanded]")!.click());
    expect(host.textContent).toContain("/menu/index.html");
    expect(host.textContent).toContain("subagent.closing");
    expect(host.textContent).toContain("In /menu/index.html:12.");
  });
});

describe("the subagents of a turn", () => {
  const launch = (id: string, preset: string, summary: string) => ({ tool: "subagent", status: "done" as const, summary, subagent: { id, preset } });

  it("the launch's step is its card, not a step", () => {
    expect(visibleSteps([launch("r1", "Explore", "Find"), { tool: "Read", status: "done", summary: "a" }]).map((a) => a.tool)).toEqual(["Read"]);
    // A launch that was refused (no run) stays a step: it says why.
    expect(visibleSteps([{ tool: "subagent", status: "error", summary: "Find" }]).map((a) => a.tool)).toEqual(["subagent"]);
  });

  it("each launch gets a card, read from the server; the bar counts the ones still working", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          runs: [
            { id: "r1", preset: "Explore", description: "Find the menu", status: "completed", actions: [], finalText: "In /a.", toolUses: 2, durationMs: 900 },
            { id: "r2", preset: "general-purpose", description: "Fix the footer", status: "running", actions: [], finalText: null, toolUses: 0, durationMs: null },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const host = paint(<SubagentCards actions={[launch("r1", "Explore", "Find the menu"), launch("r2", "general-purpose", "Fix the footer")]} projectId="p1" rowId="row1" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/agent/subagents?project=p1&row=row1", expect.anything());
    const cards = host.querySelectorAll("[data-subagent-card]");
    expect(cards).toHaveLength(2);
    expect(cards[0]!.querySelector("[data-subagent-status]")!.textContent).toBe("subagent.status.completed");
    expect(subagentsLive.runningCount("p1")).toBe(1);
    // Re-read every 3 s while one is still running.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const bar = paint(<LiveBar status={{ kind: "idle", face: "reposo" }} onStop={() => {}} subagentsRunning={1} />);
    expect(bar.textContent).toContain('subagent.liveBar {"n":1}');
  });

  it("its ■ asks the server to stop that one", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ stopped: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    subagentsLive.fromServer("p1", [{ ...RUN, actions: [] }]);
    const host = paint(<SubagentCards actions={[launch("r1", "Explore", "Find the menu")]} projectId="p1" rowId="row1" />);
    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[aria-label="subagent.stop"]')!.click();
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/agent/subagents/r1/stop", expect.objectContaining({ method: "POST" }));
  });

  it("the turn that brings their results back says so", () => {
    const turn = restoreTurn({ id: "n1", userText: "", assistantReasoning: "", status: "applied", appliedAt: 0, origen: { kind: "subagents", ids: ["r1"] } });
    const host = paint(<UserMessage turn={turn} initial="A" />);
    expect(host.querySelector("[data-subagents-turn]")!.textContent).toContain("turn.fromSubagents");
  });
});
