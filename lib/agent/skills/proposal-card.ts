/**
 * WHAT THE REVIEW CARD READS (spec local 2026-11-19-agentes-para-todos, §6.6): a `propose_skills` action carries only the
 * ids of the proposals the server keeps (`skillProposals`; final review C2: the chat's save cuts an action's summary to
 * 200 characters). The card asks the server for them — only their person gets them. Client-safe: no node, no disk.
 */

/** The most proposals one call carries (`MAX_PROPOSALS`, kept here so the browser doesn't import the contract). */
const MOST = 3;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** What the card shows of one proposal (`GET /api/me/skills/proposals`). */
export interface ProposalView {
  readonly id: string;
  readonly name: string;
  readonly kind: "new" | "improvement";
  readonly target: string | null;
  readonly description: string;
  readonly skillMd: string;
  /** The person's skill of that name is already exactly this. */
  readonly saved: boolean;
}

/** The proposals' ids a `propose_skills` action carries; anything that isn't one is dropped. */
export function skillProposalIdsOf(action: { summary?: string }): string[] {
  try {
    const parsed = JSON.parse(action.summary ?? "") as { ids?: unknown };
    return Array.isArray(parsed.ids) ? parsed.ids.filter((id): id is string => typeof id === "string" && ID.test(id)).slice(0, MOST) : [];
  } catch {
    return [];
  }
}
