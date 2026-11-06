"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE FIRST MESSAGE SENT FROM THE HOME (Jesús, 06/11: «dos inputs así es duplicación»).
//
// Until 06/11 the home's box only FILLED /new's: you wrote, pressed send, landed on your blank project with the same
// text in a second box, and pressed send again. Now pressing send on the home is THE send: the home leaves this
// one-use ticket in `sessionStorage` and /new, on arriving at the blank project, sends it as the first message to Len.
//
// WHY A TICKET AND NOT `?send=1` IN THE URL: a link is something anyone can write. `/new?brief=…&send=1` in an
// email or on another site would start a turn — on the visitor's credits, with a brief a stranger wrote — the moment
// it was opened. `sessionStorage` is written only by OpenLen's own pages, in this tab: a link from elsewhere still
// only FILLS the composer, as before.
//
// WHY IT MUST MATCH THE BRIEF THE TAB ARRIVED WITH: the ticket only rides with the home's own link to /new (the
// brief also travels in `?brief=`, which is what fills the box if the storage is blocked). Opening /new any other way
// — the menu, an old tab, a link with another brief — does not send it, and spends it.
//
// It survives the sign-in detour (same tab: /register or /login, an OAuth round trip, back to `next`), dies with the
// tab, is dropped when the visitor closes the sign-in dialog (they cancelled), and goes stale after 30 minutes.
//
// EVERY ACCESS IS IN try/catch: in a private window or with site data blocked `sessionStorage` THROWS. Losing the
// ticket only means pressing send once more on /new, which is what everyone did until today.
// ─────────────────────────────────────────────────────────────────────────────

import { isGenerationBriefLengthValid, trimGenerationBrief } from "@/lib/generation/brief-contract";
import { kindFromParam, type NaceComoApp } from "@/components/workspace-v2/chat/nace-como";

const KEY = "openlen:first-message-in-transit";

/** How long the ticket waits for /new: long enough for a sign-up, short enough not to send something forgotten. */
export const FIRST_MESSAGE_TTL_MS = 30 * 60_000;

export interface FirstMessage {
  /** What the visitor wrote, trimmed. */
  readonly brief: string;
  /** What the project is born as: the home's pill. */
  readonly kind: "pagina" | NaceComoApp;
}

/** Leaves the ticket just before going to /new (or opening the sign-in dialog). `false` if the storage refused. */
export function leaveFirstMessage(message: FirstMessage, now: number = Date.now()): boolean {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ brief: trimGenerationBrief(message.brief), kind: message.kind, at: now }));
    return true;
  } catch {
    return false;
  }
}

/** Reads AND REMOVES the ticket. It comes back only if it is fresh, sendable and for the brief /new arrived with. */
export function takeFirstMessage(arrivalBrief: string | null, now: number = Date.now()): FirstMessage | null {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
  } catch {
    return null;
  }
  return parseTicket(raw, arrivalBrief, now);
}

/** Whether /new arrives with a ticket it will send — WITHOUT spending it. /new has no box of its own (Jesús, 06/11:
 *  «¿para qué tener 2 inputs?»): with a ticket it opens the blank project and sends; without one it goes back to the
 *  home's box before opening anything. */
export function hasFirstMessage(arrivalBrief: string | null, now: number = Date.now()): boolean {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(KEY);
  } catch {
    return false;
  }
  return parseTicket(raw, arrivalBrief, now) !== null;
}

function parseTicket(raw: string | null, arrivalBrief: string | null, now: number): FirstMessage | null {
  if (!raw) return null;
  let ticket: { brief?: unknown; kind?: unknown; at?: unknown };
  try {
    ticket = JSON.parse(raw) as typeof ticket;
  } catch {
    return null;
  }
  if (typeof ticket?.brief !== "string" || typeof ticket.at !== "number") return null;
  if (now - ticket.at > FIRST_MESSAGE_TTL_MS) return null;
  const brief = trimGenerationBrief(ticket.brief);
  if (arrivalBrief === null || brief !== trimGenerationBrief(arrivalBrief)) return null;
  if (!isGenerationBriefLengthValid(brief)) return null;
  return { brief, kind: kindFromParam(typeof ticket.kind === "string" ? ticket.kind : null) };
}

/** The visitor closed the sign-in dialog: what they wrote is not on its way any more. */
export function dropFirstMessage(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* nothing to drop */
  }
}
