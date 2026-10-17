/**
 * `read_me` AND `show_widget`, LEN'S VISUALS (local spec 2026-10-16-len-inline-visuals).
 *
 * The names, parameters and split are those of Claude's visualize tools: the
 * manual is asked for on demand, so a turn that draws nothing doesn't pay for
 * it. The words are ours: the repo is public, and no Anthropic prose is copied.
 *
 * `show_widget` hands its widget back in `ToolOutcome.widget`; the loop puts it
 * on the `action` event and the stored card is its only copy.
 */
import { CLAVE_TOOL_RESULT, fallo } from "@/lib/agent/ficheros/resultado";
import type { ToolOutcome } from "@/lib/agent/tools";
import { buildVisualsManual, type VisualPlatform } from "./manual";
import { READ_ME, SHOW_WIDGET, VISUAL_MODULES, WidgetArgsError, parseWidgetArgs, type VisualModule } from "./widget";

const PLATFORMS: readonly VisualPlatform[] = ["mobile", "desktop", "unknown"];

export const READ_ME_DECLARATION: Record<string, unknown> = {
  name: READ_ME,
  description:
    "Returns the design manual for show_widget: the CSS variables the chat provides, layout and streaming rules, and guidance for each module. " +
    "Call it once before your first show_widget in a conversation, and again only to load a module you haven't loaded yet. " +
    "Don't mention this call to the user.",
  parameters: {
    type: "OBJECT",
    properties: {
      modules: {
        type: "ARRAY",
        description: "Which module guides to include. Pick the ones that fit the visual you're about to make.",
        items: { type: "STRING", enum: [...VISUAL_MODULES] },
      },
      platform: {
        type: "STRING",
        enum: [...PLATFORMS],
        description: "Where the user is reading: mobile (a phone) or desktop. Use unknown if you can't tell.",
      },
    },
  },
};

export const SHOW_WIDGET_DECLARATION: Record<string, unknown> = {
  name: SHOW_WIDGET,
  description:
    "Show a visual inside your reply in the chat — a chart, a diagram, a mockup or a small interactive tool — when seeing it helps more than reading; " +
    "when plain text is clearer, answer in text. Write the explanation in your reply and put only the visual here. " +
    "Show only figures that came from your tools, never made-up ones.",
  parameters: {
    type: "OBJECT",
    properties: {
      title: {
        type: "STRING",
        description: "A short snake_case name for this visual, specific enough to tell it apart from the others in the conversation.",
      },
      loading_messages: {
        type: "ARRAY",
        description:
          "One to four short phrases (about five words each) shown while the visual loads, in the user's language. Keep them plain when the topic is serious.",
        items: { type: "STRING" },
      },
      widget_code: {
        type: "STRING",
        description:
          "An HTML fragment (no <html>, <head> or <body>) or an SVG that starts with <svg. Put a short <style> first, then the content, and any <script> last: " +
          "it is shown while you write it, and its scripts run when you finish.",
      },
    },
    required: ["title", "loading_messages", "widget_code"],
  },
};

export const SHOW_WIDGET_RESULT = "Shown to the user in the chat. Don't repeat in text what the visual already shows.";

function toolError(message: string): ToolOutcome {
  const r = fallo(message);
  return { response: { ok: false, error: r.error, [CLAVE_TOOL_RESULT]: r.texto } };
}

export function toolReadMe(args: Record<string, unknown>): ToolOutcome {
  const asked = Array.isArray(args.modules) ? args.modules : [];
  const modules: VisualModule[] = [];
  for (const m of asked) {
    if (!(VISUAL_MODULES as readonly unknown[]).includes(m)) {
      return toolError(`Unknown module: ${String(m)}. Available: ${VISUAL_MODULES.join(", ")}.`);
    }
    modules.push(m as VisualModule);
  }
  const platform = PLATFORMS.includes(args.platform as VisualPlatform) ? (args.platform as VisualPlatform) : "unknown";
  return { response: { ok: true, [CLAVE_TOOL_RESULT]: buildVisualsManual(modules, platform) } };
}

export function toolShowWidget(args: Record<string, unknown>): ToolOutcome {
  try {
    const widget = parseWidgetArgs(args);
    return { response: { ok: true, [CLAVE_TOOL_RESULT]: SHOW_WIDGET_RESULT }, widget };
  } catch (e) {
    if (!(e instanceof WidgetArgsError)) throw e;
    return toolError(e.message);
  }
}
