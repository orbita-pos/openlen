import { describe, expect, it } from "vitest";
import type { Message, StreamEvent } from "@/lib/ai-gateway";
import { runAgentLoop } from "./loop";
import { TODO_WRITE } from "./todo-list";
import { TODO_WRITE_DECLARATION, toolTodoWrite } from "./todo-write";

const done: StreamEvent = { type: "done", stopReason: { kind: "end_turn" } };
function scripted(...turns: StreamEvent[][]): (messages: Message[]) => AsyncIterable<StreamEvent> {
  let i = 0;
  return () => {
    if (i > 50) throw new Error("scripted: the loop did not end");
    const turn = turns[Math.min(i, turns.length - 1)]!;
    i += 1;
    return (async function* () {
      for (const ev of turn) yield ev;
    })();
  };
}

describe("todo_write", () => {
  it("returns the list to the loop and DeepSeek's line to the model", () => {
    const out = toolTodoWrite({ todos: [{ content: "Home page", status: "in_progress" }, { content: "Menu page", status: "pending" }] });
    expect(out.response).toEqual({ ok: true, tool_result: "Updated todo list: 1 pending, 1 in progress, 0 completed." });
    expect(out.todos).toEqual([
      { content: "Home page", status: "in_progress" },
      { content: "Menu page", status: "pending" },
    ]);
  });

  it("a bad list comes back as a tool error and carries no list", () => {
    const out = toolTodoWrite({ todos: [{ content: "a", status: "in_progress" }, { content: "b", status: "in_progress" }] });
    expect(out.response.ok).toBe(false);
    expect(String(out.response.error)).toContain("at most one task may be in_progress");
    expect(String(out.response.tool_result)).toContain("<tool_use_error>");
    expect(out.todos).toBeUndefined();
  });

  it("the declaration is DeepSeek's: three sentences, plus one of ours", () => {
    const d = TODO_WRITE_DECLARATION as { name: string; description: string; parameters: { required: string[] } };
    expect(d.name).toBe(TODO_WRITE);
    expect(d.description).toContain(
      "Record and update a task list to plan multi-step work and show progress; skip it for trivial single-step tasks.",
    );
    expect(d.description).toContain("While work remains, keep exactly one todo `in_progress`.");
    expect(d.description).toContain("The user sees this list in the chat");
    expect(d.parameters.required).toEqual(["todos"]);
  });

  // REVIEW FOCUS 2: `repararNombre` turns TodoWrite into todo_write (one letter away).
  it("a Claude Code style TodoWrite call is repaired and its activeForm is rejected by name", async () => {
    const seen: Record<string, unknown>[] = [];
    await runAgentLoop({
      messages: [{ role: "user", content: "three pages" }],
      tools: [{ name: TODO_WRITE }],
      openStream: scripted(
        [{ type: "function_call", name: "TodoWrite", args: { todos: [{ content: "Home", status: "in_progress", activeForm: "Doing home" }] } }, done],
        [{ type: "text_delta", text: "OK" }, done],
      ),
      runTool: async (name, args) => {
        const out = name === TODO_WRITE ? toolTodoWrite(args) : { response: { ok: true } };
        seen.push({ name, ...out.response });
        return out;
      },
      emit: () => {},
    });
    expect(seen[0]).toMatchObject({ name: TODO_WRITE, ok: false });
    expect(String(seen[0]!.error)).toContain('unknown key "activeForm"');
  });
});
