// Pure helpers for ExploreView — kept dependency-free so they run in the plain
// node/vitest env without pulling in react/next-intl client deps.

// Mirrors lib/community/store.ts's `ExploreCard` row shape as it arrives over
// the wire from GET /api/explore (JSON — `listedAt` serializes to an ISO
// string, not a Date).
export type ExploreItem = {
  id: string;
  title: string;
  thumbnailUrl: string | null;
  deployUrl: string | null;
  handle: string | null;
  avatarUrl: string | null;
  remixCount: number;
  listedAt: string | null;
};

/** Cursor pagination: append a fetched page, dedupe by id (a boundary row can repeat). */
export function appendExplorePage(
  acc: ExploreItem[],
  page: ExploreItem[],
): ExploreItem[] {
  if (acc.length === 0) return page;
  const seen = new Set(acc.map((i) => i.id));
  return [...acc, ...page.filter((i) => !seen.has(i.id))];
}
