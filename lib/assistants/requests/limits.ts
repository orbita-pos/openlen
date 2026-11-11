// WHAT VISITORS ASK FOR AND SHE CAN'T DO — the limits (spec local 2026-11-06-asistente-propio, §4.3, §4.7, §6.5).
// Client-safe: no imports.

/** What one note keeps of what the visitor wanted. */
export const REQUEST_MAX_CHARS = 300;
/** A card's title, once tidied. */
export const CARD_TITLE_MAX = 120;
/** One visit notes at most this many in a day: a chatty visitor can't fill the owner's cards. */
export const REQUESTS_PER_VISIT_DAY = 3;
/** One assistant notes at most this many in a day, across her projects: a script with many visitor ids can't either. */
export const REQUESTS_PER_ASSISTANT_DAY = 200;
/** One grouping turn reads at most this many waiting requests (the oldest).
 *
 *  MEASURED on 09/11 (phase 3, task 9: the real groupOne on a throwaway base, DeepSeek V4.1 Flash on DeepInfra):
 *  12 requests (5 about delivery in Spanish and English, 3 bookings, 2 loose, 2 hostile) → ONE call, 3.5 s, 8
 *  centicredits ($0.00021): 5 cards, the 5 delivery ones on one card, both hostile ones discarded (no title carried
 *  them), one notice. Two more delivery requests → one call, 0.6 s, 2 centicredits, 768 of 932 input tokens cached:
 *  they joined that card (7 people) with no new notice. A batch of 40 is ~1.5k input tokens — about a dozen
 *  centicredits at worst, under a visitor's turn reserve (VISITOR_TURN_RESERVE, 50). One real visitor message asking
 *  for what the page doesn't say called note_request without the email it carried (9 centicredits, 2 calls). */
export const GROUP_BATCH = 40;
/** One pass groups at most this many (assistant, project) pairs. */
export const GROUPS_PER_PASS = 20;
/** A pair is grouped once its oldest waiting request is this old: a burst of visitors ends on one card. */
export const GROUP_QUIET_MS = 600_000;
/** An asleep owner's pair (no credits, no room in the cap) steps aside this long, so it can't fill every pass. */
export const GROUP_ASLEEP_RETRY_MS = 3_600_000;
/** A pair whose grouping failed steps aside this long. */
export const GROUP_FAILED_RETRY_MS = 1_800_000;
/** How often the pass runs. */
export const GROUP_PASS_MS = 300_000;
/** A request no grouping placed this many times is discarded. */
export const GROUP_MAX_ATTEMPTS = 3;
/** The grouping turn's steps: one call of `group_requests`, and one more if the first went wrong. */
export const GROUP_MAX_STEPS = 2;
/** A waiting card notifies again once, when this many visitors have asked. */
export const NOTIFY_AGAIN_AT = 5;
/** At most this many notices a day per assistant and project: a script spacing its requests can't fill the owner's
 *  inbox; the cards still reach the chat and «Pedidos». */
export const NOTICES_PER_PAIR_DAY = 3;
/** «Ahora no» silences a card for this long: what visitors ask for the same thing joins it without a notice. */
export const DISMISSED_JOIN_DAYS = 30;
