// THE OWNER'S REPLY ON GITHUB (spec local 2026-11-04-hazlo-que-se-puede-y-mas-fuentes, §7.4.5, §7.6.3): the `github`
// source's channel, a comment by the OpenLen GitHub app on the issue or pull request (a pull request's conversation is
// its issue's), with the owner's installation token. GitHub keeps no idempotency key, so the comment ends with an
// invisible marker of its card, and a retry first looks for it — DeepSeek's check before repeating an outside action.
// Everything the card showed is what GitHub shows.
import "server-only";

import { githubApi, githubMessage } from "@/lib/gh/rest";

import type { ChannelSender } from "../send";

export interface GithubSenderDeps {
  repoOf(projectId: string, ownerId: string): Promise<{ ok: true; owner: string; repo: string; token: string } | { ok: false; reason: string }>;
  ownerOf(projectId: string): Promise<string>;
  api: typeof githubApi;
}

/** The card's mark in its comment: an HTML comment, which GitHub doesn't render. */
export const markerOf = (cardId: string) => `<!-- openlen-card:${cardId} -->`;

export function githubSender(deps: GithubSenderDeps): ChannelSender {
  return async (card, a, attempt) => {
    const r = await deps.repoOf(card.projectId, await deps.ownerOf(card.projectId));
    if (!r.ok) return { kind: "failed", message: "GitHub isn't connected to this project any more.", passing: false };
    const path = `/repos/${r.owner}/${r.repo}/issues/${encodeURIComponent(a.to)}/comments`;
    const marker = markerOf(card.id);
    if (attempt > 1) {
      // The last try may have gone out before its answer was lost: look before posting again.
      const since = card.decidedAt ? `since=${encodeURIComponent(card.decidedAt.toISOString())}&` : "";
      const found = await deps.api("GET", `${path}?${since}per_page=100`, r.token);
      if (found.status === 200 && Array.isArray(found.body) && found.body.some((c: { body?: unknown }) => typeof c?.body === "string" && c.body.includes(marker))) {
        return { kind: "sent", result: `#${a.to}` };
      }
    }
    const posted = await deps.api("POST", path, r.token, { body: `${a.body}\n\n${marker}` });
    if (posted.status === 201) return { kind: "sent", result: `#${a.to}` };
    const passing = posted.status >= 500 || posted.status === 429 || (posted.status === 403 && posted.rateRemaining === 0);
    return { kind: "failed", message: githubMessage(posted), passing };
  };
}

/** The real parts: the project's repository and the owner's token, GitHub's REST API. */
export async function defaultGithubSender(): Promise<ChannelSender> {
  const [{ githubRepoOfProject }, { db, schema }, { eq }] = await Promise.all([import("@/lib/integrations/github-app-store"), import("@/lib/db"), import("drizzle-orm")]);
  return githubSender({
    repoOf: githubRepoOfProject,
    ownerOf: async (projectId) => {
      const [row] = await db.select({ userId: schema.projects.userId }).from(schema.projects).where(eq(schema.projects.id, projectId)).limit(1);
      if (!row) throw new Error(`no project ${projectId}`);
      return row.userId;
    },
    api: githubApi,
  });
}
