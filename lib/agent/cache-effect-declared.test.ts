// A10 of Len 3.1, DeepSeek's habit (every package README has a «KV Cache effect» section): each module
// that writes what the model reads declares, in one line, what it does to the provider's prefix cache —
// `Cache effect:` or `Efecto en la caché:`, in the file's language. The cache is paid by the prefix, and
// every break found on 24/10 came from code that changed what was sent without anyone asking that.
//
// The list is not written by hand: a module counts when it builds messages, a <system-reminder>, tool
// results or the system prompt. A few that shape the prefix without those words are named below.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const WRITES_FOR_THE_MODEL = /<system-reminder>|messages\.push\(|role: "(user|system)"|functionResponses: |\bsystemPrompt\b/;
const DECLARED = /(Cache effect|Efecto en la caché):/;
/** Shape the prefix without the words above: the tools and the system prompt, the call, the reminders. */
const ALSO = [
  "lib/agent/catalog.ts",
  "lib/agent/brain.ts",
  "lib/agent/modo-app.ts",
  "lib/agent/repeat-reminder.ts",
  "lib/agent/screenshots-in-context.ts",
  "lib/ai/fireworks-stream-client.ts",
];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "testing" || name === "replay-scenes" ? [] : sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$|\.d\.ts$/.test(name) ? [path] : [];
  });
}

const found = sources(join(ROOT, "lib", "agent"))
  .filter((p) => WRITES_FOR_THE_MODEL.test(readFileSync(p, "utf8")))
  .map((p) => relative(ROOT, p).replaceAll("\\", "/"));
const modules = [...new Set([...found, ...ALSO])].sort();

describe("every module that writes what the model reads declares its cache effect (A10)", () => {
  it("the search finds the ones that matter (it is not silently empty)", () => {
    expect(found).toEqual(expect.arrayContaining(["lib/agent/context.ts", "lib/agent/loop.ts", "lib/agent/transcripcion.ts"]));
  });

  it("each one has its line", () => {
    const missing = modules.filter((m) => !DECLARED.test(readFileSync(join(ROOT, m), "utf8")));
    expect(missing).toEqual([]);
  });
});
