// A BUILT CASE, KEPT AND PUT BACK (spec local 2026-11-13-conversar-todo-el-mes, §8.2).
//
// Building a case's conversation costs real turns, once. Every run of every arm must then start from that
// conversation exactly as it was left — its rows, its files, its assistant's memory. The spec asked for a
// copy of the whole database per run (`CREATE DATABASE … TEMPLATE`); that needs the bench's server off the
// database for every copy, and the app's pool has no error handler, so dropping its connections under it
// kills it. What is kept instead is THE PROJECT: every row that belongs to it, copied into a schema of its
// own in the same database (`lb_<case>`), and put back before each run by ordinary statements the running
// server never notices.
//
// «Belongs to it» is read off the database, not off a list written here (a list goes stale the day a table is
// added): every table with a `projectId` column, the project's own row, the assistant that lives in it
// (`homeProjectId`), and every table that hangs off one of those by a foreign key.
//
// THE PAUSE is not a wait either: `ageConversation` moves the conversation into the past, and the route —
// which reads when the last model turn ended off the rows it loads — sees someone coming back hours later.
//
// Only ever against the bench's local database: the runner checks that before it calls anything here.

/** One connection's worth of SQL. `query` returns the rows. */
export interface Sql {
  query<T = Record<string, unknown>>(text: string, params?: readonly unknown[]): Promise<T[]>;
  /** Runs `fn` on ONE connection inside a transaction. Absent = `query` already runs on a single connection. */
  transaction?<T>(fn: (sql: Sql) => Promise<T>): Promise<T>;
}

export interface ScopedTable {
  readonly table: string;
  /** Which of its rows are the project's, as a condition over the table's own columns. */
  readonly where: string;
}

const ident = (name: string): string => `"${name.replace(/"/g, '""')}"`;
const text = (value: string): string => `'${value.replace(/'/g, "''")}'`;

/** A project id goes into the statements as text (a utility statement takes no parameters): only an id. */
function projectLiteral(projectId: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(projectId)) throw new Error(`not a project id: «${projectId.slice(0, 40)}»`);
  return text(projectId);
}

/** The schema a case is kept in: its own, prefixed, so it can never be one of the app's. */
export function snapshotSchema(name: string): string {
  return `lb_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`.slice(0, 60);
}

async function inTransaction<T>(sql: Sql, fn: (sql: Sql) => Promise<T>): Promise<T> {
  if (sql.transaction) return sql.transaction(fn);
  await sql.query("BEGIN");
  try {
    const result = await fn(sql);
    await sql.query("COMMIT");
    return result;
  } catch (err) {
    await sql.query("ROLLBACK").catch(() => {});
    throw err;
  }
}

/**
 * Every table that holds rows of the project, parents before what hangs off them, each with the condition
 * that picks the project's rows.
 */
