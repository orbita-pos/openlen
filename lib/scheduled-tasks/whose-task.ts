// WHOSE TASK IT IS (spec local 2026-11-19-agentes-para-todos, §6.4; final review I3). Len's task is the project's:
// whoever may edit the project may change it, as before. An agent's task runs as that agent, with its person's
// private context (their memory, their connectors, `ask_len`), so only that person may see or change it: for
// anyone else it isn't there, exactly like the owner's event tasks for a member.
import "server-only";

import { getTask } from "./store";

/** Whether this task is an agent's that belongs to someone other than `userId`. A task that doesn't exist is not. */
export async function someoneElsesAgentTask(projectId: string, taskId: string, userId: string): Promise<boolean> {
  const task = await getTask(projectId, taskId);
  if (!task?.assistantId) return false;
  const { assistantById } = await import("@/lib/assistants/store");
  return (await assistantById(task.assistantId))?.personId !== userId;
}
