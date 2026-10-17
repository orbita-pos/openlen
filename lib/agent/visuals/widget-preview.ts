/**
 * A VISUAL WHILE LEN WRITES IT (local spec 2026-10-16-len-inline-visuals, §4.4).
 *
 * The twin of `lib/agent/write-preview.ts` for `show_widget`: it reads the code
 * from the argument chunks Fireworks yields (`function_call_delta`) BEFORE the
 * call ends, so the chat can paint it as it grows. Only shown: what counts is
 * the finished call, which goes through `parseWidgetArgs` as always.
 *
 * Pure, no heavy imports: vitest runs it without the binding or the database.
 */
import { readStringField } from "../write-preview";
import { MAX_LOADING_MESSAGES, MAX_LOADING_MESSAGE_CHARS, SHOW_WIDGET } from "./widget";

/** How many NEW characters of code before the chat repaints. A visual is
 *  small, and the frame updates in place: more often than a page. */
export const WIDGET_PREVIEW_STEP_CHARS = 400;

export interface WidgetPreview {
  readonly callIndex: number;
  readonly title: string | null;
  readonly loadingMessages: readonly string[];
  readonly code: string;
}

/** The `loading_messages` list, only once it arrived WHOLE (its closing `]`). */
function readCompleteStringList(src: string, key: string): string[] {
  const match = new RegExp(`"${key}"\\s*:\\s*\\[`).exec(src);
  if (!match) return [];
  const start = match.index + match[0].length - 1;
  let inString = false;
  for (let i = start + 1; i < src.length; i++) {
    const ch = src[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === "]") {
      try {
        const list: unknown = JSON.parse(src.slice(start, i + 1));
        return Array.isArray(list)
          ? list
              .filter((m): m is string => typeof m === "string" && m.trim() !== "")
              .slice(0, MAX_LOADING_MESSAGES)
              .map((m) => m.slice(0, MAX_LOADING_MESSAGE_CHARS))
          : [];
      } catch {
        return [];
      }
    }
  }
  return [];
}

export function createWidgetPreview(step: number = WIDGET_PREVIEW_STEP_CHARS) {
  const calls = new Map<number, { name?: string; args: string; painted: number }>();
  return {
    push(delta: { readonly index: number; readonly name?: string; readonly argsDelta: string }): WidgetPreview | null {
      const prev = calls.get(delta.index);
      const call = {
        name: delta.name ?? prev?.name,
        args: (prev?.args ?? "") + delta.argsDelta,
        painted: prev?.painted ?? 0,
      };
      calls.set(delta.index, call);
      if (call.name !== SHOW_WIDGET) return null;
      const code = readStringField(call.args, "widget_code");
      if (!code) return null;
      if (code.value.length - call.painted < step) return null;
      call.painted = code.value.length;
      const title = readStringField(call.args, "title");
      return {
        callIndex: delta.index,
        title: title?.complete ? title.value : null,
        loadingMessages: readCompleteStringList(call.args, "loading_messages"),
        code: code.value,
      };
    },
  };
}
