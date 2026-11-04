// WHAT CHANGES IN AN EVENT TASK (spec local 2026-11-03-len-que-avisa, §7.7): its name and its prompt, from Len's
// `schedule_update` and from the clock alike. What it watches doesn't: to watch something else, a new task.
import { scheduleTitle } from "@/lib/scheduled-tasks/deepseek/domain";

const KEYS = new Set(["id", "title", "prompt"]);

export const EVENT_UPDATE_REFUSAL = "An event task changes only its title and prompt; to watch something else, create a new task.";

export function eventTaskPatch(
  args: Record<string, unknown>,
): { ok: true; patch: { title?: string; prompt?: string } } | { ok: false; error: { code: "invalid_selector"; message: string } } {
  if (Object.keys(args).some((k) => !KEYS.has(k))) return { ok: false, error: { code: "invalid_selector", message: EVENT_UPDATE_REFUSAL } };
  return {
    ok: true,
    patch: { ...(typeof args.title === "string" ? { title: scheduleTitle(args.title) } : {}), ...(typeof args.prompt === "string" ? { prompt: args.prompt } : {}) },
  };
}
