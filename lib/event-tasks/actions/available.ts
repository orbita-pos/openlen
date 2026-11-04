// WHAT A TASK'S CARD MAY PROPOSE (spec local 2026-11-04-hazlo-que-se-puede-y-mas-fuentes, §7.1): DeepSeek's channels —
// each source declares what can be done with what it sees — and work in the project, always. A reply needs the
// project's email ready (a paid owner and a verified domain); without it, the judge isn't offered one at all.
import "server-only";

import { sourceOf } from "../sources";
import type { EventTaskRow } from "../store";

export interface AvailableActions {
  readonly project: true;
  readonly dataChange: boolean;
  readonly reply: boolean;
}

export interface AvailableDeps {
  emailReady(projectId: string): Promise<boolean>;
}

export async function availableActions(task: EventTaskRow, deps: AvailableDeps): Promise<AvailableActions> {
  const offers = sourceOf(task.source).offers;
  return { project: true, dataChange: offers.dataChange, reply: offers.replyByEmail && (await deps.emailReady(task.projectId)) };
}

/** The project's email as it is now: on, a paid owner, a ready domain (lib/project-email/state.ts). */
export function defaultAvailableDeps(): AvailableDeps {
  return {
    emailReady: async (projectId) => {
      const { emailStateFor } = await import("@/lib/project-email/state");
      const state = await emailStateFor(projectId);
      return state !== null && state.status === "ready" && state.plan !== "free";
    },
  };
}
