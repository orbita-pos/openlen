// Which «@» mentions a message still carries: those whose label is in its text.
// Like Claude Code, which attaches a file mentioned twice once, a mention counts
// once however often it appears or was picked; a label that only survives inside
// a longer one («@Texto · Pan» inside «@Texto · Pan de verdad») does not count.
// Client-safe.

import type { MentionRef } from "./types";

/** What makes two mentions the same thing. */
function identityOf(m: MentionRef): string {
  if (m.type === "file") return `file:${m.ruta}`;
  const t = m.target;
  return t.type === "page" ? `page:${t.page ?? ""}:${t.path}` : `app:${t.path}:${t.line}`;
}

export function liveMentions(text: string, mentions: readonly MentionRef[]): MentionRef[] {
  const unique: MentionRef[] = [];
  const seen = new Set<string>();
  for (const m of mentions) {
    const id = identityOf(m);
    if (!seen.has(id)) {
      seen.add(id);
      unique.push(m);
    }
  }
  // Longest labels first, each occurrence blanked once claimed, so a shorter
  // label cannot find itself inside a longer one.
  let rest = text;
  const placed: { m: MentionRef; at: number }[] = [];
  const labels = [...new Set(unique.map((m) => m.label))].sort((a, b) => b.length - a.length);
  for (const label of labels) {
    const owners = unique.filter((m) => m.label === label);
    let from = 0;
    for (const owner of owners) {
      const at = rest.indexOf(label, from);
      if (at === -1) break;
      placed.push({ m: owner, at });
      rest = rest.slice(0, at) + " ".repeat(label.length) + rest.slice(at + label.length);
      from = at + label.length;
    }
  }
  return placed.sort((a, b) => a.at - b.at).map((p) => p.m);
}

/** Two mentions of the same thing. */
export function sameMention(a: MentionRef, b: MentionRef): boolean {
  return identityOf(a) === identityOf(b);
}
