// Does the next request start with the previous one? (layer 1 of Len 3.1, spec
// local 2026-10-24-len-3-1-layers-0-1, §5.5). The provider's cache only serves
// a prefix, so for two consecutive requests of a conversation the answer is
// MATCH, or the first part that changed — system, tools or a message — with the
// exact character. `before`/`after` carry 60 characters around it: only for
// local captures; the production mode of `scripts/request-diff.ts` compares
// hashes and prints no text.
import type { WireBody } from "@/lib/ai/fireworks-stream-client";

export type PairVerdict =
  | { readonly match: true }
  | {
      readonly match: false;
      readonly part: "system" | "tools" | "messages";
      readonly index?: number;
      readonly at?: number;
      readonly before?: string;
      readonly after?: string;
    };

const CONTEXT = 30;

function firstDifference(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return n;
}

function differ(part: "system" | "tools" | "messages", a: string, b: string, index?: number): PairVerdict {
  const at = firstDifference(a, b);
  const from = Math.max(0, at - CONTEXT);
  return { match: false, part, ...(index !== undefined ? { index } : {}), at, before: a.slice(from, at + CONTEXT), after: b.slice(from, at + CONTEXT) };
}

const isSystem = (m: Record<string, unknown> | undefined) => m?.role === "system";

/** `at` is the first differing character of the JSON of the part (a message, or the tool list). */
export function diffConsecutive(a: WireBody, b: WireBody): PairVerdict {
  const aSystem = isSystem(a.messages[0]) ? JSON.stringify(a.messages[0]) : null;
  const bSystem = isSystem(b.messages[0]) ? JSON.stringify(b.messages[0]) : null;
  if (aSystem !== bSystem) return differ("system", aSystem ?? "", bSystem ?? "", 0);

  const aTools = JSON.stringify(a.tools ?? null);
  const bTools = JSON.stringify(b.tools ?? null);
  if (aTools !== bTools) return differ("tools", aTools, bTools);

  for (let i = aSystem === null ? 0 : 1; i < a.messages.length; i++) {
    const x = JSON.stringify(a.messages[i]);
    const y = b.messages[i] === undefined ? "" : JSON.stringify(b.messages[i]);
    if (x !== y) return differ("messages", x, y, i);
  }
  return { match: true };
}
