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
// WHY IT MUST MATCH WHAT THE TAB ARRIVED WITH: the ticket only rides with the home's own link to /new — the brief in
// `?brief=`, or, for a message too long for a URL (24/11: the home has no 4,000 cap any more, as Claude Code has none),
// the ticket's own random id in `?first=`. Opening /new any other way — the menu, an old tab, a link with another brief
// or id — does not send it, and spends it. A link from elsewhere can't forge the id: it only exists in this tab.
//
// It survives the sign-in detour (same tab: /register or /login, an OAuth round trip, back to `next`), dies with the
// tab, is dropped when the visitor closes the sign-in dialog (they cancelled), and goes stale after 30 minutes.
//
// EVERY ACCESS IS IN try/catch: in a private window or with site data blocked `sessionStorage` THROWS. Losing the
// ticket only means pressing send once more on /new, which is what everyone did until today.
// ─────────────────────────────────────────────────────────────────────────────

import { isGenerationBriefLengthValid, trimGenerationBrief } from "@/lib/generation/brief-contract";
import { kindFromParam, type StartKind } from "@/components/workspace-v2/chat/nace-como";

const KEY = "openlen:first-message-in-transit";

/** How long the ticket waits for /new: long enough for a sign-up, short enough not to send something forgotten. */
export const FIRST_MESSAGE_TTL_MS = 30 * 60_000;

export interface FirstMessage {
  /** What the visitor wrote, trimmed. */
  readonly brief: string;
  /** What the project is born as: the home's pill. An agent's goes to the person's space instead of /new. */
  readonly kind: StartKind;
}

/** What /new (or the space) arrived with: the `?brief=` of its link, or the ticket's id in `?first=`. A bare string is
 *  the brief, as before. */
export type FirstMessageArrival = string | null | { readonly brief?: string | null; readonly first?: string | null };

/** A ticket's id: 16 hex characters, random — what `?first=` carries instead of a message too long for a URL. */
function newTicketId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Leaves the ticket just before going to /new (or opening the sign-in dialog). Its id, or null if the storage refused. */
export function leaveFirstMessage(message: FirstMessage, now: number = Date.now()): string | null {
  try {
    const id = newTicketId();
    sessionStorage.setItem(KEY, JSON.stringify({ id, brief: trimGenerationBrief(message.brief), kind: message.kind, at: now }));
    return id;
  } catch {
    return null;
  }
}

/** Reads AND REMOVES the ticket. It comes back only if it is fresh, sendable and for the brief /new arrived with. */
export function takeFirstMessage(arrival: FirstMessageArrival, now: number = Date.now()): FirstMessage | null {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
  } catch {
    return null;
  }
  return parseTicket(raw, arrival, now);
}

/** Whether /new arrives with a ticket it will send — WITHOUT spending it. /new has no box of its own (Jesús, 06/11:
 *  «¿para qué tener 2 inputs?»): with a ticket it opens the blank project and sends; without one it goes back to the
 *  home's box before opening anything. */
export function hasFirstMessage(arrival: FirstMessageArrival, now: number = Date.now()): boolean {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(KEY);
  } catch {
    return false;
  }
  return parseTicket(raw, arrival, now) !== null;
}

function parseTicket(raw: string | null, arrival: FirstMessageArrival, now: number): FirstMessage | null {
  if (!raw) return null;
  const { brief: arrivalBrief = null, first = null } = typeof arrival === "string" || arrival === null ? { brief: arrival } : arrival;
  let ticket: { id?: unknown; brief?: unknown; kind?: unknown; at?: unknown };
  try {
    ticket = JSON.parse(raw) as typeof ticket;
  } catch {
    return null;
  }
  if (typeof ticket?.brief !== "string" || typeof ticket.at !== "number") return null;
  if (now - ticket.at > FIRST_MESSAGE_TTL_MS) return null;
  const brief = trimGenerationBrief(ticket.brief);
  const byId = first !== null && typeof ticket.id === "string" && ticket.id === first;
  const byBrief = arrivalBrief !== null && brief === trimGenerationBrief(arrivalBrief);
  if (!byId && !byBrief) return null;
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
