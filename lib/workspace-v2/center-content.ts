/**
 * What the center of the workspace shows, the way Claude shows an artifact: the conversation takes the middle
 * while there is nothing to look at, the panel opens when something exists. Here "something" is the page (or the
 * app, which always runs on the canvas) and, failing that, a deliverable Len made — a deck, a dashboard, an image,
 * a video or a voice.
 *
 * Pure: `/new` decides with it, and the chat's deliverable card reads which pieces a turn touched.
 *
 * `null` is "not known yet": the project has not arrived (`hasPage`), or its deliverables have not (`deliverables`).
 * Until the answer is known the center is `pending` and shows neither layout: drawing the docked chat beside a
 * canvas and then jumping to the conversation alone was the flash on every reload of a project with no page.
 */
export type CenterContent = "pending" | "conversation" | "deliverable" | "canvas";

export function centerContent(p: { readonly hasPage: boolean | null; readonly isApp: boolean; readonly deliverables: number | null }): CenterContent {
  if (p.hasPage || p.isApp) return "canvas";
  if (p.hasPage === null || p.deliverables === null) return "pending";
  return p.deliverables > 0 ? "deliverable" : "conversation";
}

const ARTIFACT_ID = /"artifactId":"([0-9a-f-]{36})"/i;
const TOOLS_THAT_NAME_A_PIECE = new Set(["create_artifact", "render_artifact"]);

/** The pieces a turn created or queued, once each and in the order Len touched them. The client keeps an
 *  action's `valores` cut at 200 characters, so the id is read from the text, not by parsing it. */
export function artifactIdsOfTurn(actions: readonly { readonly tool: string; readonly status: string; readonly summary?: string; readonly valores?: string }[] | undefined): string[] {
  const ids: string[] = [];
  for (const action of actions ?? []) {
    if (!TOOLS_THAT_NAME_A_PIECE.has(action.tool) || action.status === "error" || !action.valores) continue;
    const id = ARTIFACT_ID.exec(action.valores)?.[1];
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}
