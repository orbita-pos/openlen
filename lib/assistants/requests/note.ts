// `note_request` (spec local 2026-11-06-asistente-propio, §4.3.1): in the bubble she notes, for her person, something a
// visitor wanted that she can't do or doesn't know and the business could offer. It only saves a row: what was noted
// never enters another visitor's turn, and only her person's press ever turns it into Len's work (./press.ts).
//
// Pure but for the store it is given.
import type { ToolOutcome } from "@/lib/agent/tools";
import { CLAVE_TOOL_RESULT, fallo } from "@/lib/agent/ficheros/resultado";

import { REQUEST_MAX_CHARS } from "./limits";
import type { noteRequest } from "./store";

export const NOTE_REQUEST = "note_request";

export const NOTE_REQUEST_DECLARATION = {
  name: NOTE_REQUEST,
  description:
    "Notes, for the business's owner, something the visitor wanted that you can't do or don't know and the business could offer — " +
    "a service, a product, delivery, a way to book. The owner sees it later, joined with what other visitors asked; nothing happens now. " +
    "Noting is progress, not an answer: answer the visitor directly with what the business's information says. At most once per answer.",
  parameters: {
    type: "OBJECT",
    properties: {
      request: {
        type: "STRING",
        description: "What they wanted, in one sentence, without names, emails or phone numbers.",
      },
    },
    required: ["request"],
  },
} as const;

const EMAIL = /[^\s@<>()[\]]+@[^\s@<>()[\]]+\.[^\s@<>()[\]]+/g;
const PHONE = /\+?\d[\d\s().-]{6,}\d/g;

/** Emails and phone numbers become `[contact]`: the owner's cards hold what people wanted, never who they are. */
export function scrubContact(text: string): string {
  return text.replace(EMAIL, "[contact]").replace(PHONE, "[contact]");
}

/** Phase 4E (measured twice on 10/11): after noting she answered «ya lo anoté» / «ya quedó anotado», though the page said
 *  «No hacemos envíos». DeepSeek's Super-agent replies: «Do not relabel progress as an answer». */
const NOTED = "Noted for the owner. That is progress, not an answer: answer the visitor directly with what the business's information says, a «no» included; you may add that you'll pass it on; promise nothing.";

function refused(message: string): ToolOutcome {
  const r = fallo(message);
  return { response: { ok: false, error: r.error, [CLAVE_TOOL_RESULT]: r.texto } };
}

/** The tool for one visitor's turn: one note per answer. Over a limit she hears the same «noted» (nothing is stored):
 *  a visitor can't probe the limits through her words. A note that can't be saved never costs the answer — she is
 *  told not to promise it was passed on. */
export function noteRequestTool(ctx: {
  readonly assistantId: string;
  readonly projectId: string;
  readonly visitorId: string;
  /** The page's language (`siteLocale`): what the card and its email are written in. */
  readonly locale: string;
  readonly at: Date;
  readonly note: typeof noteRequest;
}): (args: Record<string, unknown>) => Promise<ToolOutcome> {
  let used = false;
  return async (args) => {
    const raw = typeof args.request === "string" ? args.request : "";
    const text = scrubContact(raw.replace(/\s+/g, " ").trim()).slice(0, REQUEST_MAX_CHARS).trim();
    if (!text) return refused("Say in one sentence what the visitor wanted.");
    if (used) return refused("Already noted once in this answer: say the rest in words.");
    used = true;
    try {
      await ctx.note({ assistantId: ctx.assistantId, projectId: ctx.projectId, visitorId: ctx.visitorId, text, locale: ctx.locale, at: ctx.at });
    } catch (err) {
      console.warn("[assistant-visitor] a request couldn't be noted", err);
      return refused("Couldn't note it: don't say you passed it on.");
    }
    return { response: { ok: true, tool_result: NOTED } };
  };
}
