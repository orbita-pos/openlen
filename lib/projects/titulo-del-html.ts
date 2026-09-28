// Pure on purpose (no db): Len-Bench titles its projects with the same rule as
// createProject, and its tests can't pull the database in to reach it.

/** Pull the document <title> for the project name. */
export function titleFromHtml(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const inner = m?.[1]?.trim();
  return inner && inner.length > 0 ? inner.slice(0, 200) : null;
}
