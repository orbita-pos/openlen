// Minimal reactive-safety guard for the community feed. Not exhaustive — the
// real net is report + admin-hide. Whole-word, case-insensitive. Keep terms
// lowercase and single-token; add sparingly.
export const BLOCKED_TERMS: string[] = [
  "casino", "viagra", "cialis", "porn", "porno", "xxx", "escort", "escorts",
  "phishing", "counterfeit",
];

const RE = new RegExp(`\\b(${BLOCKED_TERMS.map((t) =>
  t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "i");

export function containsBlockedTerm(text: string): string | null {
  const m = RE.exec(text);
  return m ? m[1].toLowerCase() : null;
}
