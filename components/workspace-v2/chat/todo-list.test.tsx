import { afterEach, describe, expect, it, vi } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, v?: Record<string, unknown>) => (v ? `${key} ${JSON.stringify(v)}` : key),
  useLocale: () => "es",
}));

import type { TodoItem } from "@/lib/agent/todo-list";
import { LenTurn } from "./chat-turn";
import { visibleSteps } from "./steps-card";
import { TodoListView, continueStep, rowState } from "./todo-list";
import type { DesignTurn } from "./use-agent-chat";
import type { EtiquetasDeRespuesta } from "../agent-reply-card";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
});
function mount(node: ReactNode) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(node));
  return host;
}

const list: TodoItem[] = [
  { content: "Home page", status: "completed" },
  { content: "Menu page", status: "in_progress" },
  { content: "Gallery", status: "pending" },
];

describe("rowState", () => {
  it("an in-progress step is active while streaming and half-done once the turn closed", () => {
    expect(rowState(list[1]!, true)).toBe("active");
    expect(rowState(list[1]!, false)).toBe("halfDone");
    expect(rowState(list[0]!, false)).toBe("done");
    expect(rowState(list[2]!, false)).toBe("pending");
  });
});

describe("continueStep — the four conditions", () => {
  const ok = { todos: list, isLast: true, status: "applied", cortado: false, goalRunsOn: false };
  it("names the step left half-done before the next pending one", () => {
    expect(continueStep(ok)).toEqual({ content: "Menu page", status: "in_progress" });
  });
  it("no button if it is not the last turn, did not close well, was cut, or a goal runs on", () => {
    expect(continueStep({ ...ok, isLast: false })).toBeNull();
    expect(continueStep({ ...ok, status: "error" })).toBeNull();
    expect(continueStep({ ...ok, status: "streaming" })).toBeNull();
    expect(continueStep({ ...ok, cortado: true })).toBeNull();
    expect(continueStep({ ...ok, goalRunsOn: true })).toBeNull();
  });
  // Seen on the first real turn (15/10): Len closed with the list AND an
  // ask_user_question card asking the same thing — two ways to say yes.
  it("no button when the turn ended asking the owner a question: the question card answers it", () => {
    expect(continueStep({ ...ok, endedOnQuestion: true })).toBeNull();
  });
  it("no button when everything is done or the list is empty", () => {
    expect(continueStep({ ...ok, todos: [{ content: "a", status: "completed" }] })).toBeNull();
    expect(continueStep({ ...ok, todos: [] })).toBeNull();
    expect(continueStep({ ...ok, todos: null })).toBeNull();
  });
});

describe("TodoListView", () => {
  it("shows every step with its state, the half-done mark and the progress line", () => {
    const host = mount(<TodoListView todos={list} streaming={false} />);
    expect(host.querySelectorAll("li")).toHaveLength(3);
    expect(host.querySelector('li[data-state="halfDone"]')?.textContent).toContain("newChat.todos.halfDone");
    expect(host.textContent).toContain('newChat.todos.progress {"done":1,"total":3}');
  });

  it("the continue button sends the message that names the step", () => {
    const sent: string[] = [];
    const host = mount(<TodoListView todos={list} streaming={false} continueWith={list[1]!} onContinue={(t) => sent.push(t)} />);
    const button = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("newChat.todos.continue "));
    expect(button?.textContent).toContain("Menu page");
    act(() => button!.click());
    expect(sent).toEqual(['newChat.todos.continueMessage {"step":"Menu page"}']);
  });

  it("on a phone it folds to the progress line and opens with a tap", () => {
    const host = mount(<TodoListView todos={list} streaming={false} />);
    const toggle = host.querySelector("button[aria-expanded]") as HTMLButtonElement;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelector("ol")?.className).toContain("hidden");
    act(() => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector("ol")?.className).not.toMatch(/(^|\s)hidden(\s|$)/);
  });
});

describe("the list in Len's turn", () => {
  const nothing = () => {};
  // A turn whose only calls are todo_write changed no document, like a real one.
  const turn = (extra: Partial<DesignTurn>) =>
    ({ id: "t", userText: "six pages", assistantReasoning: "Done 3 of 6.", status: "applied", noDocChange: true, ...extra }) as DesignTurn;
  const render = (t: DesignTurn, extra: { goalRunsOn?: boolean; onContinue?: (s: string) => void } = {}) =>
    mount(
      <LenTurn
        turn={t}
        next={undefined}
        isLast
        currentPage={null}
        projectId="p"
        when="now"
        vote={undefined}
        labels={{} as EtiquetasDeRespuesta}
        onRetry={nothing}
        onPublished={nothing}
        onConfirmSettled={nothing}
        onAnswerQuestion={nothing}
        onDismissQuestion={nothing}
        onRate={async () => true}
        onClearRate={async () => true}
        {...extra}
      />,
    );
  // Only todo_write cards here, so the turn renders no StepsCard (and none of its dependencies).
  const actions = [
    { tool: "todo_write", status: "done", summary: "", todos: [{ content: "Home page", status: "in_progress" }] },
    { tool: "todo_write", status: "done", summary: "", todos: list },
  ] as DesignTurn["actions"];

  it("the todo_write cards are not steps", () => {
    const mixed = [...actions!, { tool: "Write", status: "done", summary: "/index.html" }] as DesignTurn["actions"];
    expect(visibleSteps(mixed).map((a) => a.tool)).toEqual(["Write"]);
  });

  it("paints the LAST list of the turn", () => {
    const host = render(turn({ actions }), { onContinue: nothing });
    expect(host.querySelectorAll('[data-testid="todo-list"] li')).toHaveLength(3);
    expect(host.textContent).toContain("newChat.todos.continue");
  });

  it("no button while a goal runs on its own", () => {
    const host = render(turn({ actions }), { goalRunsOn: true, onContinue: nothing });
    expect(host.textContent).not.toContain("newChat.todos.continue ");
  });

  it("a turn that ended on a question keeps the list but offers no second button", () => {
    const ask = { tool: "ask_user_question", status: "done", summary: "Shall I go on?", pregunta: "Shall I check the six pages on a phone?" };
    const host = render(turn({ actions: [...actions!, ask] as DesignTurn["actions"] }), { onContinue: nothing });
    expect(host.querySelectorAll('[data-testid="todo-list"] li')).toHaveLength(3);
    expect(host.textContent).toContain("Shall I check the six pages on a phone?");
    expect(host.textContent).not.toContain("newChat.todos.continue ");
  });

  it("an emptied list paints nothing", () => {
    const host = render(turn({ actions: [{ tool: "todo_write", status: "done", summary: "", todos: [] }] as DesignTurn["actions"] }));
    expect(host.querySelector('[data-testid="todo-list"]')).toBeNull();
  });
});
