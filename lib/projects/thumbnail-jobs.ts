import { thumbnailsEnabled } from "@/lib/publish/kill-switches";
import { createThumbnailQueue } from "./thumbnail-queue";

// Next may instantiate modules in more than one route bundle, as it does for
// the active-turn registry. A single queue prevents duplicate browser work.
const KEY = Symbol.for("openlen.project.thumbnail-jobs");
type Queue = ReturnType<typeof createThumbnailQueue>;
const registry = globalThis as typeof globalThis & { [KEY]?: Queue };
const queue = registry[KEY] ??= createThumbnailQueue(async (projectId) => {
  try {
    const { refreshDraftThumbnail } = await import("./thumbnail-refresh");
    return await refreshDraftThumbnail(projectId);
  } catch (error) {
    console.warn(`[thumbnail] draft refresh failed for ${projectId}`, error);
    throw error;
  }
});

export function scheduleDraftThumbnail(projectId: string): boolean {
  if (!thumbnailsEnabled()) return false;
  queue.schedule(projectId);
  return queue.pending(projectId);
}
