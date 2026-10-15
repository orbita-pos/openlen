import { describe, expect, it } from "vitest";
import {
  MAX_TODO_CONTENT,
  TODO_WRITE,
  TodoListError,
  hasUnfinished,
  historyHasTodoWrite,
  latestTodosOfActions,
  nearCapNotice,
  nextTodo,
  parseTodoList,
  todoCapFacts,
  todoCounts,
  todoSummaryLine,
  todosForTurn,
  todosFrom,
  type TodoItem,
} from "./todo-list";

const list: TodoItem[] = [
  { content: "Home page", status: "completed" },
  { content: "Menu page", status: "in_progress" },
  { content: "Contact page", status: "pending" },
];

describe("parseTodoList (DeepSeek's validation)", () => {
  it("accepts a well-formed list and trims content", () => {
    expect(parseTodoList([{ content: "  Home page ", status: "pending" }])).toEqual([{ content: "Home page", status: "pending" }]);
  });

  it("accepts an empty list (Len clears it)", () => {
    expect(parseTodoList([])).toEqual([]);
  });

  it("rejects empty content, duplicates and two in progress, with DeepSeek's wording", () => {
    expect(() => parseTodoList([{ content: " ", status: "pending" }])).toThrow("`content` must be a non-empty string");
    expect(() => parseTodoList([{ content: "a", status: "pending" }, { content: "a", status: "completed" }])).toThrow('duplicate content "a"');
    expect(() =>
      parseTodoList([
        { content: "a", status: "in_progress" },
        { content: "b", status: "in_progress" },
      ]),
    ).toThrow("at most one task may be in_progress (got 2)");
  });

  it("rejects a bad status, a non-array and unknown keys such as Claude Code's activeForm", () => {
    expect(() => parseTodoList([{ content: "a", status: "done" }])).toThrow(TodoListError);
    expect(() => parseTodoList("a")).toThrow("`todos` must be an array");
    expect(() => parseTodoList([{ content: "a", status: "pending", activeForm: "Doing a" }])).toThrow('unknown key "activeForm"');
  });

  it("caps content length", () => {
    expect(parseTodoList([{ content: "x".repeat(500), status: "pending" }])[0]!.content).toHaveLength(MAX_TODO_CONTENT);
  });
});

describe("todosFrom (stored rows)", () => {
  it("keeps the well-formed items and never throws", () => {
    expect(todosFrom([{ content: "a", status: "pending" }, { content: 3 }, null, { content: "b", status: "nope" }])).toEqual([
      { content: "a", status: "pending" },
    ]);
    expect(todosFrom("x")).toBeNull();
  });
});

describe("counts, summary and next step", () => {
  it("counts like DeepSeek's render line", () => {
    expect(todoCounts(list)).toEqual({ pending: 1, inProgress: 1, completed: 1 });
    expect(todoSummaryLine(list)).toBe("Updated todo list: 1 pending, 1 in progress, 1 completed.");
  });

  it("the next step is the one left in progress before the first pending", () => {
    expect(nextTodo(list)).toEqual({ content: "Menu page", status: "in_progress" });
    expect(nextTodo([{ content: "a", status: "completed" }, { content: "b", status: "pending" }])?.content).toBe("b");
    expect(nextTodo([{ content: "a", status: "completed" }])).toBeNull();
  });

  it("hasUnfinished is false for null, empty and all-completed lists", () => {
    expect(hasUnfinished(null)).toBe(false);
    expect(hasUnfinished([])).toBe(false);
    expect(hasUnfinished([{ content: "a", status: "completed" }])).toBe(false);
    expect(hasUnfinished(list)).toBe(true);
  });
});

describe("latestTodosOfActions", () => {
  it("takes the LAST todo_write card of the turn", () => {
    expect(
      latestTodosOfActions([
        { tool: TODO_WRITE, todos: [{ content: "a", status: "in_progress" }] },
        { tool: "Write" },
        { tool: TODO_WRITE, todos: [{ content: "a", status: "completed" }] },
      ]),
    ).toEqual([{ content: "a", status: "completed" }]);
  });

  it("is null without a todo_write card", () => {
    expect(latestTodosOfActions([{ tool: "Write" }])).toBeNull();
    expect(latestTodosOfActions(undefined)).toBeNull();
  });
});

describe("todosForTurn", () => {
  const conLista = [{ functionCalls: [{ name: TODO_WRITE }] }];
  const sinLista = [{ functionCalls: [{ name: "Write" }] }, {}];

  it("an unfinished list still in the history: inherited, no restore line", () => {
    expect(historyHasTodoWrite(conLista)).toBe(true);
    expect(todosForTurn(list, conLista)).toEqual({ initialTodos: list, restoreLine: null });
  });

  it("an unfinished list no longer in the history: inherited AND handed back in one line", () => {
    const r = todosForTurn(list, sinLista);
    expect(r.initialTodos).toEqual(list);
    expect(r.restoreLine).toContain("no longer in the history");
    expect(r.restoreLine).toContain("2. [in_progress] Menu page");
  });

  it("a finished or missing list: nothing", () => {
    expect(todosForTurn([{ content: "a", status: "completed" }], sinLista)).toEqual({ initialTodos: null, restoreLine: null });
    expect(todosForTurn(null, sinLista)).toEqual({ initialTodos: null, restoreLine: null });
  });
});

describe("the notices", () => {
  it("with a list and no goal, it asks to finish the step and ask about the next one", () => {
    const n = nearCapNotice({ hasList: true, goalContinues: false });
    expect(n.startsWith("SYSTEM (the user did NOT write this): this turn has used most of its budget.")).toBe(true);
    expect(n).toContain("ask whether to continue with the next step, naming it");
  });

  it("with a goal running on, it says not to ask", () => {
    const n = nearCapNotice({ hasList: true, goalContinues: true });
    expect(n).toContain("The next goal round continues on its own, so do not ask.");
    expect(n).not.toContain("ask whether to continue");
  });

  it("without a list, it asks for what is done and what is pending", () => {
    const n = nearCapNotice({ hasList: false, goalContinues: false });
    expect(n).toContain("what is done and what is still pending");
    expect(n).not.toContain("todo_write");
  });

  it("the cap facts name every step with its status", () => {
    const f = todoCapFacts(list);
    expect(f).toContain("1. [completed] Home page");
    expect(f).toContain("3. [pending] Contact page");
  });
});
