"use client";

// THE PROGRESS LIST under Len's message (local spec 2026-10-15-len-progress-list-design, §4.4):
// live while Len works, the final snapshot once the turn closes, and the
// "Yes, continue with …" button under the last turn. The list comes from the
// turn's last `todo_write` card (`latestTodosOfActions`), its only copy.

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Circle, CircleDot } from "lucide-react";

import { nextTodo, todoCounts, type TodoItem } from "@/lib/agent/todo-list";

export type TodoRowState = "done" | "active" | "halfDone" | "pending";

export function rowState(item: TodoItem, streaming: boolean): TodoRowState {
  if (item.status === "completed") return "done";
  if (item.status === "in_progress") return streaming ? "active" : "halfDone";
  return "pending";
}

/** The step the button offers, or null — spec §4.4: the last turn, closed well
 *  (`applied` and not cut), something left to do, and no goal running on. */
export function continueStep(o: {
  readonly todos: readonly TodoItem[] | null;
  readonly isLast: boolean;
  readonly status: string;
  readonly cortado?: boolean;
  readonly goalRunsOn: boolean;
}): TodoItem | null {
  if (!o.todos || !o.isLast || o.status !== "applied" || o.cortado || o.goalRunsOn) return null;
  return nextTodo(o.todos);
}

export function TodoListView({
  todos,
  streaming,
  continueWith = null,
  onContinue,
}: {
  todos: readonly TodoItem[];
  streaming: boolean;
  continueWith?: TodoItem | null;
  onContinue?: (text: string) => void;
}) {
  const t = useTranslations("panelsChat");
  const [open, setOpen] = useState(false);
  const progress = t("newChat.todos.progress", { done: todoCounts(todos).completed, total: todos.length });
  return (
    <div data-testid="todo-list" className="rounded-xl border bd bg-elev px-3 py-2 text-[13px]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between fg-muted sm:hidden"
      >
        {progress}
      </button>
      <p className="m-0 hidden fg-muted sm:block">{progress}</p>
      <ol className={`m-0 mt-1.5 list-none space-y-1 p-0 ${open ? "" : "hidden"} sm:block`}>
        {todos.map((item) => {
          const state = rowState(item, streaming);
          return (
            <li key={item.content} data-state={state} className="flex items-start gap-2">
              {state === "done" ? (
                <Check size={14} className="mt-[3px] shrink-0 text-[var(--accent)]" />
              ) : state === "active" ? (
                <CircleDot size={14} className="mt-[3px] shrink-0 animate-pulse fg" />
              ) : state === "halfDone" ? (
                <CircleDot size={14} className="mt-[3px] shrink-0 fg-muted" />
              ) : (
                <Circle size={14} className="mt-[3px] shrink-0 fg-faint" />
              )}
              <span className={state === "done" ? "fg-muted" : "fg"}>
                {item.content}
                {state === "halfDone" && <span className="ml-1.5 fg-faint">· {t("newChat.todos.halfDone")}</span>}
              </span>
            </li>
          );
        })}
      </ol>
      {continueWith && onContinue && (
        <button
          type="button"
          onClick={() => onContinue(t("newChat.todos.continueMessage", { step: continueWith.content }))}
          className="mt-2 rounded-lg border bd px-2.5 py-1 text-[12.5px] fg hover:bg-hover"
        >
          {t("newChat.todos.continue", { step: continueWith.content })}
        </button>
      )}
    </div>
  );
}
