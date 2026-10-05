// Las consultas de Storage, portadas de supabase/storage @ eccef5e7
// (Apache-2.0): src/storage/database/pg.ts (las consultas) y
// src/internal/database/postgres/scope.ts (el rol y los claims de cada una).
//
// Todo corre en una transacción COMO el rol de la petición, para que RLS
// decida; lo que no es del usuario (la fila final de una subida, mirar si un
// bucket es público) como `supabase_storage_admin`, su `asSuperUser()`.

import { RollbackWith, transactionOrRollback, type TxQuery } from "../db";
import { ERRORS, fromDbError, StorageError } from "./errors";
import type { StorageContext } from "./handler";

/** Los `statement_timeout` de los roles, del arranque de Supabase (como
 *  lib/backend/rest/handler.ts). */
const ROLE_TIMEOUT: Record<string, string | null> = { anon: "3s", authenticated: "8s", service_role: null, supabase_storage_admin: null };

function toStorageError(err: unknown): unknown {
  if (err instanceof StorageError || err instanceof RollbackWith) return err;
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return fromDbError(err);
  return err;
}

async function scoped<T>(ctx: StorageContext, role: string, fn: (q: TxQuery) => Promise<T>): Promise<T> {
  try {
    return await transactionOrRollback(ctx.project.db, async (q) => {
      // buildScopeStatement de Supabase, con `true` (local a la transacción).
      await q(
        `select set_config('role', $1, true),
                set_config('request.jwt.claim.role', $2, true),
                set_config('request.jwt', $3, true),
                set_config('request.jwt.claim.sub', $4, true),
                set_config('request.jwt.claims', $5, true),
                set_config('request.method', $6, true),
                set_config('request.path', $7, true),
                set_config('storage.operation', $8, true),
                set_config('storage.allow_delete_query', 'true', true)`,
        [
          role,
          String(ctx.claims.role ?? ctx.role),
          ctx.jwt,
          typeof ctx.claims.sub === "string" ? ctx.claims.sub : "",
          JSON.stringify(ctx.claims),
          ctx.method,
          ctx.path,
          "",
        ],
      );
      const timeout = ROLE_TIMEOUT[role];
      if (timeout) await q(`select set_config('statement_timeout', $1, true)`, [timeout]);
      return fn(q);
    });
  } catch (err) {
    throw toStorageError(err);
  }
}

/** Como el rol de la petición: RLS manda. */
export function asRole<T>(ctx: StorageContext, fn: (q: TxQuery) => Promise<T>): Promise<T> {
  return scoped(ctx, ctx.role, fn);
}

/** Como `supabase_storage_admin`, el dueño de las tablas (su `asSuperUser`). */
export function asStorageAdmin<T>(ctx: StorageContext, fn: (q: TxQuery) => Promise<T>): Promise<T> {
  return scoped(ctx, "supabase_storage_admin", fn);
}

/** Corre `fn` como el rol y lo deshace siempre: ¿le dejaría RLS? (su
 *  `testPermission`). Devuelve lo que devolvió `fn`. */
export async function testPermission<T>(ctx: StorageContext, fn: (q: TxQuery) => Promise<T>): Promise<T> {
  return asRole(ctx, async (q) => {
    throw new RollbackWith(await fn(q));
  });
}

// ── Objetos ──────────────────────────────────────────────────────────────

/** Los campos de su `ObjectMetadata` que guarda `storage.objects.metadata`. */
export interface ObjectMetadata {
  readonly eTag: string;
  readonly size: number;
  readonly mimetype: string;
  readonly cacheControl: string;
  readonly lastModified: string;
  readonly contentLength: number;
  readonly httpStatusCode: number;
}

export interface ObjectRow {
  readonly id: string;
  readonly bucket_id: string;
  readonly name: string;
  readonly owner: string | null;
  readonly owner_id: string | null;
  readonly version: string | null;
  readonly metadata: ObjectMetadata | null;
  readonly user_metadata: Record<string, unknown> | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly last_accessed_at: string;
}

