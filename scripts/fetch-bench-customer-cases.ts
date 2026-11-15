// npm run bench:clientes:fetch — brings the customer cases of Len 3.1's battery 1
// (lib/len-bench/casos/clientes/cases.json, ids only) from production into a folder OUTSIDE the repo
// (`OPENLEN_BENCH_CASES_DIR` or ~/.openlen/bench-cases; plan local 2026-11-15-len-3-1-bateria-de-paginas-gratis,
// task 8).
//
// Read-only and over ssh, as scripts/fetch-replay-scenes.ts: `default_transaction_read_only` plus a 30 s
// `statement_timeout`, SELECT only. It never opens a database connection from this machine and never prints a
// row's text: ids, counts and sizes only. A project whose owner attached a photo or a file is left out and
// counted (the bench does not replay attachments).
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { casesDir, fetchedCaseFrom, writeFetchedCase, type RawCaseRows } from "../lib/len-bench/casos/clientes/fetched";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CASES_FILE = "lib/len-bench/casos/clientes/cases.json";

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

/** The owner-typed turns of the current chat: no `tipo` (a Len turn), no `origen` (not started by the server). */
const OWNER_ROWS = (id: string) =>
  `"projectChatMessages" m where m."projectId" = '${id}' and m.tipo is null and m.origen is null and m.conversation is null and m.status <> 'en_curso'`;

function fetchRaw(projectId: string): RawCaseRows | null {
  if (!UUID.test(projectId)) throw new Error(`not a project id: ${projectId}`);
  const json = psql(`
    with first as (select min(m."createdAt") as at from ${OWNER_ROWS(projectId)})
    select json_build_object(
      'projectId', p.id,
      'project', json_build_object('data', p.data, 'subdomain', p.subdomain),
      'versionsBefore', coalesce((select json_agg(json_build_object('page', v.page, 'html', v.html, 'createdAt', v."createdAt") order by v."createdAt")
                                  from "projectVersions" v, first where v."projectId" = p.id and v."createdAt" < first.at), '[]'::json),
      'rows', coalesce((select json_agg(json_build_object('userText', m."userText", 'attachedImage', m."attachedImage", 'attachedFiles', m."attachedFiles",
                                                          'createdAt', m."createdAt", 'transcript', m.transcript) order by m."createdAt")
                        from ${OWNER_ROWS(projectId)}), '[]'::json)
    ) from projects p where p.id = '${projectId}';`);
  return json ? (JSON.parse(json) as RawCaseRows) : null;
}

function main(): void {
  const cases = JSON.parse(readFileSync(CASES_FILE, "utf8")) as { projectId: string }[];
  const fetchedAt = new Date().toISOString();
  let written = 0;
  const left: string[] = [];
  for (const { projectId } of cases) {
    const short = projectId.slice(0, 8);
    const raw = fetchRaw(projectId);
    if (!raw) {
      left.push(`${short}: el proyecto ya no existe`);
      continue;
    }
    const c = fetchedCaseFrom(raw, fetchedAt);
    if ("left" in c) {
      left.push(`${short}: ${c.left}`);
      continue;
    }
    writeFetchedCase(c);
    written++;
    const kb = (JSON.stringify(c).length / 1024).toFixed(0);
    console.log(`${short}: ${c.ownerMessages.length} mensaje(s) del dueño · ${c.cardAnswers.length} respuesta(s) de tarjeta · partida ${c.start.html ? "con página" : "en blanco"} · ${c.published ? "publicada" : "sin publicar"} · ${kb} KB`);
  }
  console.log(`\n${written} de ${cases.length} casos en ${casesDir()}`);
  if (left.length > 0) console.log(`fuera (${left.length}):\n${left.map((l) => `  ${l}`).join("\n")}`);
}

main();
