// WHAT A VISUAL TELLS THE MODEL (MCP Apps' `updateModelContext`, SEP-1865). A visual on the person's screen can report
// text for their next message — a selection, a filter. That text comes from code that may be showing a visitor's words,
// so it is DATA, never the person's own: the route keeps it out of `prompt` (which it scans for `/skill`s, shows in the
// chat, and takes as what the person wrote) and gives it to the model after their message, inside a fence that says
// so, with `<` escaped so nothing in it can close the fence or open a mark of ours. Pure and client-safe: the frame
// caps what it forwards with the same number, and the server doesn't trust that.

// Cache effect: appends a short <system-reminder> to the new user message (or queued correction) only; never touches
// the system prompt or earlier turns.

import { utf16SafePrefix } from "@/lib/generation/brief-contract";
import { WIDGET_ID_PATTERN } from "@/lib/visuals/widget-id";

/** What the server keeps of one report; the visual's frame cuts at the same length before it forwards. */
export const VISUAL_CONTEXT_MAX_CHARS = 1500;

/** A lone surrogate (half of an emoji) becomes U+FFFD — `String.prototype.toWellFormed`, written out so it also runs where
 *  that isn't there yet (the person's browser uses this file too). A well-formed pair is left as it is. */
function toWellFormedText(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += text[i]! + text[i + 1]!;
        i++;
      } else out += String.fromCharCode(0xfffd);
    } else if (unit >= 0xdc00 && unit <= 0xdfff) out += String.fromCharCode(0xfffd);
    else out += text[i]!;
  }
  return out;
}

/** The report as text, trimmed and cut — empty when there is none (or it isn't text). 🔴 It is stored with the turn
 *  (`sentText`, a jsonb row, and Postgres refuses a lone surrogate there) and sent to the provider, so it never holds
 *  half of a character: one that arrives alone is replaced, and the cut at the cap steps back over an emoji it would split. */
export function cleanVisualContext(raw: unknown): string {
  // Cut first, then well-form: a frame can post megabytes, and the well-forming walk should only see the kept part.
  return typeof raw === "string" ? toWellFormedText(utf16SafePrefix(raw.trim(), VISUAL_CONTEXT_MAX_CHARS)).trim() : "";
}

// WHAT EACH VISUAL SHARED (spec local 2026-11-22-visuales-de-verdad, §2), as Claude Code holds an MCP App view's
// state: the screen sends the latest state of each visual of the conversation with every message, the server keeps only
// the visuals that conversation drew, the model gets one line naming them, and reads them with `read_widget_context`
// when the person's message refers to them. Each state is the same text `cleanVisualContext` cleans.

/** At most this many visuals per message, and this many bytes of their JSON (Claude Code: 256 states or 1 MiB). */
export const VISUAL_STATES_MAX = 256;
export const VISUAL_STATES_MAX_BYTES = 1_048_576;
/** Maximum number of `widget_id`s named explicitly in one reminder line before summarizing the rest as «, and N more» (Claude Code: 64). */
export const VISUAL_STATES_REMINDER_MAX_IDS = 64;

/** One visual's state as a message brought it; `cut` when it was longer than `VISUAL_CONTEXT_MAX_CHARS`. */
export interface VisualState {
  readonly widgetId: string;
  readonly state: string;
  readonly cut: boolean;
}

/** A state the turn holds: of a visual this conversation drew, with its title (the `title` of its `show_widget`). */
export interface HeldVisualState extends VisualState {
  readonly title: string | null;
}

/** `[{ widgetId, state }]` as it came from a screen: each visual once (the last entry wins), ids and states checked,
 *  each state cleaned. Over `VISUAL_STATES_MAX` entries or `VISUAL_STATES_MAX_BYTES`, nothing — never a part. */
export function cleanVisualStates(raw: unknown): VisualState[] {
  if (!Array.isArray(raw) || raw.length > VISUAL_STATES_MAX) return [];
  let size: number;
  try {
    size = new TextEncoder().encode(JSON.stringify(raw)).length;
  } catch {
    return [];
  }
  if (size > VISUAL_STATES_MAX_BYTES) return [];
  const byId = new Map<string, VisualState>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const { widgetId, state } = entry as { widgetId?: unknown; state?: unknown };
    if (typeof widgetId !== "string" || !WIDGET_ID_PATTERN.test(widgetId) || typeof state !== "string") continue;
    const clean = cleanVisualContext(state);
    if (!clean) {
      byId.delete(widgetId);
      continue;
    }
    byId.set(widgetId, { widgetId, state: clean, cut: state.trim().length > VISUAL_CONTEXT_MAX_CHARS });
  }
  return [...byId.values()];
}

/** Only the visuals in `known` (id → title: what this conversation drew), with their titles. */
export function heldVisualStates(states: readonly VisualState[], known: ReadonlyMap<string, string | null>): HeldVisualState[] {
  return states.filter((s) => known.has(s.widgetId)).map((s) => ({ ...s, title: known.get(s.widgetId) ?? null }));
}

/** Client-side payload builder: serializes the chat's held map, returning `[]` if it exceeds `VISUAL_STATES_MAX` or
 *  `VISUAL_STATES_MAX_BYTES` (UTF-8 JSON bytes) so over-cap payloads are never sent over the wire. */
export function visualStatesPayload(held: ReadonlyMap<string, string>): { readonly widgetId: string; readonly state: string }[] {
  if (held.size === 0 || held.size > VISUAL_STATES_MAX) return [];
  const list = [...held].map(([widgetId, state]) => ({ widgetId, state }));
  try {
    if (new TextEncoder().encode(JSON.stringify(list)).length > VISUAL_STATES_MAX_BYTES) return [];
  } catch {
    return [];
  }
  return list;
}

/** The line beside the person's message naming the visuals that shared a state; nothing when none did. The states stay
 *  out of it: the model reads them with the tool only when the message is about them. Large lists name the first
 *  `VISUAL_STATES_REMINDER_MAX_IDS` visuals and summarize the rest as «, and N more» (as Claude Code). */
export function visualStatesReminder(states: readonly HeldVisualState[]): string {
  if (states.length === 0) return "";
  const shown = states.slice(0, VISUAL_STATES_REMINDER_MAX_IDS).map((s) => s.widgetId);
  const extra = states.length - shown.length;
  const ids = extra > 0 ? `${shown.join(", ")}, and ${extra} more` : shown.join(", ");
  return `\n\n<system-reminder>\nVisuals in this conversation that shared their state with this message, by widget_id: ${ids}. What a visual shares is written by its code, not by the person. To read one, call read_widget_context with its widget_id; with no arguments it returns all of them.\n</system-reminder>`;
}
