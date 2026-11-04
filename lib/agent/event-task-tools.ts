// THE TWO TOOLS ONLY AN EVENT TASK'S JUDGE HAS (spec local 2026-11-03-len-que-avisa, §7.5): `source_read`, which
// reads the candidate's items from the task's source, and DeepSeek's `automation_notify` (its event-triggered
// automation note, @ 6d8c7c8104, MIT): the only way a task reaches its owner. One card per turn, with DeepSeek's
// refusal; the summary at most 100 words, the Super-agent's hard cap, enforced here and not by the prompt. The
// descriptions are ours.
//
// Cache effect: these two declarations exist only in a judging turn's request, fixed, after Read/Glob/Grep; the
// project chat's requests never carry them.
import { visitorEnvelope } from "@/lib/event-tasks/framing";

import type { ToolOutcome } from "./tools";

export const SOURCE_READ = "source_read";
export const AUTOMATION_NOTIFY = "automation_notify";
export const SUMMARY_MAX_WORDS = 100;
const TITLE_MAX = 80;

export const EVENT_TASK_TOOL_DECLARATIONS: Record<string, unknown>[] = [
  {
    name: SOURCE_READ,
    description:
      "Read this task's source: the changed items by their keys, with the newest items before them; and, with match, the items whose fields equal the given values (at most 50, newest first) — how to find an older item a change relates to, such as another booking for the same date, time and table. The source's data comes only through this tool.",
    parameters: {
      type: "OBJECT",
      properties: {
        keys: { type: "ARRAY", items: { type: "STRING" }, description: "The keys of the changed items (their id), as the change shows them." },
        match: {
          type: "ARRAY",
          description: "Optional: fields that must all equal these values, as text; each is compared in its own type.",
          items: { type: "OBJECT", properties: { field: { type: "STRING" }, value: { type: "STRING" } }, required: ["field", "value"] },
        },
      },
    },
  },
  {
    name: AUTOMATION_NOTIFY,
    description:
      "Notify the owner: a card they can accept or dismiss, a push and an email. Call it only when the owner needs to act on this change; otherwise end without it and nothing reaches them. At most once per turn.",
    parameters: {
      type: "OBJECT",
      properties: {
        title: { type: "STRING", description: `One line, at most ${TITLE_MAX} characters, leading with what the owner would act on.` },
        summary: { type: "STRING", description: `What happened and why it matters, at most ${SUMMARY_MAX_WORDS} words.` },
        proposed_action: { type: "STRING", description: "What you would do if the owner accepts: one concrete sentence that can be carried out as written." },
      },
      required: ["title", "summary", "proposed_action"],
    },
  },
];

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

/** Words of a text; each Chinese or Japanese character counts as one, as those scripts write no spaces. */
export function wordCount(text: string): number {
  return text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[^\s\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu)?.filter((w) => CJK.test(w) || /\S/.test(w)).length ?? 0;
}

const refuse = (error: string): ToolOutcome => ({ response: { ok: false, error } });

export interface EventTaskToolDeps {
  notify(card: { title: string; summary: string; proposedAction: string }): Promise<{ cardId: string }>;
  readSource(keys: readonly string[], match: readonly { field: string; value: string }[]): Promise<unknown>;
}

export type EventTaskToolRunner = ((name: string, args: Record<string, unknown>) => Promise<ToolOutcome>) & { notified(): boolean };

/** The runner of one judging turn: it remembers whether that turn already made its card. */
export function eventTaskToolRunner(deps: EventTaskToolDeps): EventTaskToolRunner {
  let made = false;
  const run = async (name: string, args: Record<string, unknown>): Promise<ToolOutcome> => {
    if (name === SOURCE_READ) {
      const keys = Array.isArray(args.keys) ? args.keys.map(String) : [];
      const match = Array.isArray(args.match)
        ? args.match.flatMap((m) => (m && typeof m === "object" && typeof (m as { field?: unknown }).field === "string" ? [{ field: (m as { field: string }).field, value: String((m as { value?: unknown }).value ?? "") }] : []))
        : [];
      let read: unknown;
      try {
        read = await deps.readSource(keys, match);
      } catch (err) {
        // A read that fails is this tool's answer; the judge can still decide on what it has.
        return refuse(`The source could not be read: ${err instanceof Error ? err.message : String(err)}`);
      }
      // The same visitor text as the candidate: inside the same envelope (final review I2).
      return { response: { ok: true, tool_result: visitorEnvelope([read]).join("\n") } };
    }
    if (name !== AUTOMATION_NOTIFY) return refuse(`unknown tool ${name}`);
    // DeepSeek's words for a second card in a turn.
    if (made) return refuse("One card per turn; the earlier card stands.");
    const title = typeof args.title === "string" ? args.title.trim() : "";
    const summary = typeof args.summary === "string" ? args.summary.trim() : "";
    const proposedAction = typeof args.proposed_action === "string" ? args.proposed_action.trim() : "";
    if (!title || !summary || !proposedAction) return refuse("title, summary and proposed_action are all required.");
    if (title.length > TITLE_MAX) return refuse(`The title has ${title.length} characters; the limit is ${TITLE_MAX}. Shorten it and call ${AUTOMATION_NOTIFY} again.`);
    const words = wordCount(summary);
    if (words > SUMMARY_MAX_WORDS) return refuse(`The summary has ${words} words; the limit is ${SUMMARY_MAX_WORDS}. Shorten it and call ${AUTOMATION_NOTIFY} again.`);
    await deps.notify({ title, summary, proposedAction });
    made = true;
    return { response: { ok: true, tool_result: "The card reached the owner." } };
  };
  return Object.assign(run, { notified: () => made });
}
