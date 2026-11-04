// WHAT A TASK'S CARD MAY PROPOSE (spec local 2026-11-04-hazlo-que-se-puede-y-mas-fuentes, §7.1): DeepSeek's channels —
// each source declares what can be done with what it sees — and work in the project, always. A reply needs the
// project's email ready (a paid owner and a verified domain); without it, the judge isn't offered one at all.
import "server-only";

import { sourceOf } from "../sources";
import type { ReplyChannel } from "../sources/types";
import type { EventTaskRow } from "../store";

export interface AvailableActions {
  readonly project: true;
  readonly dataChange: boolean;
  /** The channels a reply can go by now: the source's, email only while the project's email is ready. */
  readonly replyChannels: readonly ReplyChannel[];
}

export interface AvailableDeps {
  emailReady(projectId: string): Promise<boolean>;
  /** Whether the owner's GitHub App gives a token for the project's repository now. */
  githubReady?(projectId: string, ownerId: string): Promise<boolean>;
}

/** The owner travels with the task: a channel of the owner's own account (GitHub) asks about it. */
export async function availableActions(task: EventTaskRow, ownerId: string, deps: AvailableDeps): Promise<AvailableActions> {
  const offers = sourceOf(task.source).offers;
  const replyChannels: ReplyChannel[] = [];
  for (const channel of offers.replies) {
    if (channel === "email" && !(await deps.emailReady(task.projectId))) continue;
    if (channel === "github") {
      // A check that fails (GitHub's token endpoint down) offers no GitHub reply: it must never fail the judge, which
      // would mark its change judged without a look (final review).
      const ready = deps.githubReady
        ? await deps.githubReady(task.projectId, ownerId).catch((err: unknown) => {
            console.warn(`[event-tasks] could not check GitHub for task ${task.id}`, err);
            return false;
          })
        : false;
      if (!ready) continue;
    }
    replyChannels.push(channel);
  }
  return { project: true, dataChange: offers.dataChange, replyChannels };
}

/** The project's email as it is now: on, a paid owner, a ready domain (lib/project-email/state.ts). */
export function defaultAvailableDeps(): AvailableDeps {
  return {
    emailReady: async (projectId) => {
      const { emailStateFor } = await import("@/lib/project-email/state");
      const state = await emailStateFor(projectId);
      return state !== null && state.status === "ready" && state.plan !== "free";
    },
    githubReady: async (projectId, ownerId) => {
      const [{ githubAppConfigured }, { githubRepoOfProject }] = await Promise.all([import("@/lib/integrations/github-app"), import("@/lib/integrations/github-app-store")]);
      return githubAppConfigured() && (await githubRepoOfProject(projectId, ownerId)).ok;
    },
  };
}
