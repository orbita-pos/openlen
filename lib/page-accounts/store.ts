// La capa de base de las cuentas de una página. Como lib/page-data/store.ts:
// AQUÍ NO SE DECIDE NADA de permisos —quién puede crear una cuenta, qué papel
// vale—; eso llega resuelto de las rutas. Este fichero guarda y busca.
//
// Las tablas son las de Miembros (`siteMembers`, `memberSessions`,
// `memberLoginTokens`), retirado el 2026-08-21 con sus tablas conservadas. Una
// cuenta es de UN proyecto: la clave es `(projectId, email)`, y una cuenta de
// `tienda.openlen.app` no existe en `otra.openlen.app`.

import "server-only";
import { and, asc, eq, gt, isNotNull, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { hashToken, newSessionToken } from "./session";

export interface PageAccount {
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
  readonly role: string | null;
  readonly createdAt: Date;
  readonly lastLoginAt: Date | null;
}

// Una función y no una constante: leer `schema` al importar el módulo rompe a
// quien lo importe con la base sustituida (la ruta /api/d en sus pruebas).
function accountColumns() {
  return {
    id: schema.siteMembers.id,
    email: schema.siteMembers.email,
    name: schema.siteMembers.name,
    role: schema.siteMembers.role,
    createdAt: schema.siteMembers.createdAt,
    lastLoginAt: schema.siteMembers.lastLoginAt,
  };
}

/** Con el hash de la contraseña: sólo para `login`. Nunca sale de la ruta. */
export async function findAccountForLogin(
  projectId: string,
  email: string,
): Promise<(PageAccount & { passwordHash: string | null; status: string }) | null> {
  const [row] = await db
    .select({ ...accountColumns(), passwordHash: schema.siteMembers.passwordHash, status: schema.siteMembers.status })
    .from(schema.siteMembers)
    .where(and(eq(schema.siteMembers.projectId, projectId), eq(schema.siteMembers.email, email)))
    .limit(1);
  return row ?? null;
}

export async function getAccount(projectId: string, id: string): Promise<PageAccount | null> {
  const [row] = await db
    .select(accountColumns())
    .from(schema.siteMembers)
    .where(and(eq(schema.siteMembers.projectId, projectId), eq(schema.siteMembers.id, id)))
    .limit(1);
  return row ?? null;
}

export async function listAccounts(projectId: string): Promise<PageAccount[]> {
  return db
    .select(accountColumns())
    .from(schema.siteMembers)
    .where(eq(schema.siteMembers.projectId, projectId))
    .orderBy(asc(schema.siteMembers.createdAt));
}

/** `"exists"` si ese correo ya tiene cuenta en este proyecto. */
export async function createAccount(args: {
  projectId: string;
  email: string;
  name: string | null;
  role: string | null;
  passwordHash: string;
}): Promise<PageAccount | "exists"> {
  const rows = await db
    .insert(schema.siteMembers)
    .values({
      projectId: args.projectId,
      email: args.email,
      name: args.name,
      role: args.role,
      passwordHash: args.passwordHash,
      status: "active",
    })
    .onConflictDoNothing({ target: [schema.siteMembers.projectId, schema.siteMembers.email] })
    .returning(accountColumns());
  return rows[0] ?? "exists";
}

export async function updateAccount(
  projectId: string,
  id: string,
  patch: { role?: string | null; name?: string | null; passwordHash?: string },
): Promise<PageAccount | null> {
  const [row] = await db
    .update(schema.siteMembers)
    .set(patch)
    .where(and(eq(schema.siteMembers.projectId, projectId), eq(schema.siteMembers.id, id)))
    .returning(accountColumns());
  return row ?? null;
}

/** Sus sesiones se van con ella (`ON DELETE CASCADE`). */
export async function deleteAccount(projectId: string, id: string): Promise<boolean> {
  const rows = await db
    .delete(schema.siteMembers)
    .where(and(eq(schema.siteMembers.projectId, projectId), eq(schema.siteMembers.id, id)))
    .returning({ id: schema.siteMembers.id });
  return rows.length > 0;
}

export async function markLogin(id: string): Promise<void> {
  await db.update(schema.siteMembers).set({ lastLoginAt: new Date() }).where(eq(schema.siteMembers.id, id));
}

// ─── Sesiones ────────────────────────────────────────────────────────────────

/** Una de las dos: la de un miembro (`memberId`) o la del dueño
 *  (`ownerUserId`). Devuelve el token CRUDO, que sólo viaja en la cookie. */
export async function createSession(
  args: { projectId: string; ttlMs: number } & ({ memberId: string } | { ownerUserId: string }),
): Promise<string> {
  const { raw, hash } = newSessionToken();
  await db.insert(schema.memberSessions).values({
    tokenHash: hash,
    projectId: args.projectId,
    memberId: "memberId" in args ? args.memberId : null,
    ownerUserId: "ownerUserId" in args ? args.ownerUserId : null,
    expiresAt: new Date(Date.now() + args.ttlMs),
  });
  return raw;
}

export interface SessionRow {
  readonly memberId: string | null;
  readonly ownerUserId: string | null;
}

/** La sesión de ESTE proyecto con ese token, si no ha caducado. Una sesión de
 *  otro proyecto no vale aquí aunque el token exista. */
export async function findSession(projectId: string, raw: string): Promise<SessionRow | null> {
  const [row] = await db
    .select({ memberId: schema.memberSessions.memberId, ownerUserId: schema.memberSessions.ownerUserId })
    .from(schema.memberSessions)
    .where(
      and(
        eq(schema.memberSessions.tokenHash, hashToken(raw)),
        eq(schema.memberSessions.projectId, projectId),
        gt(schema.memberSessions.expiresAt, sql`now()`),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function deleteSession(raw: string): Promise<void> {
  await db.delete(schema.memberSessions).where(eq(schema.memberSessions.tokenHash, hashToken(raw)));
}

/** «Salir de todos los dispositivos», y lo que pasa al cambiar la contraseña. */
export async function deleteAccountSessions(projectId: string, memberId: string): Promise<void> {
  await db
    .delete(schema.memberSessions)
    .where(and(eq(schema.memberSessions.projectId, projectId), eq(schema.memberSessions.memberId, memberId)));
}

// ─── El código de un uso del dueño ───────────────────────────────────────────
// El dueño entra en su página con su cuenta de OpenLen: openlen.com comprueba
// que es él y lo devuelve a la página con un código de UN uso y 60 s, que la
// página canjea por su sesión. Así no hay una segunda contraseña del dueño por
// cada sitio.

export const OWNER_CODE_TTL_MS = 60 * 1000;

export async function createOwnerCode(args: { projectId: string; ownerUserId: string; email: string }): Promise<string> {
  const { raw, hash } = newSessionToken();
  await db.insert(schema.memberLoginTokens).values({
    tokenHash: hash,
    projectId: args.projectId,
    email: args.email,
    ownerUserId: args.ownerUserId,
    expires: new Date(Date.now() + OWNER_CODE_TTL_MS),
  });
  return raw;
}

/** El `ownerUserId` del código, gastándolo en la misma sentencia: dos canjes
 *  a la vez no pueden ganar los dos. Sólo los códigos de DUEÑO (los de un
 *  miembro llevan `ownerUserId` en null y aquí no casan). */
export async function redeemOwnerCode(projectId: string, raw: string): Promise<string | null> {
  const rows = await db
    .update(schema.memberLoginTokens)
    .set({ used: true })
    .where(
      and(
        eq(schema.memberLoginTokens.tokenHash, hashToken(raw)),
        eq(schema.memberLoginTokens.projectId, projectId),
        eq(schema.memberLoginTokens.used, false),
        isNotNull(schema.memberLoginTokens.ownerUserId),
        gt(schema.memberLoginTokens.expires, sql`now()`),
      ),
    )
    .returning({ ownerUserId: schema.memberLoginTokens.ownerUserId });
  return rows[0]?.ownerUserId ?? null;
}

