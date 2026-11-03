// LEN'S SUBAGENTS IN THE CHAT (spec local 2026-11-01-subagentes-de-len, §4.8): a card per child, live, with its
// type, how it goes, its steps and what it told Len; its ■ stops it. The launch's step is the card.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createTranslator } from "use-intl";
import { readFileSync } from "node:fs";
import es from "@/messages/es/panelsChat.json";

const spanish = createTranslator({ locale: "es", messages: es });

vi.mock("next-intl", () => ({
  useTranslations: () => (clave: string, v?: Record<string, unknown>) => clave.startsWith("subagent.worktree.")
    ? spanish(clave as never, v as never) : (v ? `${clave} ${JSON.stringify(v)}` : clave),
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
  it.each([
    [{ state: "working" }, "en su copia"],
    [{ state: "brought", files: ["/a", "/b"] }, "trajo 2 ficheros"],
    [{ state: "conflict", files: ["/a"], branch: "b" }, "chocó con tus cambios: lo suyo sigue en su rama"],
    [{ state: "kept", branch: "b" }, "no se pudo traer: lo suyo sigue en su rama"],
    [{ state: "kept", branch: "b", copyId: "copy" }, "no se pudo guardar: su copia se conserva para recuperarla"],
    [{ state: "nothing" }, null], [null, null],
  ])("an isolated child says where it works and what it brought (%j)", (worktree, want) => {
    subagentsLive.fromServer("p1", [{ ...RUN, worktree }]);
    const run = subagentsLive.snapshot().get("r1")!;
    const host = paint(<SubagentCard run={run} onStop={() => {}} />);
    expect(host.querySelector("[data-subagent-worktree]")?.textContent ?? null).toBe(want);
  });

  it("the worktree keys exist in all 10 locales", () => {
    for (const l of ["en", "es", "pt", "fr", "de", "it", "ja", "ko", "zh", "nl"]) {
      const messages = JSON.parse(readFileSync(`messages/${l}/panelsChat.json`, "utf8"));
      for (const key of ["working", "brought", "conflict", "kept"]) expect(messages.subagent.worktree?.[key]).toBeTruthy();
    }
  });

  it("live steps keep the copy's state until the outcome arrives", () => {
    subagentsLive.event("p1", { ...RUN, worktree: { state: "working" } });
    subagentsLive.event("p1", { id: "r1", status: "running", step: { tool: "Read", status: "done" } });
    expect(subagentsLive.snapshot().get("r1")?.worktree).toEqual({ state: "working" });
    subagentsLive.event("p1", { id: "r1", status: "completed", worktree: { state: "nothing" } });
    expect(subagentsLive.snapshot().get("r1")?.worktree).toEqual({ state: "nothing" });
  });
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

describe("a child's steps", () => {
  it("its own send_message reads as a message to Len", () => {
    const host = paint(<SubagentCard run={{ ...RUN, status: "completed", actions: [{ tool: "send_message", status: "done", summary: "" }] }} onStop={() => {}} />);
    act(() => host.querySelector<HTMLButtonElement>("button[aria-expanded]")!.click());
    expect(host.textContent).toContain("subagent.messageToLen");
    expect(host.textContent).not.toContain("agent.tool.send_message");
  });
});

describe("the subagents of a turn", () => {
  const launch = (id: string, preset: string, summary: string) => ({ tool: "subagent", status: "done" as const, summary, subagent: { id, preset } });
  const fork = (id: string, summary: string) => ({ tool: "subagent_fork", status: "done" as const, summary, subagent: { id, preset: "general-purpose" } });
  const woke = (id: string, preset: string, summary: string) => ({ tool: "send_message", status: "done" as const, summary, subagent: { id, preset } });
  const noRuns = () => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ runs: [] }), { status: 200 })));

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

  it("a fork's card says it inherits the conversation", () => {
    noRuns();
    const host = paint(<SubagentCards actions={[fork("r1", "Check the copy"), launch("r2", "general-purpose", "Fix")]} projectId="p1" rowId="row1" />);
    const cards = host.querySelectorAll("[data-subagent-card]");
    expect(cards).toHaveLength(2);
    expect(cards[0]!.textContent).toContain('subagent.title {"description":"Check the copy"}');
    expect(cards[0]!.querySelector("[data-subagent-forked]")!.textContent).toBe("subagent.forked");
    expect(cards[1]!.querySelector("[data-subagent-forked]")).toBeNull();
    // Its launch is its card, not a step.
    expect(visibleSteps([fork("r1", "Check the copy")])).toEqual([]);
  });

  it("the turn that woke a child shows its card, read by id: the run hangs from an earlier turn's row", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ runs: [{ id: "r1", preset: "general-purpose", description: "Fix the footer", status: "completed", actions: [], finalText: "Done.", toolUses: 3, durationMs: 900, forked: true }] }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const host = paint(<SubagentCards actions={[woke("r1", "general-purpose", "Fix the footer")]} projectId="p1" rowId="row2" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/agent/subagents?project=p1&row=row2&ids=r1", expect.anything());
    const card = host.querySelector("[data-subagent-card]")!;
    expect(card.querySelector("[data-subagent-status]")!.textContent).toBe("subagent.status.completed");
    // A forked run says so on every card, also on the one of the turn that woke it.
    expect(card.querySelector("[data-subagent-forked]")).not.toBeNull();
    // A message that woke a child is its card; one delivered to a working child (no run) stays a step.
    expect(visibleSteps([woke("r1", "general-purpose", "Fix"), { tool: "send_message", status: "done", summary: "" }]).map((a) => a.tool)).toEqual(["send_message"]);
  });

  it("a run launched and woken in the same turn has one card; a fork's keeps its chip", () => {
    noRuns();
    const host = paint(
      <SubagentCards
        actions={[launch("r1", "general-purpose", "Fix the footer"), woke("r1", "general-purpose", "Fix the footer"), fork("r2", "Check"), woke("r2", "general-purpose", "Check"), woke("r2", "general-purpose", "Check")]}
        projectId="p1"
        rowId="row1"
      />,
    );
    const cards = host.querySelectorAll("[data-subagent-card]");
    expect(cards).toHaveLength(2);
    expect(cards[0]!.querySelector("[data-subagent-forked]")).toBeNull();
    expect(cards[1]!.querySelector("[data-subagent-forked]")).not.toBeNull();
  });

  it("two cards of one run show the same status", () => {
    noRuns();
    const first = paint(<SubagentCards actions={[launch("r1", "general-purpose", "Fix the footer")]} projectId="p1" rowId="row1" />);
    const second = paint(<SubagentCards actions={[woke("r1", "general-purpose", "Fix the footer")]} projectId="p1" rowId="row2" />);
    act(() => subagentsLive.event("p1", { id: "r1", status: "running", description: "Fix the footer" }));
    act(() => subagentsLive.event("p1", { id: "r1", status: "completed" }));
    for (const host of [first, second]) expect(host.querySelector("[data-subagent-status]")!.textContent).toBe("subagent.status.completed");
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

it("a run that hit its turn limit says so", () => {
  const host = paint(<SubagentCard run={{ ...RUN, status: "turn_limit" as never }} onStop={() => {}} />);
  expect(host.querySelector("[data-subagent-status]")!.textContent).toBe("subagent.status.turn_limit");
});

it("a skill launch shows a subagent card instead of a tool step, including long custom names", () => {
  const name = "a".repeat(64);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ runs: [] }))));
  const action = { tool: "skill", status: "done" as const, summary: "summarize", subagent: { id: "r1", preset: name } };
  expect(visibleSteps([action])).toEqual([]);
  const host = paint(<SubagentCards actions={[action]} projectId="p1" rowId="row1" />);
  expect(host.querySelector("[data-subagent-card]")).not.toBeNull();
});
