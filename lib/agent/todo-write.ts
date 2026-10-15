/**
 * `todo_write`, THE PROGRESS LIST TOOL (local spec 2026-10-15-len-progress-list-design).
 *
 * DeepSeek's (`deepseek-harness`, MIT, LICENSES/deepseek-harness.MIT.txt:
 * packages/todo/tool-todo/src/index.ts): its name, its schema, its three
 * sentences and its output line, in its single-in-progress mode. Ours is ONE
 * sentence — the user reads this list in the chat, and may not code — and
 * nothing else: none of F4's 23 rules come back.
 *
 * The list goes back to the loop in `ToolOutcome.todos`; the loop puts it on
 * the `action` event and the stored card is its only copy.
 */
import { CLAVE_TOOL_RESULT, fallo } from "@/lib/agent/ficheros/resultado";
import type { ToolOutcome } from "@/lib/agent/tools";
import { TODO_STATUSES, TODO_WRITE, TodoListError, parseTodoList, todoSummaryLine } from "@/lib/agent/todo-list";

export const TODO_WRITE_DESCRIPTION =
  "Record and update a task list to plan multi-step work and show progress; skip it for trivial single-step tasks. " +
  "Add one todo per concrete step before you start. " +
  "While work remains, keep exactly one todo `in_progress`. " +
  "Mark each todo `completed` as soon as it is done. " +
  "The user sees this list in the chat: write each step in their language, in words someone who doesn't code understands.";

export const TODO_WRITE_DECLARATION: Record<string, unknown> = {
  name: TODO_WRITE,
  description: TODO_WRITE_DESCRIPTION,
  parameters: {
    type: "OBJECT",
    properties: {
      todos: {
        type: "ARRAY",
        description: "The COMPLETE task list, replacing any previous list.",
        items: {
          type: "OBJECT",
          properties: {
            content: { type: "STRING", description: "What the task is — a short imperative line." },
            status: {
              type: "STRING",
              enum: [...TODO_STATUSES],
              description: "pending (not started) | in_progress (now) | completed (done).",
            },
          },
          required: ["content", "status"],
        },
      },
    },
    required: ["todos"],
  },
};

export function toolTodoWrite(args: Record<string, unknown>): ToolOutcome {
  try {
    const todos = parseTodoList(args.todos);
    return { response: { ok: true, [CLAVE_TOOL_RESULT]: todoSummaryLine(todos) }, todos };
  } catch (e) {
    if (!(e instanceof TodoListError)) throw e;
    const r = fallo(e.message);
    return { response: { ok: false, error: r.error, [CLAVE_TOOL_RESULT]: r.texto } };
  }
}
