import { describe, expect, it } from "vitest";
import type { TodoItem, TodoStatus } from "@/lib/agent/todo-list";
import { boardWindow, nextAppBirth, progressOf, stationOfTool, workshopOf, type LatestTurn } from "./app-birth";

const list = (...statuses: TodoStatus[]): TodoItem[] => statuses.map((status, i) => ({ content: `paso ${i + 1}`, status }));

const run = (tool: string, summary = "") => ({ tool, status: "running" as const, summary });
const done = (tool: string, summary = "") => ({ tool, status: "done" as const, summary });

describe("stationOfTool", () => {
  it("puts each kind of work at its station", () => {
    expect(stationOfTool("todo_write")).toBe("board");
    expect(stationOfTool("Read")).toBe("files");
    expect(stationOfTool("Grep")).toBe("files");
    expect(stationOfTool("web_search")).toBe("files");
    expect(stationOfTool("Write")).toBe("desk");
    expect(stationOfTool("Edit")).toBe("desk");
    expect(stationOfTool("bash")).toBe("terminal");
    expect(stationOfTool("view_page")).toBe("bench");
    expect(stationOfTool("use_page")).toBe("bench");
  });

  it("has no station for a tool that isn't work on the app", () => {
    expect(stationOfTool("ask_user_question")).toBeNull();
    expect(stationOfTool("publish")).toBeNull();
    expect(stationOfTool("made_up")).toBeNull();
  });
});

describe("workshopOf", () => {
  it("starts at the board before Len has done anything", () => {
    expect(workshopOf([])).toEqual({ station: "board", note: null, todos: null, waiting: false });
  });

  it("a question to the owner, still unanswered, means Len is waiting for them", () => {
    const w = workshopOf([done("Read", "src/App.tsx"), run("ask_user_question", "¿Qué productos vendes?")]);
    expect(w.waiting).toBe(true);
    expect(w.station).toBe("files");
  });

  it("so does a plan waiting for approval", () => {
    expect(workshopOf([run("exit_plan_mode")]).waiting).toBe(true);
  });

  it("an answered question is no longer waiting", () => {
    expect(workshopOf([done("ask_user_question", "¿Qué productos vendes?"), run("Write", "src/App.tsx")]).waiting).toBe(false);
  });

  it("lights the station of what is running, with its file as the note", () => {
    const w = workshopOf([done("Read", "src/App.tsx"), run("Write", "src/screens/Home.tsx")]);
    expect(w.station).toBe("desk");
    expect(w.note).toBe("src/screens/Home.tsx");
  });

  it("with several running at once, the last one started wins", () => {
    expect(workshopOf([run("Read", "a"), run("Grep", "b"), run("bash", "npm run build")]).station).toBe("terminal");
  });

  it("between tools, Len stays at the last station he worked at", () => {
    expect(workshopOf([done("Write", "src/App.tsx"), done("view_page")]).station).toBe("bench");
  });

  it("a tool with no station doesn't move him", () => {
    const w = workshopOf([done("bash", "npm test"), run("ask_user_question", "¿Qué colores?")]);
    expect(w.station).toBe("terminal");
    expect(w.note).toBe("npm test");
  });

  it("an empty summary is no note", () => {
    expect(workshopOf([run("view_page", "  ")]).note).toBeNull();
  });

  it("the board carries Len's latest step list", () => {
    const todos = [
      { content: "Las reglas del inventario", status: "completed" },
      { content: "La pantalla de inicio", status: "in_progress" },
    ];
    const w = workshopOf([{ tool: "todo_write", status: "done", summary: "", todos }, run("Write", "src/screens/Home.tsx")]);
    expect(w.todos).toEqual(todos);
    expect(w.station).toBe("desk");
  });
});

