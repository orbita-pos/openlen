// npm run replay-scenes:where -- <scene> — where a production scene stops replaying byte for byte
// (layer 1 of Len 3.1). For each replayed turn: whether its requests extend one another, whether
// the next turn starts with its last request, and for a break, WHICH message and WHICH field
// differ. It prints roles, field names and lengths only: the rows are customer text and never
// reach the terminal. Needs the scenes downloaded (`npm run replay-scenes:fetch`).
import type { Message } from "../lib/ai-gateway";
import { messagesForFireworks } from "../lib/agent/fireworks-bridge";
import { replayScene } from "../lib/agent/replay-scenes/replay-scene";
import { readScene, scenes } from "../lib/agent/replay-scenes/scene-files";
import { comparePrefix } from "../lib/agent/testing/replay-invariant";

const short = (id: string): string => id.slice(0, 8);

function commonPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/** The messages as the provider receives them: what the cache compares, and what a mismatch index counts. */
type Wire = ReturnType<typeof messagesForFireworks>[number];
const wire = (messages: readonly Message[]): Wire[] => messagesForFireworks(messages);

/** One message as counts: its role and the length of each field it carries. */
function shape(m: Wire | undefined): string {
  if (!m) return "(no message)";
  const fields = Object.entries(m)
    .filter(([key, value]) => key !== "role" && value !== undefined)
    .map(([key, value]) => `${key}=${typeof value === "string" ? value.length : JSON.stringify(value).length}`);
  return `${m.role} ${fields.join(" ")}`;
}

/** Which fields of the two messages differ, and how far each agrees. */
function difference(earlier: Wire | undefined, later: Wire | undefined): string {
  if (!earlier || !later) return "one side has no message there";
  const keys = [...new Set([...Object.keys(earlier), ...Object.keys(later)])];
  const text = (v: unknown): string => (v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v));
  return keys
    .filter((key) => text((earlier as unknown as Record<string, unknown>)[key]) !== text((later as unknown as Record<string, unknown>)[key]))
    .map((key) => {
      const a = text((earlier as unknown as Record<string, unknown>)[key]);
      const b = text((later as unknown as Record<string, unknown>)[key]);
      return `${key}: ${a.length} vs ${b.length} chars, equal up to ${commonPrefix(a, b)}`;
    })
    .join("; ");
}

async function main(): Promise<void> {
  const wanted = process.argv.slice(2);
  const chosen = wanted.length > 0 ? scenes.filter((s) => wanted.includes(s.name)) : scenes;
  if (chosen.length === 0) throw new Error(`no scene named ${wanted.join(", ")} — names are in lib/agent/replay-scenes/scenes.json`);
  let broken = 0;
  for (const spec of chosen) {
    const file = readScene(spec.name);
    if (!file) {
      console.log(`${spec.name}: not downloaded (npm run replay-scenes:fetch)`);
      broken++;
      continue;
    }
    const { checks, requests } = await replayScene(file, spec.rowIds);
    console.log(`${spec.name}: ${checks.length} turn(s) replayed`);
    let previous: Message[] | null = null;
    for (const check of checks) {
      const sent = requests.get(check.rowId) ?? [];
      const across = check.acrossTurns;
      console.log(`  ${short(check.rowId)}  requests=${sent.length}  within=${check.withinTurn.ok ? "ok" : check.withinTurn.cause}  across=${across === null ? "-" : across.ok ? "ok" : across.cause}`);
      if (!check.withinTurn.ok) {
        const at = sent.findIndex((request, i) => i > 0 && !comparePrefix(sent[i - 1]!, request).ok);
        const index = comparePrefix(sent[at - 1]!, sent[at]!).firstMismatch ?? 0;
        const [before, after] = [wire(sent[at - 1]!), wire(sent[at]!)];
        console.log(`    within: request ${at} breaks at message ${index} of ${before.length}`);
        console.log(`      before: ${shape(before[index])}`);
        console.log(`      after:  ${shape(after[index])}`);
        console.log(`      ${difference(before[index], after[index])}`);
        broken++;
      }
      if (across && !across.ok && previous && sent[0]) {
        const index = across.firstMismatch ?? 0;
        const [asSent, asRebuilt] = [wire(previous), wire(sent[0])];
        console.log(`    across: message ${index} (the last request of the turn before had ${asSent.length}, this one starts with ${asRebuilt.length})`);
        console.log(`      as sent:    ${shape(asSent[index])}`);
        console.log(`      as rebuilt: ${shape(asRebuilt[index])}`);
        console.log(`      ${difference(asSent[index], asRebuilt[index])}`);
        broken++;
      }
      if (sent.length > 0) previous = sent.at(-1)!;
    }
  }
  if (broken > 0) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(`replay-scenes:where failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
