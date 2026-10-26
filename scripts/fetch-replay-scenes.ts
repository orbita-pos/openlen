// npm run replay-scenes:fetch — downloads the real production turns listed in
// lib/agent/replay-scenes/scenes.json (layer 1 of Len 3.1, spec local
// 2026-10-24-len-3-1-layers-0-1, §5.2) into the scenes folder OUTSIDE the repo.
//
// Read-only and over ssh: `default_transaction_read_only` plus a 30 s
// `statement_timeout`, SELECT only. It never opens a database connection from
// this machine (the local .env.local points at production) and never prints a
// row's text: names, counts and sizes only.
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { scenes, scenesDir, type SceneFile, type SceneRow, type SceneSpec } from "../lib/agent/replay-scenes/scene-files";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function psql(sql: string): string {
  const run = spawnSync("ssh", ["openlen", "sudo -n -u postgres psql -d openlen -q -At -v ON_ERROR_STOP=1 -P pager=off"], {
    input: `set default_transaction_read_only = on;\nset statement_timeout = '30s';\n${sql}\n`,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 1024,
  });
  if (run.error) throw run.error;
  if (run.status !== 0) throw new Error(`psql exited ${run.status}: ${run.stderr.trim().slice(0, 500)}`);
  return run.stdout.trim();
}

/** The closed Len turns of the first replayed row's conversation, as the route reads them. */
const conversation = (first: string) => `
  with f as (select "projectId", conversation, "createdAt" from "projectChatMessages" where id = '${first}')
  select m.* from "projectChatMessages" m, f
  where m."projectId" = f."projectId" and m.conversation is not distinct from f.conversation
    and m.tipo is null and m.status <> 'en_curso'`;

function fetchScene(spec: SceneSpec): SceneFile {
  const ids = [spec.projectId, ...spec.rowIds];
  if (spec.rowIds.length < 1 || !ids.every((id) => UUID.test(id))) throw new Error(`scene ${spec.name}: ids must be uuids`);
  const first = spec.rowIds[0]!;
  const last = spec.rowIds.at(-1)!;
  const json = psql(`
    with c as (${conversation(first)}),
    lim as (select (select "createdAt" from "projectChatMessages" where id = '${first}') a, (select "createdAt" from "projectChatMessages" where id = '${last}') b),
    -- A11: the whole conversation before the first replayed turn, as the route loads it now.
    w as (select * from c, lim where c."createdAt" < lim.a),
    r as (select * from c, lim where c."createdAt" >= lim.a and c."createdAt" <= lim.b)
    select coalesce(json_agg(x order by x."createdAt"), '[]') from (
      select id, "projectId", "createdAt", status, tipo, "userText", "assistantReasoning", transcript, "attachedImage", actions from w
      union all
      select id, "projectId", "createdAt", status, tipo, "userText", "assistantReasoning", transcript, "attachedImage", actions from r
    ) x;`);
  const rows = (JSON.parse(json) as (SceneRow & { projectId: string })[]).map(({ projectId, ...row }) => {
    if (projectId !== spec.projectId) throw new Error(`scene ${spec.name}: row ${row.id} belongs to another project`);
    return row;
  });
  for (const id of spec.rowIds) if (!rows.some((r) => r.id === id)) throw new Error(`scene ${spec.name}: row ${id} not found in its conversation`);
  return { name: spec.name, projectId: spec.projectId, fetchedAt: new Date().toISOString(), olderTurns: 0, rows };
}

function main(): void {
  const dir = scenesDir();
  mkdirSync(dir, { recursive: true });
  const wanted = new Set(scenes.map((s) => `${s.name}.json`));
  for (const spec of scenes) {
    const scene = fetchScene(spec);
    const body = JSON.stringify(scene);
    writeFileSync(join(dir, `${spec.name}.json`), body, "utf8");
    console.log(`${spec.name}: ${scene.rows.length} rows ${(body.length / 1024).toFixed(0)} KB`);
  }
  for (const file of readdirSync(dir)) {
    if (file.endsWith(".json") && !wanted.has(file)) {
      rmSync(join(dir, file));
      console.log(`removed ${file} (no longer in scenes.json)`);
    }
  }
}

try {
  main();
} catch (err) {
  console.error(`replay-scenes:fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