describe("boardWindow", () => {
  it("has nothing to draw without a list", () => {
    expect(boardWindow(null)).toEqual([]);
  });

  it("a short list fits whole", () => {
    expect(boardWindow(list("completed", "in_progress", "pending"))).toHaveLength(3);
  });

  it("a long list shows five rows around the step in progress", () => {
    const todos = list("completed", "completed", "completed", "completed", "completed", "completed", "in_progress", "pending");
    expect(boardWindow(todos).map((t) => t.content)).toEqual(["paso 4", "paso 5", "paso 6", "paso 7", "paso 8"]);
  });

  it("with nothing in progress, the next pending step is the one kept in view", () => {
    const todos = list("completed", "pending", "pending", "pending", "pending", "pending", "pending");
    expect(boardWindow(todos)[0]!.content).toBe("paso 1");
  });

  it("with everything done, the last five", () => {
    const todos = list("completed", "completed", "completed", "completed", "completed", "completed", "completed");
    expect(boardWindow(todos).map((t) => t.content)).toEqual(["paso 3", "paso 4", "paso 5", "paso 6", "paso 7"]);
  });
});

describe("progressOf", () => {
  it("no list, no step count", () => {
    expect(progressOf(null)).toBeNull();
    expect(progressOf([])).toBeNull();
  });

  it("the step in progress is the current one", () => {
    expect(progressOf(list("completed", "in_progress", "pending"))).toEqual({ current: 2, total: 3 });
  });

  it("between steps, the next one after those done", () => {
    expect(progressOf(list("completed", "pending", "pending"))).toEqual({ current: 2, total: 3 });
  });

  it("never past the last step", () => {
    expect(progressOf(list("completed", "completed"))).toEqual({ current: 2, total: 2 });
  });
});

describe("nextAppBirth", () => {
  const turn = (over: Partial<LatestTurn> = {}): LatestTurn => ({
    id: "t1",
    status: "streaming",
    cut: false,
    isFirst: true,
    actions: [],
    ...over,
  });

  it("starts with the first turn of a project being born as an app", () => {
    expect(nextAppBirth(null, turn(), true, 1000)).toEqual({ turnId: "t1", startedAt: 1000, finishedAt: null });
  });

  it("keeps its start time while the same turn runs", () => {
    const b = nextAppBirth(null, turn(), true, 1000);
    expect(nextAppBirth(b, turn({ actions: [{ tool: "Write", status: "running", summary: "x" }] }), true, 5000)).toBe(b);
  });

  it("is not a birth for a page, nor for a later turn of an app", () => {
    expect(nextAppBirth(null, turn(), false, 1000)).toBeNull();
    expect(nextAppBirth(null, turn({ isFirst: false }), true, 1000)).toBeNull();
  });

  const wrote = [{ tool: "Write", status: "done", summary: "src/screens/Home.tsx" }];

  it("a turn that ended well, having written the app, finishes the birth, once", () => {
    const b = nextAppBirth(null, turn(), true, 1000);
    const done = nextAppBirth(b, turn({ status: "applied", actions: wrote }), true, 9000);
    expect(done).toEqual({ turnId: "t1", startedAt: 1000, finishedAt: 9000 });
    expect(nextAppBirth(done, turn({ status: "applied", actions: wrote }), true, 9500)).toBe(done);
  });

  it("a first turn that only asked something has no app to call ready", () => {
    const b = nextAppBirth(null, turn(), true, 1000);
    const asked = [{ tool: "ask_user_question", status: "done", summary: "¿Qué vendes?" }];
    expect(nextAppBirth(b, turn({ status: "applied", actions: asked }), true, 2000)).toBeNull();
  });

  it("a turn that failed, was cut or undone leaves no «ready»", () => {
    const b = nextAppBirth(null, turn(), true, 1000);
    expect(nextAppBirth(b, turn({ status: "error" }), true, 2000)).toBeNull();
    expect(nextAppBirth(b, turn({ status: "applied", cut: true, actions: wrote }), true, 2000)).toBeNull();
    expect(nextAppBirth(b, turn({ status: "reverted" }), true, 2000)).toBeNull();
    expect(nextAppBirth(b, null, true, 2000)).toBeNull();
  });

  it("an app already finished when the workspace opens shows nothing", () => {
    expect(nextAppBirth(null, turn({ status: "applied" }), true, 1000)).toBeNull();
  });
});
