// What a browser gets of the person's own assistant: never its memory. Pure.
import type { AssistantShape, AssistantTone } from "./names";

export interface AssistantView {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly shape: AssistantShape;
  readonly color: string;
  readonly tone: AssistantTone;
  readonly projectId: string;
}

/** In the person's list: also the projects she serves (her home is `projectId`). */
export interface AssistantListItem extends AssistantView {
  readonly projectIds: readonly string[];
}

export function assistantView(a: { id: string; name: string; slug: string; shape: string; color: string; tone: string; homeProjectId: string }): AssistantView {
  return { id: a.id, name: a.name, slug: a.slug, shape: a.shape as AssistantShape, color: a.color, tone: a.tone as AssistantTone, projectId: a.homeProjectId };
}
