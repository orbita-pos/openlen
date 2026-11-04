// THE TWO TOOLS ONLY AN EVENT TASK'S JUDGE HAS (spec local 2026-11-03-len-que-avisa, §7.5): `source_read`, which
// reads the candidate's items from the task's source, and DeepSeek's `automation_notify` (its event-triggered
// automation note, @ 6d8c7c8104, MIT): the only way a task reaches its owner. One card per turn, with DeepSeek's
// refusal; the summary at most 100 words, the Super-agent's hard cap, enforced here and not by the prompt. The
// descriptions are ours.
//
// `automation_notify` takes ACTIONS (spec local 2026-11-04-hazlo-que-se-puede-y-mas-fuentes, §7.1): only the ones this
// task's source offers, declared per task, and checked before the card exists (lib/event-tasks/actions/validate.ts)
// against what the turn read (`Seen`).
//
// Cache effect: these two declarations exist only in a judging turn's request, after Read/Glob/Grep; they are fixed
// per task (its source, its table's columns, its reply channels), so one task's judging turns keep their prefix — save
// when a channel comes or goes between two turns (the project's email, the GitHub App's token). With email as the only
// channel the declaration is byte for byte what it was before the channels. The project chat's requests never carry them.
import type { CardAction } from "@/lib/event-tasks/actions/types";
import { collectSeen, emptySeen, type Seen } from "@/lib/event-tasks/actions/seen";
import type { ReplyChannel } from "@/lib/event-tasks/sources/types";
import type { Validated } from "@/lib/event-tasks/actions/validate";
import { visitorEnvelope } from "@/lib/event-tasks/framing";

import type { ToolOutcome } from "./tools";

export const SOURCE_READ = "source_read";
export const AUTOMATION_NOTIFY = "automation_notify";
export const SUMMARY_MAX_WORDS = 100;
const TITLE_MAX = 80;

export const SOURCE_READ_DECLARATION: Record<string, unknown> = {
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
};

/** What `automation_notify`'s actions may be, for one task: work in the project always; a change of one row of the
 *  watched table, and a reply by each channel, only where the task's source offers them. Ours. */
export function automationNotifyDeclaration(a: { readonly dataChange: boolean; readonly replyChannels: readonly ReplyChannel[]; readonly table?: string; readonly columns?: readonly string[] }): Record<string, unknown> {
  const channels = a.replyChannels;
  const reply = channels.length > 0;
  const email = channels.includes("email");
  // Email alone is how a reply was declared before the channels: kept byte for byte (the task's cached prefix).
  const onlyEmail = email && channels.length === 1;
  const kinds = ["project", ...(a.dataChange ? ["data_change"] : []), ...(reply ? ["reply"] : [])];
  const parts = [
    "project: work on the site or the app (change a page, build a screen); text says what will be done, and Len does it when the owner accepts.",
    ...(a.dataChange
      ? [
          `data_change: change ONE row of the table ${a.table ?? ""} that you read in this turn — key is the value of its key, set the columns and their new values (columns you may change: ${(a.columns ?? []).join(", ")}). The owner applies it; you never write the data.`,
        ]
      : []),
    ...(onlyEmail ? ["reply: an email to a person whose address you read in this turn, sent exactly as written when the owner accepts."] : []),
    ...(email && !onlyEmail ? ["reply by email: channel email, to = an address you read in this turn, with a subject and a body, sent exactly as written when the owner accepts."] : []),
    ...(channels.includes("chat") ? ["reply in the chat: channel chat, to = the conversation_id you read; body is posted in that conversation as the business, exactly as written when the owner accepts."] : []),
    ...(channels.includes("github")
      ? ["reply on GitHub: channel github, to = the number of the issue or pull request you read; body is posted as a comment by the OpenLen GitHub app, exactly as written when the owner accepts."]
      : []),
  ];
  const properties: Record<string, unknown> = {
    kind: { type: "STRING", enum: kinds },
    text: { type: "STRING", description: "project: what will be done." },
    ...(a.dataChange
      ? {
          table: { type: "STRING", description: "data_change: the watched table." },
          key: { type: "STRING", description: "data_change: the value of the row's key." },
          set: {
            type: "ARRAY",
            description: "data_change: each column to change and its new value.",
            items: { type: "OBJECT", properties: { column: { type: "STRING" }, value: { type: "STRING" } }, required: ["column", "value"] },
          },
        }
      : {}),
    ...(reply
      ? {
          ...(onlyEmail ? {} : { channel: { type: "STRING", enum: [...channels], description: "reply: the channel it goes by." } }),
          to: { type: "STRING", description: onlyEmail ? "reply: the person's email address." : "reply: who it goes to, by channel — an email address, a conversation_id, or an issue or pull request number." },
          ...(email ? { subject: { type: "STRING", description: onlyEmail ? "reply: the subject." : "reply by email: the subject." } } : {}),
          body: { type: "STRING", description: "reply: the whole message, as it will be sent." },
        }
      : {}),
  };
  return {
    name: AUTOMATION_NOTIFY,
    description:
      "Notify the owner: a card they can accept or dismiss, a push and an email. Call it only when the owner needs to act on this change; otherwise end without it and nothing reaches them. At most once per turn.",
    parameters: {
      type: "OBJECT",
      properties: {
        title: { type: "STRING", description: `One line, at most ${TITLE_MAX} characters, leading with what the owner would act on.` },
        summary: { type: "STRING", description: `What happened and why it matters, at most ${SUMMARY_MAX_WORDS} words.` },
        actions: {
          type: "ARRAY",
          description: `What accepting the card will do: one or two of these, never anything else. ${parts.join(" ")}`,
          items: { type: "OBJECT", properties, required: ["kind"] },
        },
      },
      required: ["title", "summary", "actions"],
    },
  };
}

