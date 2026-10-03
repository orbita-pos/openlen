// La sesión de la petición, resuelta contra la base. La decisión la toma
// `actorFromSession` (puro, en actor.ts); esto sólo le busca los datos.

import "server-only";
import { eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { getSubdomainOwner } from "@/lib/projects";
import { actorFromSession, type SignedInActor } from "./actor";
import type { AccountsDeclaration } from "./declaration";
import { readSessionCookie } from "./session";
import { findSession, getAccount, type PageAccount } from "./store";

export interface AccountsSite {
  readonly sub: string;
  readonly projectId: string;
  readonly ownerUserId: string;
  /** La que rige: la del HTML PUBLICADO (`projects.data.accounts`). */
  readonly accounts: AccountsDeclaration | null;
}

export async function loadAccountsSite(sub: string): Promise<AccountsSite | null> {
  const owner = await getSubdomainOwner(sub);
  if (!owner) return null;
  return { sub, projectId: owner.projectId, ownerUserId: owner.userId, accounts: await publishedAccounts(owner.projectId) };
}

export async function publishedAccounts(projectId: string): Promise<AccountsDeclaration | null> {
  const [row] = await db
    .select({ data: schema.projects.data })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .limit(1);
  return row?.data?.accounts ?? null;
}

export interface SignedIn {
  readonly actor: SignedInActor;
  /** La cuenta, si es un miembro. `null` si es el dueño. */
  readonly account: PageAccount | null;
  /** El token de la cookie, para cerrar ESTA sesión. */
  readonly token: string;
}

export async function resolveSignedIn(
  headers: { get(name: string): string | null },
  site: Pick<AccountsSite, "projectId" | "ownerUserId" | "accounts">,
): Promise<SignedIn | null> {
  if (!site.accounts) return null;
  const token = readSessionCookie(headers);
  if (!token) return null;
  const session = await findSession(site.projectId, token);
  if (!session) return null;
  const account = session.memberId ? await getAccount(site.projectId, session.memberId) : null;
  const actor = actorFromSession({ accounts: site.accounts, session, projectOwnerId: site.ownerUserId, account });
  return actor ? { actor, account, token } : null;
}
