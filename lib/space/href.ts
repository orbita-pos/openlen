// THE SPACE'S ADDRESS (spec local 2026-11-19-agentes-para-todos, §6.3): `/space`. `brief` is what the home sends with
// its one-use ticket (the page sends it once); `draft` only fills the composer («Cambiar a…»). Pure.
import { isSpaceData } from "./types";

/** Where the workshop sends a project it opens: the space is never opened as a page (an old link, Len's own chat
 *  naming it), it goes to `/space`; any other project stays (null). */
export function spaceRedirectOf(data: { space?: unknown } | null | undefined): string | null {
  return isSpaceData(data) ? spaceHref() : null;
}

export function spaceHref(q: { readonly brief?: string; readonly draft?: string; readonly first?: string } = {}): string {
  const params = new URLSearchParams();
  // `first`: the home's ticket id, for a message too long for a URL (see newProjectHref).
  if (q.first) params.set("first", q.first);
  else if (q.brief) params.set("brief", q.brief);
  else if (q.draft) params.set("draft", q.draft);
  const query = params.toString();
  return query ? `/space?${query}` : "/space";
}
