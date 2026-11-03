// THE TRIGGER (spec local 2026-11-03-len-que-avisa, §7.4), DeepSeek's event trigger: shared code that decides,
// without a model, whether a source's changes matter to a task. A change that fails a condition is filtered with
// its reason; what passes is ONE candidate per observation — DeepSeek merges a push that fails three checks into
// one event; here the check interval is the merge window. Conditions are matched here, in TypeScript, so a value
// a visitor wrote is only ever compared as a string.
import type { Condition, SourceChange } from "./sources/types";

export interface Candidate {
  readonly subject: string;
  readonly changes: readonly SourceChange[];
  /** Counts per subject, language-neutral: «reservas: 5». */
  readonly summary: string;
}

export interface Evaluation {
  readonly candidate: Candidate | null;
  readonly filtered: readonly { readonly change: SourceChange; readonly reason: string }[];
}

const empty = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");
const asNumber = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

function compare(a: unknown, b: unknown): number {
  const x = asNumber(a);
  const y = asNumber(b);
  if (x !== null && y !== null) return x - y;
  return String(a ?? "").localeCompare(String(b ?? ""));
}

/** Null when the change passes; else the reason, in symbols the records screen shows as they are. */
function failure(change: SourceChange, c: Condition): string | null {
  const v = change.detail[c.field];
  const want = String(c.value ?? "");
  switch (c.op) {
    case "eq":
      return String(v ?? "") === want ? null : `${c.field} ≠ ${want}`;
    case "neq":
      return String(v ?? "") !== want ? null : `${c.field} = ${want}`;
    case "contains":
      return String(v ?? "").toLocaleLowerCase().includes(want.toLocaleLowerCase()) ? null : `${c.field} ∌ ${want}`;
    case "gt":
      return !empty(v) && compare(v, c.value) > 0 ? null : `${c.field} ≤ ${want}`;
    case "lt":
      return !empty(v) && compare(v, c.value) < 0 ? null : `${c.field} ≥ ${want}`;
    case "exists":
      return empty(v) ? `${c.field} ∅` : null;
  }
}

export function evaluate(o: { readonly changes: readonly SourceChange[]; readonly conditions: readonly Condition[] }): Evaluation {
  const passed: SourceChange[] = [];
  const filtered: { change: SourceChange; reason: string }[] = [];
  for (const change of o.changes) {
    const reason = o.conditions.map((c) => failure(change, c)).find((x) => x !== null) ?? null;
    if (reason === null) passed.push(change);
    else filtered.push({ change, reason });
  }
  if (passed.length === 0) return { candidate: null, filtered };
  const counts = new Map<string, number>();
  for (const change of passed) counts.set(change.subject, (counts.get(change.subject) ?? 0) + 1);
  const summary = [...counts].map(([subject, n]) => `${subject}: ${n}`).join(", ");
  return { candidate: { subject: passed[0]!.subject, changes: passed, summary }, filtered };
}
