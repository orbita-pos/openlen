/**
 * WHAT LEN'S WORKSHOP SHOWS while an app is born (the canvas loader of
 * `components/workspace-v2/app-birth-workshop.tsx`). Pure and client-safe: it
 * reads the live turn's tool cards and says which station is lit, what file or
 * command goes under it, and Len's step list for the board.
 *
 * Nothing here is staged: every station is a kind of tool Len really calls,
 * and the lit one is the tool running now — or, between tools, the last one he
 * used, because that's where he still is while he thinks.
 */

import { latestTodosOfActions, nextTodo, type TodoItem } from "@/lib/agent/todo-list";

export const WORKSHOP_STATIONS = ["board", "files", "desk", "terminal", "bench"] as const;
export type WorkshopStation = (typeof WORKSHOP_STATIONS)[number];

const STATION_OF: Readonly<Record<string, WorkshopStation>> = {
  // Planning: his step list, the plan mode, a goal.
  todo_write: "board",
  enter_plan_mode: "board",
  exit_plan_mode: "board",
  create_goal: "board",
  update_goal: "board",
  get_goal: "board",
  // Looking things up: the project's files, the web, photos, past chats.
  Read: "files",
  Glob: "files",
  Grep: "files",
  web_search: "files",
  web_fetch: "files",
  find_photo: "files",
  image_search: "files",
  session_search: "files",
  // Writing the app.
  Write: "desk",
  Edit: "desk",
  edit_image: "desk",
  convert_to_app: "desk",
  undo_last_change: "desk",
  // Commands.
  bash: "terminal",
  // Opening and using the app, as a person would.
  view_page: "bench",
  use_page: "bench",
};

/** Tools that, while they run, wait for the owner: a question, a plan to approve. */
const WAITS_FOR_OWNER: ReadonlySet<string> = new Set(["ask_user_question", "exit_plan_mode"]);

/** The station a tool works at; `null` for one that isn't work on the app (a question, publishing). */
export function stationOfTool(tool: string): WorkshopStation | null {
  return Object.hasOwn(STATION_OF, tool) ? STATION_OF[tool]! : null;
}

export interface WorkshopAction {
  readonly tool: string;
  readonly status: string;
  readonly summary: string;
  readonly todos?: unknown;
}

export interface WorkshopView {
  readonly station: WorkshopStation;
  /** The file or command of that station's card, as the card says it. */
  readonly note: string | null;
  /** Len's latest step list, for the board. */
  readonly todos: TodoItem[] | null;
  /** Len asked the owner something in the chat and is waiting for the answer. */
  readonly waiting: boolean;
}

export function workshopOf(actions: readonly WorkshopAction[]): WorkshopView {
  const todos = latestTodosOfActions(actions);
  const waiting = actions.some((a) => a.status === "running" && WAITS_FOR_OWNER.has(a.tool));
  const placed = (a: WorkshopAction) => stationOfTool(a.tool) !== null;
  let current: WorkshopAction | undefined;
  for (let i = actions.length - 1; i >= 0 && !current; i--) {
    if (actions[i]!.status === "running" && placed(actions[i]!)) current = actions[i];
  }
  for (let i = actions.length - 1; i >= 0 && !current; i--) {
    if (placed(actions[i]!)) current = actions[i];
  }
  if (!current) return { station: "board", note: null, todos, waiting };
  const note = current.summary.trim();
  return { station: stationOfTool(current.tool)!, note: note || null, todos, waiting };
}

/** How many of Len's steps the board has room for. */
export const BOARD_ROWS = 5;

/** The steps the board shows: all of them, or five around the one Len is on. */
export function boardWindow(todos: readonly TodoItem[] | null): readonly TodoItem[] {
  if (!todos || todos.length <= BOARD_ROWS) return todos ?? [];
  const next = nextTodo(todos);
  const at = next ? todos.indexOf(next) : todos.length - 1;
  const start = Math.min(Math.max(0, at - 2), todos.length - BOARD_ROWS);
  return todos.slice(start, start + BOARD_ROWS);
}

/** «Step N of M» from Len's list: the step in progress, else the one after those done. */
export function progressOf(todos: readonly TodoItem[] | null): { current: number; total: number } | null {
  if (!todos || todos.length === 0) return null;
  const active = todos.findIndex((t) => t.status === "in_progress");
  const done = todos.filter((t) => t.status === "completed").length;
  return { current: active >= 0 ? active + 1 : Math.min(done + 1, todos.length), total: todos.length };
}

/** Len's latest turn, as the chat tells the workspace about it (`useAgentChat`). */
export interface LatestTurn {
  readonly id: string;
  readonly status: "streaming" | "applied" | "error" | "reverted";
  /** It stopped halfway after changing something (`DesignTurn.cortado`). */
  readonly cut: boolean;
  /** The project's first turn with Len: the one an app is born in. */
  readonly isFirst: boolean;
  readonly actions: readonly WorkshopAction[];
}

export interface AppBirth {
  readonly turnId: string;
  readonly startedAt: number;
  /** When the turn ended well: the workshop says the app is ready, then leaves. */
  readonly finishedAt: number | null;
}

/**
 * Whether an app is being born now. It is the first turn of a project born as
 * an app, while it runs; and if that turn ends well having written the app,
 * the same birth, finished. A turn that fails, is cut or undone, or only asked
 * something, leaves nothing to call ready: the canvas goes back to showing
 * what there is.
 */
export function nextAppBirth(prev: AppBirth | null, turn: LatestTurn | null, bornAsApp: boolean, now: number): AppBirth | null {
  if (turn && bornAsApp && turn.isFirst && turn.status === "streaming") {
    return prev?.turnId === turn.id && prev.finishedAt === null ? prev : { turnId: turn.id, startedAt: now, finishedAt: null };
  }
  const wrote = turn?.actions.some((a) => a.status === "done" && stationOfTool(a.tool) === "desk") ?? false;
  if (prev && turn?.id === prev.turnId && turn.status === "applied" && !turn.cut && wrote) {
    return prev.finishedAt === null ? { ...prev, finishedAt: now } : prev;
  }
  return null;
}
