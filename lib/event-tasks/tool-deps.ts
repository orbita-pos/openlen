// WHAT THE SCHEDULE TOOLS REACH EVENT TASKS THROUGH (spec local 2026-11-03-len-que-avisa, §7.7): the store, the
// source's own check and the cards, for `/api/agent` to hand to `schedule_create/list/delete/update`.
import "server-only";

import type { EventTasksToolDeps } from "@/lib/agent/schedule-tools";

import { latestCards } from "./cards";
import { sourceOf } from "./sources";
import { SourceError } from "./sources/types";
import { createEventTask, deleteEventTask, getEventTask, listEventTasks, updateEventTask } from "./store";

export const eventTasksToolDeps: EventTasksToolDeps = {
  async validate(source, projectId, params) {
    try {
      return await sourceOf(source).validate(projectId, params);
    } catch (error) {
      // A source that fails in a way the owner can understand says so; anything else is the tool's internal error.
      if (error instanceof SourceError) return { ok: false, reason: error.message };
      throw error;
    }
  },
  create: createEventTask,
  list: listEventTasks,
  get: getEventTask,
  remove: deleteEventTask,
  update: updateEventTask,
  latestCards,
};
