// Canales privados (Realtime Authorization), como Supabase Realtime
// (supabase/realtime @ f86df8c3, Apache-2.0: lib/realtime/tenants/
// authorization.ex y `Tenants.create_messages_partitions`): las políticas de
// RLS del proyecto en `realtime.messages` deciden quién lee y quién escribe un
// tema, con `realtime.topic()`.
//
//   · Leer: se insertan (como el dueño de la tabla) una fila por extensión con
//     el tema, se pasa al rol del usuario con sus claims y se mira cuáles ve.
//     Todo se deshace.
//   · Escribir: con el rol del usuario se intenta insertar; un 42501 es «no».
//     Se deshace.
//
// Por el pool de `authenticator`; lo del dueño, como `supabase_realtime_admin`.

import { randomUUID } from "node:crypto";

import { RollbackWith, transactionOrRollback, type ProjectDatabase, type TxQuery } from "../db";

export interface AuthorizationContext {
  readonly topic: string;
  readonly claims: Record<string, unknown>;
  readonly headers?: Record<string, string>;
}

export interface Policies {
  broadcast: { read: boolean | null; write: boolean | null };
  presence: { read: boolean | null; write: boolean | null };
}

export const emptyPolicies = (): Policies => ({ broadcast: { read: null, write: null }, presence: { read: null, write: null } });

/** Su `set_conn_config`. */
async function setConnConfig(q: TxQuery, ctx: AuthorizationContext): Promise<void> {
  const role = typeof ctx.claims.role === "string" ? ctx.claims.role : "anon";
  const sub = typeof ctx.claims.sub === "string" ? ctx.claims.sub : "";
  await q(
    `SELECT
        set_config('role', $1, true),
        set_config('realtime.topic', $2, true),
        set_config('request.jwt.claims', $3, true),
        set_config('request.jwt.claim.sub', $4, true),
        set_config('request.jwt.claim.role', $5, true),
        set_config('request.headers', $6, true)`,
    [role, ctx.topic, JSON.stringify(ctx.claims), sub, role, JSON.stringify(ctx.headers ?? {})],
  );
}

const asOwner = `select set_config('role', 'supabase_realtime_admin', true)`;

/** Su `create_messages_partitions`: de ayer a dentro de tres días. Una vez por
 *  proceso, proyecto y día. */
const partitioned = new Map<string, string>();
export async function ensureMessagePartitions(db: ProjectDatabase, ref: string, now = new Date()): Promise<void> {
  const today = now.toISOString().slice(0, 10);
  if (partitioned.get(ref) === today) return;
  const day = (offset: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset)).toISOString().slice(0, 10);
  for (let i = -1; i <= 3; i++) {
    const from = day(i);
    const to = day(i + 1);
    const name = `messages_${from.replaceAll("-", "_")}`;
    await db.transaction(async (q) => {
      await q(asOwner);
      await q(`CREATE TABLE IF NOT EXISTS realtime.${name} PARTITION OF realtime.messages FOR VALUES FROM ('${from}') TO ('${to}')`);
    });
  }
  partitioned.set(ref, today);
}

/** Para las pruebas. */
export function forgetMessagePartitions(): void {
  partitioned.clear();
}

/** Su `get_read_authorizations`: lee broadcast (y presence, si está activo). */
export async function readAuthorizations(db: ProjectDatabase, ctx: AuthorizationContext, policies: Policies, o: { presenceEnabled: boolean }): Promise<Policies> {
  const extensions = o.presenceEnabled ? (["broadcast", "presence"] as const) : (["broadcast"] as const);
  const ids = new Map(extensions.map((e) => [e, randomUUID()] as const));
  const seen = await transactionOrRollback(db, async (q) => {
    await q(asOwner);
    for (const [extension, id] of ids) {
      await q(`insert into realtime.messages (id, topic, extension) values ($1, $2, $3)`, [id, ctx.topic, extension]);
    }
    await setConnConfig(q, ctx);
    const r = await q(`select id from realtime.messages where id = any($1::uuid[])`, [`{${[...ids.values()].join(",")}}`]);
    throw new RollbackWith(new Set(r.rows.map((x) => String(x.id))));
  });
  const out: Policies = { broadcast: { ...policies.broadcast }, presence: { ...policies.presence } };
  for (const [extension, id] of ids) out[extension].read = (seen as Set<string>).has(id);
  return out;
}

/** Su `get_write_authorizations` para una extensión. */
export async function writeAuthorization(db: ProjectDatabase, ctx: AuthorizationContext, policies: Policies, extension: "broadcast" | "presence"): Promise<Policies> {
  const allowed = await transactionOrRollback(db, async (q) => {
    await setConnConfig(q, ctx);
    try {
      await q(`insert into realtime.messages (topic, extension) values ($1, $2)`, [ctx.topic, extension]);
    } catch (err) {
      if ((err as { code?: string }).code === "42501") throw new RollbackWith(false);
      throw err;
    }
    throw new RollbackWith(true);
  });
  const out: Policies = { broadcast: { ...policies.broadcast }, presence: { ...policies.presence } };
  out[extension].write = allowed as boolean;
  return out;
}
