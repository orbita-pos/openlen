/**
 * A VISUAL IN LEN'S REPLY (local spec 2026-10-16-len-inline-visuals): the data
 * that `show_widget` carries, as Claude's visualize tools shape it — a short
 * title, one to four loading messages and the code (an HTML fragment or an SVG).
 *
 * No server imports: the chat (client) and the chat-save schema use it too.
 * The code is never sanitized and never reaches the project's files: it lives
 * only in the turn's stored action, and the isolated frame is what protects it.
 */

export const READ_ME = "read_me";
export const SHOW_WIDGET = "show_widget";

export const VISUAL_MODULES = ["chart", "diagram", "mockup", "interactive"] as const;
export type VisualModule = (typeof VISUAL_MODULES)[number];

export const MAX_WIDGET_CODE_CHARS = 60_000;
export const MAX_WIDGET_TITLE_CHARS = 80;
export const MAX_LOADING_MESSAGES = 4;
export const MAX_LOADING_MESSAGE_CHARS = 80;

export interface VisualWidget {
  readonly title: string;
  readonly loadingMessages: readonly string[];
  readonly code: string;
}

/** A `show_widget` call the model has to fix; the message is for the model. */
export class WidgetArgsError extends Error {}

const FULL_DOCUMENT = /^\s*<(!doctype|html[\s>])/i;

export function parseWidgetArgs(args: Record<string, unknown>): VisualWidget {
  const code = args.widget_code;
  if (typeof code !== "string" || code.trim() === "") {
    throw new WidgetArgsError("widget_code is required: an HTML fragment or an SVG that starts with <svg.");
  }
  if (code.length > MAX_WIDGET_CODE_CHARS) {
    throw new WidgetArgsError(
      `widget_code is ${code.length} characters; the limit is ${MAX_WIDGET_CODE_CHARS}. Make the visual smaller.`,
    );
  }
  if (FULL_DOCUMENT.test(code)) {
    throw new WidgetArgsError("widget_code must be a fragment: leave out <!doctype>, <html>, <head> and <body>.");
  }
  const messages = args.loading_messages;
  if (
    !Array.isArray(messages) ||
    messages.length < 1 ||
    messages.length > MAX_LOADING_MESSAGES ||
    messages.some((m) => typeof m !== "string" || m.trim() === "")
  ) {
    throw new WidgetArgsError(`loading_messages must be a list of 1 to ${MAX_LOADING_MESSAGES} short, non-empty phrases.`);
  }
  return {
    title: typeof args.title === "string" ? args.title.slice(0, MAX_WIDGET_TITLE_CHARS) : "",
    loadingMessages: (messages as string[]).map((m) => m.slice(0, MAX_LOADING_MESSAGE_CHARS)),
    code,
  };
}

/** A widget read back from the wire or from a stored turn, cleaned: `null` when
 *  there is no usable code (missing, empty, over the limit). A bad title or bad
 *  messages are cleaned, never a reason to lose the visual. */
export function widgetFrom(value: unknown): VisualWidget | null {
  if (!value || typeof value !== "object") return null;
  const v = value as { title?: unknown; loadingMessages?: unknown; code?: unknown };
  if (typeof v.code !== "string" || v.code === "" || v.code.length > MAX_WIDGET_CODE_CHARS) return null;
  const messages = Array.isArray(v.loadingMessages)
    ? v.loadingMessages
        .filter((m): m is string => typeof m === "string")
        .slice(0, MAX_LOADING_MESSAGES)
        .map((m) => m.slice(0, MAX_LOADING_MESSAGE_CHARS))
    : [];
  return {
    title: typeof v.title === "string" ? v.title.slice(0, MAX_WIDGET_TITLE_CHARS) : "",
    loadingMessages: messages,
    code: v.code,
  };
}

export function isSvgWidget(code: string): boolean {
  return code.trimStart().startsWith("<svg");
}
