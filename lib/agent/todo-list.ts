/**
 * THE PROGRESS LIST Len keeps for the user (local spec
 * docs/superpowers/specs/2026-10-15-len-progress-list-design.md).
 *
 * Pure and client-safe: the chat, the route and the tool read it. The shape and
 * the validation are DeepSeek's `todo_write` (`deepseek-harness`, MIT,
 * LICENSES/deepseek-harness.MIT.txt: packages/todo/tool-todo/src/index.ts):
 * every call replaces the whole list, at most one step is in progress, and the
 * latest list wins. Ours: the caps (rows are JSON) and the notices, whose
 * reasons live in the spec.
 */

export const TODO_WRITE = "todo_write";

export const TODO_STATUSES = ["pending", "in_progress", "completed"] as const;
export type TodoStatus = (typeof TODO_STATUSES)[number];

export interface TodoItem {
  readonly content: string;
  readonly status: TodoStatus;
}

/** DeepSeek has no caps; a stored card is JSON and a turn row has a size. */
export const MAX_TODOS = 50;
export const MAX_TODO_CONTENT = 200;

export class TodoListError extends Error {}

const isStatus = (s: unknown): s is TodoStatus => TODO_STATUSES.includes(s as TodoStatus);

/**
 * DeepSeek's `toTodoList`, plus what its schema registry checks before it: an
 * array of `{ content, status }` with no other keys (`additionalProperties:
 * false` — the stored list must be what the model believes it wrote).
 */
export function parseTodoList(raw: unknown): TodoItem[] {
  if (!Array.isArray(raw)) throw new TodoListError("invalid todos: `todos` must be an array");
  if (raw.length > MAX_TODOS) throw new TodoListError(`invalid todos: at most ${MAX_TODOS} tasks`);
  const todos: TodoItem[] = [];
  const seen = new Set<string>();
  let active = 0;
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new TodoListError("invalid todo: each task must be an object with `content` and `status`");
    }
    const extra = Object.keys(item).find((k) => k !== "content" && k !== "status");
    if (extra !== undefined) {
      throw new TodoListError(`invalid todo: unknown key ${JSON.stringify(extra)}; each task has only \`content\` and \`status\``);
    }
    const { content: rawContent, status } = item as { content?: unknown; status?: unknown };
    if (typeof rawContent !== "string" || rawContent.trim().length === 0) {
      throw new TodoListError("invalid todo: `content` must be a non-empty string");
    }
    if (!isStatus(status)) throw new TodoListError("invalid todo: `status` must be pending, in_progress or completed");
    const content = rawContent.trim().slice(0, MAX_TODO_CONTENT);
    if (seen.has(content)) throw new TodoListError(`invalid todos: duplicate content ${JSON.stringify(content)}`);
    seen.add(content);
    if (status === "in_progress") active++;
    todos.push({ content, status });
  }
  if (active > 1) throw new TodoListError(`invalid todos: at most one task may be in_progress (got ${active})`);
  return todos;
}

/** A stored list (a row, a payload): keeps the well-formed items, never throws. */
export function todosFrom(raw: unknown): TodoItem[] | null {
  if (!Array.isArray(raw)) return null;
  const out: TodoItem[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const { content, status } = x as { content?: unknown; status?: unknown };
    if (typeof content !== "string" || content.trim().length === 0 || !isStatus(status)) continue;
    out.push({ content: content.trim().slice(0, MAX_TODO_CONTENT), status });
    if (out.length === MAX_TODOS) break;
  }
  return out;
}

export function todoCounts(todos: readonly TodoItem[]): { pending: number; inProgress: number; completed: number } {
  const count = (s: TodoStatus) => todos.filter((t) => t.status === s).length;
  return { pending: count("pending"), inProgress: count("in_progress"), completed: count("completed") };
}

/** DeepSeek's `render` line: what the model reads back after a call. */
export function todoSummaryLine(todos: readonly TodoItem[]): string {
  const c = todoCounts(todos);
  return `Updated todo list: ${c.pending} pending, ${c.inProgress} in progress, ${c.completed} completed.`;
}

export function hasUnfinished(todos: readonly TodoItem[] | null | undefined): boolean {
  return (todos ?? []).some((t) => t.status !== "completed");
}

/** The step "continue" means: the one left in progress, else the first pending. */
export function nextTodo(todos: readonly TodoItem[]): TodoItem | null {
  return todos.find((t) => t.status === "in_progress") ?? todos.find((t) => t.status === "pending") ?? null;
}

/** The list a turn ended with: its last `todo_write` card that carries one. */
export function latestTodosOfActions(
  actions: readonly { readonly tool: string; readonly todos?: unknown }[] | null | undefined,
): TodoItem[] | null {
  for (let i = (actions?.length ?? 0) - 1; i >= 0; i--) {
    const a = actions![i]!;
    if (a.tool !== TODO_WRITE) continue;
    const todos = todosFrom(a.todos);
    if (todos) return todos;
  }
  return null;
}

type HistoryLike = readonly { readonly functionCalls?: readonly { readonly name: string }[] }[];

/** Whether the history the model is about to read still holds a `todo_write` call. */
export function historyHasTodoWrite(history: HistoryLike): boolean {
  return history.some((m) => m.functionCalls?.some((c) => c.name === TODO_WRITE) ?? false);
}

function todoLines(todos: readonly TodoItem[]): string {
  return todos.map((t, i) => `${i + 1}. [${t.status}] ${t.content}`).join("\n");
}

/**
 * What a turn starts with. An unfinished list is INHERITED (the loop then gives
 * the "there is a list" notice), and, only when it is no longer in the history
 * (compacted or out of the window), it is handed back to Len in one line.
 */
export function todosForTurn(
  latest: readonly TodoItem[] | null,
  history: HistoryLike,
): { initialTodos: TodoItem[] | null; restoreLine: string | null } {
  if (!latest || !hasUnfinished(latest)) return { initialTodos: null, restoreLine: null };
  const restoreLine = historyHasTodoWrite(history)
    ? null
    : `Your task list from earlier in this conversation (it is no longer in the history above; keep it up to date with ${TODO_WRITE}):\n${todoLines(latest)}`;
  return { initialTodos: [...latest], restoreLine };
}

const NEAR_CAP_HEAD = "SYSTEM (the user did NOT write this): this turn has used most of its budget. ";
const GOAL_TAIL = " The next goal round continues on its own, so do not ask.";

/** The one notice at `NEAR_TURN_CAP_RATIO` of the turn cap (spec §4.3). */
export function nearCapNotice(o: { hasList: boolean; goalContinues: boolean }): string {
  if (!o.hasList) {
    return (
      NEAR_CAP_HEAD +
      "Finish what you are doing and do not start anything new, then close: tell the user what is done and what is still pending." +
      (o.goalContinues ? GOAL_TAIL : "")
    );
  }
  if (o.goalContinues) {
    return NEAR_CAP_HEAD + `Finish the step in progress and do not start another. Update the list with ${TODO_WRITE}, then close by saying what is done.` + GOAL_TAIL;
  }
  return (
    NEAR_CAP_HEAD +
    `Finish the step in progress and do not start another. Update the list with ${TODO_WRITE}, then close: tell the user what is done and ask whether to continue with the next step, naming it.`
  );
}

/** Appended to the budget wrap-up at 100 %: the list as facts. */
export function todoCapFacts(todos: readonly TodoItem[]): string {
  return `\n\nYour task list as it stands (from your last ${TODO_WRITE} call):\n${todoLines(todos)}\nName the steps that are done, the one left half-done if any, and the ones still pending.`;
}
