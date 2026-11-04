// THE OWNER'S REPLY ON GITHUB (spec local 2026-11-04-hazlo-que-se-puede-y-mas-fuentes, §7.4.5, §7.6.3): the `github`
// source's channel, a comment by the OpenLen GitHub app on the issue or pull request (a pull request's conversation is
// its issue's), with the owner's installation token. GitHub keeps no idempotency key, so the comment ends with an
// invisible marker of its card, and a retry first looks for it — DeepSeek's check before repeating an outside action.
// Everything the card showed is what GitHub shows.
import "server-only";

import { githubApi, githubMessage } from "@/lib/gh/rest";

import type { EventTaskCardRow } from "../../store";
import type { ChannelSender } from "../send";

export interface GithubSenderDeps {
  repoOf(
    projectId: string,
    ownerId: string,
    token: undefined,
    pinned: { readonly owner: string; readonly repo: string },
  ): Promise<{ ok: true; owner: string; repo: string; token: string } | { ok: false; reason: string }>;
  /** The repository the card's task watches: the issue the judge read is one of ITS issues (final review I4). */
  pinnedOf(card: EventTaskCardRow): Promise<{ owner: string; repo: string } | null>;
  ownerOf(projectId: string): Promise<string>;
  api: typeof githubApi;
}

/** The card's mark in its comment: an HTML comment, which GitHub doesn't render. */
export const markerOf = (cardId: string) => `<!-- openlen-card:${cardId} -->`;

export function githubSender(deps: GithubSenderDeps): ChannelSender {
  return async (card, a) => {
    const pinned = await deps.pinnedOf(card);
    if (!pinned) return { kind: "failed", message: "This card's task no longer exists.", passing: false };
    const r = await deps.repoOf(card.projectId, await deps.ownerOf(card.projectId), undefined, pinned);
    // No token right now may be GitHub's token endpoint failing for a moment: the backoff tries again until the day ends.
    if (!r.ok) return { kind: "failed", message: "GitHub isn't connected to this project's repository now.", passing: r.reason === "no_token" };
    const path = `/repos/${r.owner}/${r.repo}/issues/${encodeURIComponent(a.to)}/comments`;
    const marker = markerOf(card.id);
    // Always look first: an earlier try — this press's, or the watcher's — may have gone out without its answer, and
    // nothing at GitHub refuses a second comment (final review I1). Not knowing is not «not there»: try again later.
    const since = card.decidedAt ? `since=${encodeURIComponent(card.decidedAt.toISOString())}&` : "";
    const found = await deps.api("GET", `${path}?${since}per_page=100`, r.token);
    if (found.status !== 200 || !Array.isArray(found.body)) return { kind: "failed", message: githubMessage(found), passing: true };
    if (found.body.some((c: { body?: unknown }) => typeof c?.body === "string" && c.body.includes(marker))) return { kind: "sent", result: `#${a.to}` };
    const posted = await deps.api("POST", path, r.token, { body: `${a.body}\n\n${marker}` });
    if (posted.status === 201) return { kind: "sent", result: `#${a.to}` };
    // A secondary rate limit is a 403 with Retry-After and requests left: waiting fixes it too.
    const limited = posted.status === 403 && (posted.rateRemaining === 0 || posted.retryAfter !== null);
    const passing = posted.status >= 500 || posted.status === 429 || limited;
    return { kind: "failed", message: githubMessage(posted), passing };
  };
}

/** The real parts: the project's repository and the owner's token, GitHub's REST API. */
export async function defaultGithubSender(): Promise<ChannelSender> {
  const [{ githubRepoOfProject }, { db, schema }, { eq }] = await Promise.all([import("@/lib/integrations/github-app-store"), import("@/lib/db"), import("drizzle-orm")]);
  return githubSender({
    repoOf: (projectId, ownerId, _token, pinned) => githubRepoOfProject(projectId, ownerId, undefined, pinned),
    pinnedOf: async (card) => {
      const [row] = await db.select({ state: schema.eventTasks.state }).from(schema.eventTasks).where(eq(schema.eventTasks.id, card.taskId)).limit(1);
      const s = row?.state as { owner?: unknown; repo?: unknown } | null | undefined;
      return typeof s?.owner === "string" && typeof s?.repo === "string" ? { owner: s.owner, repo: s.repo } : null;
    },
    ownerOf: async (projectId) => {
      const [row] = await db.select({ userId: schema.projects.userId }).from(schema.projects).where(eq(schema.projects.id, projectId)).limit(1);
      if (!row) throw new Error(`no project ${projectId}`);
      return row.userId;
    },
    api: githubApi,
  });
}