/** The judge's two tools for one task. */
export function eventTaskToolDeclarations(a: Parameters<typeof automationNotifyDeclaration>[0]): Record<string, unknown>[] {
  return [SOURCE_READ_DECLARATION, automationNotifyDeclaration(a)];
}

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

/** Words of a text; each Chinese or Japanese character counts as one, as those scripts write no spaces. */
export function wordCount(text: string): number {
  return text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[^\s\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu)?.filter((w) => CJK.test(w) || /\S/.test(w)).length ?? 0;
}

const refuse = (error: string): ToolOutcome => ({ response: { ok: false, error } });

export interface EventTaskToolDeps {
  notify(card: { title: string; summary: string; actions: readonly CardAction[]; subjectKey: string }): Promise<{ cardId: string }>;
  readSource(keys: readonly string[], match: readonly { field: string; value: string }[]): Promise<unknown>;
  /** Checks the proposed actions against what the turn read (lib/event-tasks/actions/validate.ts). */
  validate(input: unknown, seen: Seen): Promise<Validated>;
  /** The source's key column, to read row keys out of `source_read` (null: a submission's own id). */
  keyColumn: string | null;
  /** What the candidate itself brought. */
  seen?: Seen;
  /** The task's reply channels: which conversations and issues `source_read` makes answerable. */
  replyChannels: readonly ReplyChannel[];
}

export type EventTaskToolRunner = ((name: string, args: Record<string, unknown>) => Promise<ToolOutcome>) & { notified(): boolean };

/** The runner of one judging turn: it remembers whether that turn already made its card. */
export function eventTaskToolRunner(deps: EventTaskToolDeps): EventTaskToolRunner {
  let made = false;
  const seen = deps.seen ?? emptySeen();
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
      collectSeen(read, deps.keyColumn, seen, deps.replyChannels);
      // The same visitor text as the candidate: inside the same envelope (final review I2).
      return { response: { ok: true, tool_result: visitorEnvelope([read]).join("\n") } };
    }
    if (name !== AUTOMATION_NOTIFY) return refuse(`unknown tool ${name}`);
    // DeepSeek's words for a second card in a turn.
    if (made) return refuse("One card per turn; the earlier card stands.");
    const title = typeof args.title === "string" ? args.title.trim() : "";
    const summary = typeof args.summary === "string" ? args.summary.trim() : "";
    if (!title || !summary || !Array.isArray(args.actions)) return refuse("title, summary and actions are all required.");
    if (title.length > TITLE_MAX) return refuse(`The title has ${title.length} characters; the limit is ${TITLE_MAX}. Shorten it and call ${AUTOMATION_NOTIFY} again.`);
    const words = wordCount(summary);
    if (words > SUMMARY_MAX_WORDS) return refuse(`The summary has ${words} words; the limit is ${SUMMARY_MAX_WORDS}. Shorten it and call ${AUTOMATION_NOTIFY} again.`);
    const checked = await deps.validate(args.actions, seen);
    if (!checked.ok) return refuse(checked.error);
    await deps.notify({ title, summary, actions: checked.actions, subjectKey: checked.subjectKey });
    made = true;
    return { response: { ok: true, tool_result: "The card reached the owner." } };
  };
  return Object.assign(run, { notified: () => made });
}