export async function projectScope(sql: Sql, projectId: string): Promise<ScopedTable[]> {
  const p = projectLiteral(projectId);
  const columns = await sql.query<{ table: string; column: string }>(
    `select c.table_name as "table", c.column_name as "column"
       from information_schema.columns c
       join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
      where c.table_schema = 'public' and t.table_type = 'BASE TABLE' and c.column_name in ('projectId', 'homeProjectId')
      order by c.table_name`,
  );
  const scope: ScopedTable[] = [];
  const has = (table: string) => scope.some((t) => t.table === table);
  const [projects] = await sql.query(`select 1 from information_schema.tables where table_schema = 'public' and table_name = 'projects'`);
  if (projects) scope.push({ table: "projects", where: `"id" = ${p}` });
  for (const c of columns) if (c.column === "projectId" && !has(c.table)) scope.push({ table: c.table, where: `"projectId" = ${p}` });
  for (const c of columns) if (c.column === "homeProjectId" && !has(c.table)) scope.push({ table: c.table, where: `"homeProjectId" = ${p}` });

  // What hangs off those by a one-column foreign key, level by level, until nothing new turns up.
  const keys = await sql.query<{ child: string; childColumn: string; parent: string; parentColumn: string }>(
    `select ch.relname as "child", ca.attname as "childColumn", pa.relname as "parent", pt.attname as "parentColumn"
       from pg_constraint con
       join pg_class ch on ch.oid = con.conrelid
       join pg_class pa on pa.oid = con.confrelid
       join pg_namespace ns on ns.oid = ch.relnamespace
       join pg_attribute ca on ca.attrelid = con.conrelid and ca.attnum = con.conkey[1]
       join pg_attribute pt on pt.attrelid = con.confrelid and pt.attnum = con.confkey[1]
      where con.contype = 'f' and array_length(con.conkey, 1) = 1 and ns.nspname = 'public'
      order by ch.relname, ca.attname`,
  );
  for (;;) {
    const found = new Map<string, string[]>();
    for (const k of keys) {
      if (has(k.child)) continue;
      const parent = scope.find((t) => t.table === k.parent);
      if (!parent) continue;
      const via = `${ident(k.childColumn)} in (select ${ident(k.parentColumn)} from public.${ident(k.parent)} where ${parent.where})`;
      found.set(k.child, [...(found.get(k.child) ?? []), via]);
    }
    if (found.size === 0) break;
    for (const [table, conditions] of found) scope.push({ table, where: conditions.length === 1 ? conditions[0]! : `(${conditions.join(" or ")})` });
  }
  return scope;
}

interface SnapshotMeta {
  readonly projectId: string;
  readonly ownerId: string | null;
  readonly agentMemory: string | null;
  readonly tables: readonly string[];
  readonly savedAt: string;
}

export async function hasSnapshot(sql: Sql, name: string): Promise<boolean> {
  const [row] = await sql.query(`select 1 from information_schema.tables where table_schema = ${text(snapshotSchema(name))} and table_name = '_meta'`);
  return row !== undefined;
}

async function metaOf(sql: Sql, name: string): Promise<SnapshotMeta> {
  if (!(await hasSnapshot(sql, name))) throw new Error(`no snapshot «${name}»: build the case first`);
  const [row] = await sql.query<{ data: SnapshotMeta }>(`select "data" from ${ident(snapshotSchema(name))}."_meta"`);
  if (!row) throw new Error(`no snapshot «${name}»: its record is empty`);
  return row.data;
}

/** Keeps the project as it is now under `name`, replacing what was kept under that name. */
export async function saveSnapshot(sql: Sql, name: string, projectId: string): Promise<{ tables: number; rows: number }> {
  const schema = ident(snapshotSchema(name));
  const scope = await projectScope(sql, projectId);
  return inTransaction(sql, async (tx) => {
    await tx.query(`drop schema if exists ${schema} cascade`);
    await tx.query(`create schema ${schema}`);
    let total = 0;
    for (const t of scope) {
      await tx.query(`create table ${schema}.${ident(t.table)} as select * from public.${ident(t.table)} where ${t.where}`);
      const [n] = await tx.query<{ n: number }>(`select count(*)::int as n from ${schema}.${ident(t.table)}`);
      total += n?.n ?? 0;
    }
    const [owner] = scope.some((t) => t.table === "projects")
      ? await tx.query<{ ownerId: string; agentMemory: string | null }>(
          `select u."id" as "ownerId", u."agentMemory" as "agentMemory" from public."projects" p join public."users" u on u."id" = p."userId" where p."id" = ${projectLiteral(projectId)}`,
        )
      : [];
    const meta: SnapshotMeta = {
      projectId,
      ownerId: owner?.ownerId ?? null,
      agentMemory: owner?.agentMemory ?? null,
      tables: scope.map((t) => t.table),
      savedAt: new Date().toISOString(),
    };
    await tx.query(`create table ${schema}."_meta" ("data" jsonb not null)`);
    await tx.query(`insert into ${schema}."_meta" values ($1::jsonb)`, [JSON.stringify(meta)]);
    return { tables: scope.length, rows: total };
  });
}

