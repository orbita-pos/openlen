// Lo que GoTrue hace en sus tablas (internal/models: user.go, identity.go,
// sessions.go, refresh_token.go, one_time_token.go), sobre el esquema `auth`
// real de cada proyecto. Corre con el rol `supabase_auth_admin`, como GoTrue.
// Aquí no se decide nada: sólo se lee y se escribe.

import crypto from "node:crypto";

import type { TxQuery } from "../db";

/** El `instance_id` que GoTrue escribe en todas sus filas. */
export const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

/** Un array como literal de Postgres (`{"a","b"}`). `pg` convierte los arrays
 *  de JS solo y PGlite no: así vale para los dos. */
function pgArray(values: readonly string[]): string {
  return `{${values.map((v) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;
}

export interface AuthUserRow {
  id: string;
  aud: string;
  role: string;
  email: string | null;
  encrypted_password: string | null;
  email_confirmed_at: Date | string | null;
  invited_at: Date | string | null;
  confirmation_token: string | null;
  confirmation_sent_at: Date | string | null;
  recovery_token: string | null;
  recovery_sent_at: Date | string | null;
  email_change: string | null;
  email_change_sent_at: Date | string | null;
  last_sign_in_at: Date | string | null;
  raw_app_meta_data: Record<string, unknown> | null;
  raw_user_meta_data: Record<string, unknown> | null;
  created_at: Date | string;
  updated_at: Date | string;
  phone: string | null;
  phone_confirmed_at: Date | string | null;
  confirmed_at: Date | string | null;
  banned_until: Date | string | null;
  deleted_at: Date | string | null;
  is_anonymous: boolean;
  is_sso_user: boolean;
}

export interface IdentityRow {
  id: string;
  provider_id: string;
  user_id: string;
  identity_data: Record<string, unknown>;
  provider: string;
  last_sign_in_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  email: string | null;
}

const USER_COLUMNS = `id, aud, role, email, encrypted_password, email_confirmed_at, invited_at, confirmation_token,
  confirmation_sent_at, recovery_token, recovery_sent_at, email_change, email_change_sent_at, last_sign_in_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, phone, phone_confirmed_at, confirmed_at,
  banned_until, deleted_at, is_anonymous, is_sso_user`;

export async function findUserById(q: TxQuery, id: string): Promise<AuthUserRow | null> {
  const r = await q(`select ${USER_COLUMNS} from auth.users where id = $1`, [id]);
  return (r.rows[0] as unknown as AuthUserRow | undefined) ?? null;
}

/** `models.IsDuplicatedEmail` para un registro por correo. */
export async function findUserByEmail(q: TxQuery, email: string, aud: string): Promise<AuthUserRow | null> {
  const r = await q(
    `select ${USER_COLUMNS} from auth.users where lower(email) = $1 and aud = $2 and is_sso_user = false limit 1`,
    [email.toLowerCase(), aud],
  );
  return (r.rows[0] as unknown as AuthUserRow | undefined) ?? null;
}

export async function listIdentities(q: TxQuery, userId: string): Promise<IdentityRow[]> {
  const r = await q(
    `select id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at, email
       from auth.identities where user_id = $1 order by created_at`,
    [userId],
  );
  return r.rows as unknown as IdentityRow[];
}

export async function insertUser(
  q: TxQuery,
  u: {
    id: string;
    aud: string;
    email: string;
    passwordHash: string | null;
    appMetaData: Record<string, unknown>;
    userMetaData: Record<string, unknown>;
    emailConfirmed: boolean;
    invited: boolean;
  },
): Promise<void> {
  await q(
    `insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, invited_at,
       confirmation_token, recovery_token, email_change_token_new, email_change, raw_app_meta_data, raw_user_meta_data,
       created_at, updated_at, is_sso_user, is_anonymous)
     values ($1, $2, $3, 'authenticated', $4, $5, case when $6 then now() end, case when $7 then now() end,
       '', '', '', '', $8, $9, now(), now(), false, false)`,
    [ZERO_UUID, u.id, u.aud, u.email, u.passwordHash, u.emailConfirmed, u.invited, JSON.stringify(u.appMetaData), JSON.stringify(u.userMetaData)],
  );
}

export async function insertIdentity(q: TxQuery, userId: string, provider: string, data: Record<string, unknown>): Promise<void> {
  await q(
    `insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
     values ($1, $2, $3, $4, $5, now(), now(), now())`,
    [crypto.randomUUID(), String(data.sub), userId, JSON.stringify(data), provider],
  );
}

/** `UpdateUserMetaData`: mezcla; una clave con null la quita. */
export async function mergeUserMetaData(q: TxQuery, userId: string, updates: Record<string, unknown>): Promise<void> {
  const remove = Object.keys(updates).filter((k) => updates[k] === null);
  const keep = Object.fromEntries(Object.entries(updates).filter(([, v]) => v !== null));
  await q(
    `update auth.users set raw_user_meta_data = (coalesce(raw_user_meta_data, '{}'::jsonb) || $2::jsonb) - $3::text[], updated_at = now() where id = $1`,
    [userId, JSON.stringify(keep), pgArray(remove)],
  );
}

export async function mergeAppMetaData(q: TxQuery, userId: string, updates: Record<string, unknown>): Promise<void> {
  await q(
    `update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || $2::jsonb, updated_at = now() where id = $1`,
    [userId, JSON.stringify(updates)],
  );
}

export async function setPassword(q: TxQuery, userId: string, passwordHash: string): Promise<void> {
  await q(`update auth.users set encrypted_password = $2, updated_at = now() where id = $1`, [userId, passwordHash]);
}

// ─── Fichas de un uso de los correos ────────────────────────────────────────

export type OneTimeTokenType = "confirmation_token" | "recovery_token";

/** Guarda la ficha como GoTrue: en su columna de `auth.users` (con la hora de
 *  envío) y en `auth.one_time_tokens`. Sustituye a la anterior del mismo tipo. */
export async function storeEmailToken(
  q: TxQuery,
  user: { id: string; email: string },
  type: OneTimeTokenType,
  tokenHash: string,
  opts: { invited?: boolean } = {},
): Promise<void> {
  if (type === "confirmation_token") {
    await q(
      `update auth.users set confirmation_token = $2, confirmation_sent_at = now()${opts.invited ? ", invited_at = now()" : ""} where id = $1`,
      [user.id, tokenHash],
    );
  } else {
    await q(`update auth.users set recovery_token = $2, recovery_sent_at = now() where id = $1`, [user.id, tokenHash]);
  }
  await q(`delete from auth.one_time_tokens where user_id = $1 and token_type = $2::auth.one_time_token_type`, [user.id, type]);
  await q(
    `insert into auth.one_time_tokens (id, user_id, token_type, token_hash, relates_to, created_at, updated_at)
     values ($1, $2, $3::auth.one_time_token_type, $4, $5, now(), now())`,
    [crypto.randomUUID(), user.id, type, tokenHash, user.email],
  );
}

/** `FindUserByOneTimeToken`. */
export async function findUserByEmailToken(q: TxQuery, tokenHash: string, types: readonly OneTimeTokenType[]): Promise<AuthUserRow | null> {
  const r = await q(
    `select u.id from auth.one_time_tokens t join auth.users u on u.id = t.user_id
      where t.token_hash = $1 and t.token_type = any($2::auth.one_time_token_type[]) limit 1`,
    [tokenHash, pgArray(types)],
  );
  const id = r.rows[0]?.id;
  return id ? findUserById(q, String(id)) : null;
}

/** `User.Confirm`: confirmado, sin ficha, `email_verified` en sus metadatos y
 *  en su identidad de correo. */
export async function confirmUser(q: TxQuery, userId: string): Promise<void> {
  await q(`update auth.users set confirmation_token = '', email_confirmed_at = now(), updated_at = now() where id = $1`, [userId]);
  await mergeUserMetaData(q, userId, { email_verified: true });
  await q(
    `update auth.identities set identity_data = identity_data || '{"email_verified": true}'::jsonb, updated_at = now()
      where user_id = $1 and provider = 'email'`,
    [userId],
  );
  await q(`delete from auth.one_time_tokens where user_id = $1`, [userId]);
}

/** `User.Recover`. */
export async function clearRecovery(q: TxQuery, userId: string): Promise<void> {
  await q(`update auth.users set recovery_token = '' where id = $1`, [userId]);
  await q(`delete from auth.one_time_tokens where user_id = $1`, [userId]);
}

// ─── Sesiones y refresh tokens (algoritmo 1 de GoTrue) ──────────────────────

/** `crypto.SecureAlphanumeric(12)`: 12 caracteres en minúsculas y dígitos. */
function newRefreshTokenString(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (const b of crypto.randomBytes(24)) {
    if (b < 252) out += alphabet[b % 36];
    if (out.length === 12) break;
  }
  return out.length === 12 ? out : newRefreshTokenString();
}

export interface NewSession {
  sessionId: string;
  refreshToken: string;
}

/** `GrantAuthenticatedUser`: una sesión, su método de entrada (mfa_amr_claims),
 *  su primer refresh token, y `last_sign_in_at`. */
export async function createSession(
  q: TxQuery,
  userId: string,
  method: string,
  meta: { userAgent: string | null; ip: string | null },
): Promise<NewSession> {
  const sessionId = crypto.randomUUID();
  await q(
    `insert into auth.sessions (id, user_id, created_at, updated_at, aal, user_agent, ip)
     values ($1, $2, now(), now(), 'aal1', $3, $4::inet)`,
    [sessionId, userId, meta.userAgent, meta.ip],
  );
  await q(
    `insert into auth.mfa_amr_claims (session_id, created_at, updated_at, authentication_method, id) values ($1, now(), now(), $2, $3)`,
    [sessionId, method, crypto.randomUUID()],
  );
  const refreshToken = newRefreshTokenString();
  await q(
    `insert into auth.refresh_tokens (instance_id, token, user_id, revoked, created_at, updated_at, parent, session_id)
     values ($1, $2, $3, false, now(), now(), null, $4)`,
    [ZERO_UUID, refreshToken, userId, sessionId],
  );
  await q(`update auth.users set last_sign_in_at = now() where id = $1`, [userId]);
  await q(`update auth.identities set last_sign_in_at = now() where user_id = $1`, [userId]);
  return { sessionId, refreshToken };
}

export async function sessionExists(q: TxQuery, sessionId: string): Promise<boolean> {
  const r = await q(`select 1 from auth.sessions where id = $1`, [sessionId]);
  return r.rows.length > 0;
}

/** El `amr` del JWT: cómo se entró en la sesión, con su hora (segundos). */
export async function sessionAmr(q: TxQuery, sessionId: string): Promise<{ method: string; timestamp: number }[]> {
  const r = await q(
    `select authentication_method as method, extract(epoch from created_at)::bigint as ts
       from auth.mfa_amr_claims where session_id = $1 order by created_at desc`,
    [sessionId],
  );
  return r.rows.map((x) => ({ method: String(x.method), timestamp: Number(x.ts) }));
}

export interface RefreshTokenRow {
  id: string;
  token: string;
  user_id: string;
  revoked: boolean;
  updated_at: Date | string;
  parent: string | null;
  session_id: string | null;
}

export async function findRefreshToken(q: TxQuery, token: string): Promise<RefreshTokenRow | null> {
  const r = await q(
    `select id::text as id, token, user_id, revoked, updated_at, parent, session_id from auth.refresh_tokens where token = $1 for update`,
    [token],
  );
  return (r.rows[0] as unknown as RefreshTokenRow | undefined) ?? null;
}

/** El refresh token vigente (no revocado, el último) de una sesión. */
export async function activeRefreshToken(q: TxQuery, sessionId: string): Promise<RefreshTokenRow | null> {
  const r = await q(
    `select id::text as id, token, user_id, revoked, updated_at, parent, session_id
       from auth.refresh_tokens where session_id = $1 and not revoked order by id desc limit 1`,
    [sessionId],
  );
  return (r.rows[0] as unknown as RefreshTokenRow | undefined) ?? null;
}

/** `GrantRefreshTokenSwap`: revoca el viejo y crea su hijo en la misma sesión. */
export async function swapRefreshToken(q: TxQuery, old: RefreshTokenRow): Promise<string> {
  await q(`update auth.refresh_tokens set revoked = true, updated_at = now() where id = $1::bigint`, [old.id]);
  const token = newRefreshTokenString();
  await q(
    `insert into auth.refresh_tokens (instance_id, token, user_id, revoked, created_at, updated_at, parent, session_id)
     values ($1, $2, $3, false, now(), now(), $4, $5)`,
    [ZERO_UUID, token, old.user_id, old.token, old.session_id],
  );
  await q(`update auth.sessions set refreshed_at = now(), updated_at = now() where id = $1`, [old.session_id]);
  return token;
}

/** `RevokeTokenFamily`: alguien reusó un refresh token viejo; se revoca toda la sesión. */
export async function revokeSessionTokens(q: TxQuery, sessionId: string): Promise<void> {
  await q(`update auth.refresh_tokens set revoked = true, updated_at = now() where session_id = $1`, [sessionId]);
}

/** `Logout`: global (todas), local (ésta) u others (las demás). Los refresh
 *  tokens se van con su sesión (ON DELETE CASCADE). */
export async function deleteSessions(q: TxQuery, userId: string, sessionId: string, scope: "global" | "local" | "others"): Promise<void> {
  if (scope === "global") await q(`delete from auth.sessions where user_id = $1`, [userId]);
  else if (scope === "local") await q(`delete from auth.sessions where id = $1`, [sessionId]);
  else await q(`delete from auth.sessions where user_id = $1 and id <> $2`, [userId, sessionId]);
  await q(`delete from auth.refresh_tokens where user_id = $1 and session_id is null`, [userId]);
}

export async function listUsers(q: TxQuery, aud: string, page: number, perPage: number): Promise<{ users: AuthUserRow[]; total: number }> {
  const total = Number((await q(`select count(*)::int8 as n from auth.users where aud = $1`, [aud])).rows[0]?.n ?? 0);
  const r = await q(`select ${USER_COLUMNS} from auth.users where aud = $1 order by created_at desc limit $2 offset $3`, [
    aud,
    perPage,
    (page - 1) * perPage,
  ]);
  return { users: r.rows as unknown as AuthUserRow[], total };
}

export async function deleteUser(q: TxQuery, userId: string): Promise<boolean> {
  const r = await q(`delete from auth.users where id = $1 returning id`, [userId]);
  return r.rows.length > 0;
}