export interface NewObject {
  readonly bucket_id: string;
  readonly name: string;
  readonly owner: string | undefined | null;
  readonly version: string;
  readonly metadata: Partial<ObjectMetadata> | Record<string, unknown> | null;
  readonly user_metadata: Record<string, unknown> | null | undefined;
}

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-5][0-9a-fA-F]{3}-[089abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;

/** `owner` es uuid (sólo si lo es); `owner_id`, el texto tal cual (su `normalizeRecordColumns`). */
function ownerColumns(owner: string | undefined | null): { owner: string | null; owner_id: string | null } {
  if (!owner) return { owner: null, owner_id: null };
  return { owner: UUID_RE.test(owner) ? owner : null, owner_id: owner };
}

const json = (v: unknown) => (v === undefined || v === null ? null : JSON.stringify(v));

export async function insertObject(q: TxQuery, o: NewObject): Promise<void> {
  const { owner, owner_id } = ownerColumns(o.owner);
  try {
    await q(
      `insert into storage.objects (bucket_id, name, owner, owner_id, version, metadata, user_metadata)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
      [o.bucket_id, o.name, owner, owner_id, o.version, json(o.metadata), json(o.user_metadata)],
    );
  } catch (err) {
    const se = toStorageError(err);
    if (se instanceof StorageError && se.code === "ResourceAlreadyExists") throw ERRORS.KeyAlreadyExists();
    throw se;
  }
}

/** Su `upsertObject`, con el índice de la versión actual (`objects-current-version-index`). */
export async function upsertObject(q: TxQuery, o: NewObject): Promise<ObjectRow> {
  const { owner, owner_id } = ownerColumns(o.owner);
  const r = await q(
    `insert into storage.objects (bucket_id, name, owner, owner_id, version, metadata, user_metadata)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
     on conflict (bucket_id, name collate "C") where archived_at is null
     do update set metadata = excluded.metadata, user_metadata = excluded.user_metadata, version = excluded.version,
                   owner = excluded.owner, owner_id = excluded.owner_id
     returning *`,
    [o.bucket_id, o.name, owner, owner_id, o.version, json(o.metadata), json(o.user_metadata)],
  );
  return r.rows[0] as unknown as ObjectRow;
}

export async function findObject(
  q: TxQuery,
  bucketId: string,
  name: string,
  o: { forUpdate?: boolean; dontErrorOnEmpty?: boolean } = {},
): Promise<ObjectRow> {
  const r = await q(
    `select * from storage.objects where name collate "C" = $1 and bucket_id = $2 and archived_at is null limit 1${o.forUpdate ? " for update" : ""}`,
    [name, bucketId],
  );
  const row = r.rows[0] as unknown as ObjectRow | undefined;
  if (!row && !o.dontErrorOnEmpty) throw ERRORS.NoSuchKey();
  return row as ObjectRow;
}

/** Un array de texto como literal de Postgres: PGlite no convierte arrays de
 *  JS en parámetros (pg sí), así que va siempre como `'{…}'::text[]`. */
export function textArray(values: readonly string[]): string {
  return `{${values.map((v) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;
}

export async function findObjects(q: TxQuery, bucketId: string, names: readonly string[]): Promise<ObjectRow[]> {
  if (names.length === 0) return [];
  const r = await q(`select * from storage.objects where bucket_id = $1 and name collate "C" = any($2::text[]) and archived_at is null`, [
    bucketId,
    textArray(names),
  ]);
  return r.rows as unknown as ObjectRow[];
}

export async function deleteObjects(q: TxQuery, bucketId: string, names: readonly string[]): Promise<ObjectRow[]> {
  if (names.length === 0) return [];
  const r = await q(
    `delete from storage.objects where bucket_id = $1 and name collate "C" = any($2::text[]) and archived_at is null returning *`,
    [bucketId, textArray(names)],
  );
  return r.rows as unknown as ObjectRow[];
}

export interface SearchOptions {
  readonly limit?: number;
  readonly offset?: number;
  readonly search?: string;
  readonly sortBy?: { readonly column?: string; readonly order?: string };
}

const SEARCH_OBJECTS_MAX_LIMIT = 1500;
const SEARCH_SORT_COLUMNS = ["name", "updated_at", "created_at", "last_accessed_at"];

/** Su `searchObjects` (sin `exactMatch`): la función `storage.search` que crean
 *  sus migraciones, como el rol (RLS decide qué se ve). */
export async function searchObjects(q: TxQuery, bucketId: string, prefix: string, o: SearchOptions): Promise<Record<string, unknown>[]> {
  const sortColumn = o.sortBy?.column ?? "name";
  if (!SEARCH_SORT_COLUMNS.includes(sortColumn)) throw ERRORS.InvalidParameter("sortBy.column");
  const order = (o.sortBy?.order ?? "asc").toLowerCase();
  if (order !== "asc" && order !== "desc") throw ERRORS.InvalidParameter("sortBy.order");
  const shouldEscape = sortColumn !== "name";
  const safePrefix = shouldEscape ? escapeLike(prefix) : prefix;
  const safeSearch = shouldEscape ? escapeLike(o.search || "") : o.search || "";
  const limit = Math.min(o.limit || 100, SEARCH_OBJECTS_MAX_LIMIT);
  const r = await q(
    `select name, id, updated_at, created_at, last_accessed_at, metadata, version, archived_at, is_delete_marker, is_versioned
       from storage.search($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [safePrefix, bucketId, limit, (safePrefix + safeSearch).split("/").length, o.offset || 0, safeSearch, sortColumn, order, "exclude", "exclude"],
  );
  return r.rows;
}

/** Su `updateObject`: mueve la fila (nombre, bucket, versión, dueño). */
export async function updateObject(
  q: TxQuery,
  bucketId: string,
  name: string,
  data: { name: string; bucket_id: string; version: string; owner: string | undefined; metadata?: unknown; user_metadata?: unknown },
): Promise<ObjectRow> {
  const { owner, owner_id } = ownerColumns(data.owner);
  const sets = [`name = $1`, `bucket_id = $2`, `version = $3`, `owner = $4`, `owner_id = $5`];
  const values: unknown[] = [data.name, data.bucket_id, data.version, owner, owner_id];
  if (data.metadata !== undefined) {
    values.push(json(data.metadata));
    sets.push(`metadata = $${values.length}::jsonb`);
  }
  if (data.user_metadata !== undefined) {
    values.push(json(data.user_metadata));
    sets.push(`user_metadata = $${values.length}::jsonb`);
  }
  values.push(bucketId, name);
  const r = await q(
    `update storage.objects set ${sets.join(", ")} where bucket_id = $${values.length - 1} and name collate "C" = $${values.length} and archived_at is null returning *`,
    values,
  );
  const row = r.rows[0] as unknown as ObjectRow | undefined;
  if (!row) throw ERRORS.NoSuchKey();
  return row;
}

/** Lo que ocupan todos los ficheros del proyecto (para el tope de 1 GB). */
export async function projectUsageBytes(q: TxQuery): Promise<number> {
  const r = await q(`select coalesce(sum((metadata->>'size')::bigint), 0)::text as n from storage.objects`);
  return Number(r.rows[0]?.n ?? 0);
}

// ── Buckets ──────────────────────────────────────────────────────────────

export interface Bucket {
  readonly id: string;
  readonly name: string;
  readonly owner: string | null;
  readonly owner_id?: string | null;
  readonly public: boolean;
  readonly file_size_limit: number | null;
  readonly allowed_mime_types: string[] | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly type?: string;
}

/** Las columnas que devuelve su `getBucket`; `listBuckets` suma `type`. */
const BUCKET_COLUMNS = "id, name, owner, public, created_at, updated_at, file_size_limit, allowed_mime_types";

/** `file_size_limit` es bigint: `pg` lo da como texto, Supabase como número. */
function bucketOf(row: Record<string, unknown>): Bucket {
  const limit = row.file_size_limit;
  return { ...(row as unknown as Bucket), file_size_limit: limit === null || limit === undefined ? null : Number(limit) };
}

export async function findBucket(
  q: TxQuery,
  id: string,
  o: { forUpdate?: boolean; dontErrorOnEmpty?: boolean; isPublic?: boolean } = {},
): Promise<Bucket> {
  const params: unknown[] = [id];
  let where = "id = $1";
  if (o.isPublic !== undefined) {
    params.push(o.isPublic);
    where += ` and public = $2`;
  }
  const r = await q(`select ${BUCKET_COLUMNS} from storage.buckets where ${where} limit 1${o.forUpdate ? " for update" : ""}`, params);
  const row = r.rows[0];
  if (!row) {
    if (o.dontErrorOnEmpty) return undefined as unknown as Bucket;
    throw ERRORS.NoSuchBucket();
  }
  return bucketOf(row);
}

export interface ListBucketOptions {
  readonly limit?: number;
  readonly offset?: number;
  readonly sortColumn?: "id" | "name" | "created_at" | "updated_at";
  readonly sortOrder?: "asc" | "desc";
  readonly search?: string;
}

/** pg.ts `escapeLike`. */
export function escapeLike(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/([%_])/g, "\\$1");
}

export async function listBuckets(q: TxQuery, o: ListBucketOptions = {}): Promise<Bucket[]> {
  const values: unknown[] = [];
  const conditions: string[] = [];
  if (o.search) {
    values.push(`%${escapeLike(o.search)}%`);
    conditions.push(`name ilike $${values.length}`);
  }
  const orderBy = o.sortColumn ? ` order by "${o.sortColumn}" ${o.sortOrder === "desc" ? "desc" : "asc"}` : "";
  let pagination = "";
  if (o.limit !== undefined) {
    values.push(o.limit);
    pagination += ` limit $${values.length}`;
  }
  if (o.offset !== undefined) {
    values.push(o.offset);
    pagination += ` offset $${values.length}`;
  }
  const r = await q(
    `select ${BUCKET_COLUMNS}, type from storage.buckets${conditions.length ? ` where ${conditions.join(" and ")}` : ""}${orderBy}${pagination}`,
    values,
  );
  return r.rows.map(bucketOf);
}

export interface NewBucket {
  readonly id: string;
  readonly name: string;
  readonly owner: string | undefined;
  readonly public: boolean;
  readonly file_size_limit: number | null | undefined;
  readonly allowed_mime_types: string[] | null | undefined;
}

export async function insertBucket(q: TxQuery, b: NewBucket): Promise<void> {
  const { owner, owner_id } = ownerColumns(b.owner);
  try {
    await q(
      `insert into storage.buckets (id, name, owner, owner_id, public, file_size_limit, allowed_mime_types, type)
       values ($1, $2, $3, $4, $5, $6, $7::text[], 'STANDARD')`,
      [b.id, b.name, owner, owner_id, b.public, b.file_size_limit ?? null, b.allowed_mime_types ? textArray(b.allowed_mime_types) : null],
    );
  } catch (err) {
    const se = toStorageError(err);
    if (se instanceof StorageError && se.code === "ResourceAlreadyExists") throw ERRORS.BucketAlreadyExists();
    throw se;
  }
}

export async function updateBucket(
  q: TxQuery,
  id: string,
  fields: { public?: boolean; file_size_limit?: number | null; allowed_mime_types?: string[] | null },
): Promise<void> {
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return;
  const values = entries.map(([k, v]) => (k === "allowed_mime_types" && Array.isArray(v) ? textArray(v) : v));
  const set = entries.map(([k], i) => `"${k}" = $${i + 1}${k === "allowed_mime_types" ? "::text[]" : ""}`).join(", ");
  const r = await q(`update storage.buckets set ${set} where id = $${entries.length + 1} returning id`, [...values, id]);
  if (r.rows.length === 0) throw ERRORS.NoSuchBucket();
}

export async function deleteBucket(q: TxQuery, id: string): Promise<number> {
  const r = await q(`delete from storage.buckets where id = $1`, [id]);
  return r.rowCount;
}

export async function countObjectsInBucket(q: TxQuery, bucketId: string, limit: number): Promise<number> {
  const r = await q(`select 1 from storage.objects where bucket_id = $1 limit $2`, [bucketId, limit]);
  return r.rows.length;
}
