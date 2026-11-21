// @vitest-environment jsdom
// WHOSE CLOCK (spec local 2026-11-19-agentes-para-todos, §6.4, delivery 3): Len's chat reads Len's tasks; an agent's place
// reads only that agent's. Changing one still goes by its id.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { useScheduledTasks } from "./use-scheduled-tasks";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(() => {
  roots.splice(0).forEach((r) => act(() => r.unmount()));
  vi.unstubAllGlobals();
});

function Probe({ assistantId, onReady }: { assistantId?: string; onReady: (s: ReturnType<typeof useScheduledTasks>) => void }) {
  const s = useScheduledTasks("p1", false, assistantId);
  onReady(s);
  return null;
}

async function mount(assistantId?: string) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ tasks: [], events: [] })));
  vi.stubGlobal("fetch", fetchMock);
  let hook: ReturnType<typeof useScheduledTasks> | null = null;
  const root = createRoot(document.createElement("div"));
  roots.push(root);
  await act(async () => root.render(<Probe {...(assistantId ? { assistantId } : {})} onReady={(s) => (hook = s)} />));
  return { fetchMock, hook: () => hook! };
}

describe("useScheduledTasks", () => {
  it("🔴 Len's chat reads the project's list as before", async () => {
    const { fetchMock } = await mount();
    expect(String(fetchMock.mock.calls[0]![0])).toBe("/api/projects/p1/scheduled-tasks");
  });

  it("🔴 an agent's place reads only its own; changing one still goes by its id", async () => {
    const { fetchMock, hook } = await mount("a1");
    expect(String(fetchMock.mock.calls[0]![0])).toBe("/api/projects/p1/scheduled-tasks?assistantId=a1");
    await act(async () => void (await hook().remove("schedule-1")));
    expect(fetchMock.mock.calls.some(([url, init]) => String(url) === "/api/projects/p1/scheduled-tasks/schedule-1" && (init as RequestInit | undefined)?.method === "DELETE")).toBe(true);
  });
});
