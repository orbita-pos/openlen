// Fuzzy search over the «@» index, like Claude Code's file search: every word of
// the query has to appear in some field (whole or as a subsequence), what the
// person reads on screen weighs more than a class name, and accents and case do
// not matter. Client-safe.

import type { MentionEntry } from "./types";

export type MentionResult = { type: "element"; entry: MentionEntry } | { type: "file"; ruta: string };

function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function isSubsequence(needle: string, hay: string): boolean {
  let i = 0;
  for (let j = 0; j < hay.length && i < needle.length; j++) if (hay[j] === needle[i]) i++;
  return i === needle.length;
}

/** How well one query word matches one field, times the field's weight; 0 = no match. */
function scoreIn(token: string, field: string, weight: number): number {
  if (!field) return 0;
  const at = field.indexOf(token);
  if (at !== -1) return weight * 10 + (at === 0 || /[^a-z0-9]/.test(field[at - 1]!) ? 5 : 0);
  return isSubsequence(token, field) ? weight * 3 : 0;
}

function fieldsOf(e: MentionEntry): [string, number][] {
  const a = e.attrs;
  return [
    [fold(e.text), 5],
    [fold(e.name), 4],
    [fold([a.alt, a.ariaLabel, a.title, a.placeholder].filter(Boolean).join(" ")), 3],
    [fold([a.id, a.className].filter(Boolean).join(" ")), 2],
    [fold([e.tag, e.component ?? "", e.ruta].join(" ")), 1],
  ];
}

function score(tokens: readonly string[], fields: readonly [string, number][]): number {
  let total = 0;
  for (const t of tokens) {
    let best = 0;
    for (const [f, w] of fields) best = Math.max(best, scoreIn(t, f, w));
    if (best === 0) return 0;
    total += best;
  }
  return total;
}

export function searchMentions(
  entries: readonly MentionEntry[],
  files: readonly string[],
  query: string,
  limit: number,
): { items: MentionResult[]; more: number } {
  const tokens = fold(query).split(/\s+/).filter(Boolean);
  let all: MentionResult[];
  if (tokens.length === 0) {
    all = [
      ...entries.filter((e) => !e.collapsed).map((entry) => ({ type: "element" as const, entry })),
      ...files.map((ruta) => ({ type: "file" as const, ruta })),
    ];
  } else {
    const scored: { item: MentionResult; score: number; order: number }[] = [];
    entries.forEach((entry, order) => {
      const s = score(tokens, fieldsOf(entry));
      if (s > 0) scored.push({ item: { type: "element", entry }, score: s, order });
    });
    files.forEach((ruta, i) => {
      const s = score(tokens, [[fold(ruta), 1]]);
      if (s > 0) scored.push({ item: { type: "file", ruta }, score: s, order: entries.length + i });
    });
    scored.sort((x, y) => y.score - x.score || x.order - y.order);
    all = scored.map((s) => s.item);
  }
  return { items: all.slice(0, limit), more: Math.max(0, all.length - limit) };
}
