// npm run requests:diff — for each pair of consecutive requests of a
// conversation, MATCH or the first part that changed (layer 1 of Len 3.1, spec
// local 2026-10-24-len-3-1-layers-0-1, §5.5).
//
//   --captures <file.jsonl>        local captures (OPENLEN_CAPTURE_REQUESTS_DIR,
//                                  development only): full verdicts with the text
//                                  around the change.
//   --project <id> [--turns N]     production: the hashes of `agentRequestSteps`,
//                                  read-only over ssh; prints part and index only,
//                                  never text.
//
// Each request is compared with the previous one of the same kind (with tools =
// loop, without = closeOut), and every closeOut also with the loop call before
// it: the closing call is a suspect of its own (it sends no tools).
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import type { WireBody } from "../lib/ai/fireworks-stream-client";
import { diffConsecutive, type PairVerdict } from "../lib/agent/telemetry/request-diff";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function show(label: string, v: PairVerdict, withText: boolean): void {
  if (v.match) {
    console.log(`${label} MATCH`);
    return;
  }
  console.log(`${label} MISMATCH part=${v.part}${v.index !== undefined ? ` index=${v.index}` : ""}${v.at !== undefined ? ` at=${v.at}` : ""}`);
  if (withText) {
    console.log(`    before: ${JSON.stringify(v.before ?? "")}`);
    console.log(`    after:  ${JSON.stringify(v.after ?? "")}`);
  }
}

function fromCaptures(file: string): void {
  const bodies = readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Record<string, unknown>);
  const wire = (b: Record<string, unknown>): WireBody => ({
    model: String(b.model),
    messages: (b.messages as Record<string, unknown>[]) ?? [],
    ...(Array.isArray(b.tools) && b.tools.length > 0 ? { tools: b.tools as Record<string, unknown>[] } : {}),
    ...("reasoning_effort" in b ? { reasoningEffort: b.reasoning_effort } : {}),
  });
  const last: Partial<Record<"loop" | "closeOut", { n: number; body: WireBody }>> = {};
  bodies.forEach((raw, n) => {
    const body = wire(raw);
    const kind = body.tools ? "loop" : "closeOut";
    const prev = last[kind];
    if (prev) {
      const effort = prev.body.reasoningEffort !== body.reasoningEffort ? `  (effort ${String(prev.body.reasoningEffort)}→${String(body.reasoningEffort)})` : "";
      const model = prev.body.model !== body.model ? `  (model ${prev.body.model}→${body.model})` : "";
      show(`#${prev.n}→#${n} ${kind}${effort}${model}`, diffConsecutive(prev.body, body), true);
    }
    if (kind === "closeOut" && last.loop) show(`#${last.loop.n}→#${n} loop→closeOut`, diffConsecutive(last.loop.body, body), true);
    last[kind] = { n, body };
  });
}

interface StepHashes {
  turnId: string;
  step: number;
  kind: string;
  provider: string;
  effort: string | null;
  systemHash: string | null;
  toolsHash: string | null;
  messageHashes: string[] | null;
}

function fromProduction(projectId: string, turns: number): void {
  if (!UUID.test(projectId)) throw new Error("--project must be a uuid");
  const sql = `set default_transaction_read_only = on;
set statement_timeout = '30s';
with t as (select "turnId" from "agentRequestSteps" where "projectId" = '${projectId}' group by "turnId" order by max("createdAt") desc limit ${turns})
select coalesce(json_agg(json_build_object('turnId', s."turnId", 'step', s.step, 'kind', s.kind, 'provider', s.provider, 'effort', s.effort,
  'systemHash', s."systemHash", 'toolsHash', s."toolsHash", 'messageHashes', s."messageHashes") order by s."createdAt", s.step), '[]')
from "agentRequestSteps" s where s."turnId" in (select "turnId" from t);`;
  const run = spawnSync("ssh", ["openlen", "sudo -n -u postgres psql -d openlen -q -At -v ON_ERROR_STOP=1 -P pager=off"], {
    input: sql,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (run.error) throw run.error;
  if (run.status !== 0) throw new Error(`psql exited ${run.status}: ${run.stderr.trim().slice(0, 500)}`);
  const rows = JSON.parse(run.stdout.trim() || "[]") as StepHashes[];
  // Only the calls that kept their hashes (the last of each kind per turn, and the broken ones).
  const last: Record<string, StepHashes> = {};
  for (const r of rows) {
    if (!r.messageHashes) continue;
    const prev = last[r.kind];
    if (prev) {
      const label = `${prev.turnId.slice(0, 8)}#${prev.step}→${r.turnId.slice(0, 8)}#${r.step} ${r.kind}${prev.provider !== r.provider ? ` (provider ${prev.provider}→${r.provider})` : ""}${prev.effort !== r.effort ? ` (effort ${prev.effort}→${r.effort})` : ""}`;
      if (prev.systemHash !== r.systemHash) show(label, { match: false, part: "system" }, false);
      else if (prev.toolsHash !== r.toolsHash) show(label, { match: false, part: "tools" }, false);
      else {
        const i = prev.messageHashes!.findIndex((h, k) => r.messageHashes![k] !== h);
        // Hashes leave the system message out: index + 1 is its place on the wire.
        show(label, i < 0 ? { match: true } : { match: false, part: "messages", index: i + 1 }, false);
      }
    }
    last[r.kind] = r;
  }
  console.log(`${rows.length} calls in the last ${turns} turns`);
}

try {
  const captures = arg("--captures");
  const project = arg("--project");
  if (captures) fromCaptures(captures);
  else if (project) fromProduction(project, Math.max(1, Math.min(200, Number(arg("--turns") ?? 10) || 10)));
  else throw new Error("usage: requests:diff -- --captures <file.jsonl> | --project <id> [--turns N]");
} catch (err) {
  console.error(`requests:diff failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