/**
 * Puts the project back as it was kept: whatever a run changed, added or removed is undone, in one
 * transaction. Foreign keys are not checked while it runs (rows go out and come back in whole tables), which
 * needs a superuser — the bench's throwaway database has one.
 */
export async function restoreSnapshot(sql: Sql, name: string, projectId: string): Promise<void> {
  const meta = await metaOf(sql, name);
  if (meta.projectId !== projectId) throw new Error(`snapshot «${name}» belongs to project ${meta.projectId}, not ${projectId}`);
  const schema = ident(snapshotSchema(name));
  // Today's tables and the kept ones: a table the run was the first to write to is emptied too.
  const scope = await projectScope(sql, projectId);
  await inTransaction(sql, async (tx) => {
    try {
      await tx.query(`set local session_replication_role = replica`);
    } catch (err) {
      throw new Error(`the bench's database user cannot switch off foreign-key checks (it must be a superuser of a throwaway database): ${err instanceof Error ? err.message : String(err)}`);
    }
    // What hangs off first: its condition looks at the parents' rows.
    for (const t of [...scope].reverse()) await tx.query(`delete from public.${ident(t.table)} where ${t.where}`);
    for (const table of meta.tables) {
      const columns = await tx.query<{ column: string }>(
        `select column_name as "column" from information_schema.columns where table_schema = 'public' and table_name = $1 and is_generated = 'NEVER' order by ordinal_position`,
        [table],
      );
      if (columns.length === 0) continue;
      const list = columns.map((c) => ident(c.column)).join(", ");
      await tx.query(`insert into public.${ident(table)} (${list}) overriding system value select ${list} from ${schema}.${ident(table)}`);
    }
    // A turn may write the owner's memory (`~/.len/LEN.md`), which lives on the person, not the project.
    if (meta.ownerId) await tx.query(`update public."users" set "agentMemory" = $1 where "id" = $2`, [meta.agentMemory, meta.ownerId]);
  });
}

/** What the project's rows are, table by table: how many and a digest of them. Two equal fingerprints are
 *  the same rows. */
export async function fingerprint(sql: Sql, projectId: string): Promise<Record<string, { rows: number; digest: string }>> {
  const out: Record<string, { rows: number; digest: string }> = {};
  for (const t of await projectScope(sql, projectId)) {
    const [row] = await sql.query<{ rows: number; digest: string }>(
      `select count(*)::int as "rows", md5(coalesce(string_agg(d, '' order by d), '')) as "digest" from (select md5(x::text) as d from public.${ident(t.table)} x where ${t.where}) s`,
    );
    out[t.table] = { rows: row?.rows ?? 0, digest: row?.digest ?? "" };
  }
  return out;
}

/**
 * THE PAUSE. Moves the project's conversation in time so that its last turn ended `agoMs` before `nowMs`,
 * every row keeping its distance to the others — and with each row, the note of which provider answered it
 * (`transcript.provider.at`, which the route trusts for ten minutes). Returns how far it moved, in ms.
 */
export async function ageConversation(sql: Sql, projectId: string, agoMs: number, nowMs: number = Date.now()): Promise<number> {
  const p = projectLiteral(projectId);
  const [last] = await sql.query<{ ms: string | null }>(
    `select max(extract(epoch from "createdAt") * 1000 + coalesce("durationMs", 0))::bigint::text as ms from public."projectChatMessages" where "projectId" = ${p}`,
  );
  if (!last?.ms) return 0;
  const shiftMs = Number(last.ms) - (nowMs - agoMs);
  if (!Number.isFinite(shiftMs) || shiftMs === 0) return 0;
  const interval = `make_interval(secs => ${(shiftMs / 1000).toFixed(3)})`;
  await sql.query(
    `update public."projectChatMessages"
        set "createdAt" = "createdAt" - ${interval},
            "transcript" = case
              when "transcript"->'provider'->>'at' is not null then jsonb_set(
                "transcript", '{provider,at}',
                to_jsonb(to_char((("transcript"->'provider'->>'at')::timestamptz - ${interval}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
              else "transcript" end
      where "projectId" = ${p}`,
  );
  return shiftMs;
}
