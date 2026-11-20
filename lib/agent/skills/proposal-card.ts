/**
 * WHAT THE REVIEW CARD READS (spec local 2026-11-19-agentes-para-todos, §6.6): the proposals a `propose_skills` action
 * carries in its summary. Client-safe — no node, no disk — so the card in the chat can import it.
 */
import type { ResolvedProposal } from "./proposals";

export type { ResolvedProposal } from "./proposals";

/** The most proposals one call carries (`MAX_PROPOSALS`, kept here so the browser doesn't import the contract). */
const MOST = 3;

const isProposal = (p: unknown): p is ResolvedProposal => {
  const x = p as ResolvedProposal | null;
  return (
    typeof x === "object" &&
    x !== null &&
    typeof x.name === "string" &&
    (x.kind === "new" || x.kind === "improvement") &&
    (x.target === null || typeof x.target === "string") &&
    typeof x.description === "string" &&
    typeof x.skillMd === "string" &&
    (x.base === null || typeof x.base === "string") &&
    typeof x.fingerprint === "string"
  );
};

/** The proposals a `propose_skills` action carries, for the card: anything malformed is dropped. */
export function skillProposalsOf(action: { summary?: string }): ResolvedProposal[] {
  try {
    const parsed = JSON.parse(action.summary ?? "") as { proposals?: unknown };
    return Array.isArray(parsed.proposals) ? parsed.proposals.filter(isProposal).slice(0, MOST) : [];
  } catch {
    return [];
  }
}
