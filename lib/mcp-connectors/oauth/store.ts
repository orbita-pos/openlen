// WHERE A PERSON'S OAUTH CONNECTION TO A CONNECTOR AND ITS PENDING SIGN-IN LIVE (spec local
// 2026-11-17-oauth-de-conectores-mcp, §5.3, §5.4). Two tables, encrypted at rest with the integrations' cipher
// (lib/integrations/crypto.ts), like `personCredentials`: nothing here reaches the model, a log or another person.
//
// - `personMcpOAuth`: one row per person and server — the OAuth client the person signed in with and its tokens. The row
//   is bound to the server's URL and to the authorization server's issuer: if either changes, it is not used (and its old
//   tokens are dropped the moment a client is saved for the new binding).
// - `personMcpOAuthFlows`: a sign-in in progress, keyed by the `state` the provider sends back. One use, ten minutes,
//   tied to the person, the server, the entry's fingerprint and the issuer; taken with a compare-and-swap so a replayed
//   or duplicated callback never wins twice.
import "server-only";
import { randomBytes } from "node:crypto";
import type { StoredOAuthClientInformation, StoredOAuthTokens } from "@modelcontextprotocol/client";
import { and, eq, isNull, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { decryptToken, encryptToken } from "@/lib/integrations/crypto";

const o = schema.personMcpOAuth;
const f = schema.personMcpOAuthFlows;

/** A sign-in not finished in ten minutes is dead: the person taps «Conectar» again. */
export const FLOW_TTL_MS = 10 * 60 * 1000;

export interface OAuthConnection {
  readonly serverUrl: string;
  readonly issuer: string;
  readonly clientInfo: StoredOAuthClientInformation;
  /** Null until the person finishes signing in, and after the tokens were dropped. */
  readonly tokens: StoredOAuthTokens | null;
}

export interface OAuthFlow {
  readonly personId: string;
  readonly serverName: string;
  readonly fingerprint: string;
  readonly issuer: string;
  readonly codeVerifier: string;
  readonly scope: string | null;
}

/** The JSON inside a ciphertext; a value that doesn't decrypt or isn't an object counts as missing (NEXTAUTH_SECRET
 *  rotated, a broken row): the person signs in again. */
function openJson<T extends object>(stored: string | null): T | null {
  if (stored === null) return null;
  try {
    const v: unknown = JSON.parse(decryptToken(stored));
    return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as T) : null;
  } catch {
    return null;
  }
}

function readConnection(row: { serverUrl: string; issuer: string; clientInfo: string; tokens: string | null }): OAuthConnection | null {
  const clientInfo = openJson<StoredOAuthClientInformation>(row.clientInfo);
  // Without its client the tokens can't be refreshed or revoked: the whole row is as good as missing.
  if (!clientInfo) return null;
  return { serverUrl: row.serverUrl, issuer: row.issuer, clientInfo, tokens: openJson<StoredOAuthTokens>(row.tokens) };
}

/** The person's connection to a server, or null if there is none, it was made for another URL, or — when `issuer` is
 *  given — for another authorization server. URL and issuer are compared as written: no normalization, so a doubt fails
 *  closed. With `issuer` null the stored one is accepted and reported (the caller doesn't know it yet). */
export async function loadConnection(personId: string, serverName: string, serverUrl: string, issuer: string | null): Promise<OAuthConnection | null> {
  const rows = await db
    .select({ serverUrl: o.serverUrl, issuer: o.issuer, clientInfo: o.clientInfo, tokens: o.tokens })
    .from(o)
    .where(and(eq(o.personId, personId), eq(o.serverName, serverName)))
    .limit(1);
  const row = rows[0];
  if (!row || row.serverUrl !== serverUrl) return null;
  if (issuer !== null && row.issuer !== issuer) return null;
  return readConnection(row);
}

/** Saves the OAuth client for this server, URL and issuer. If the row was bound to another URL or issuer, its tokens go:
 *  they were issued to that other server and must never be sent to this one. The same binding keeps them. */
export async function saveClientInfo(personId: string, serverName: string, serverUrl: string, issuer: string, info: StoredOAuthClientInformation): Promise<void> {
  const clientInfo = encryptToken(JSON.stringify(info));
  await db
    .insert(o)
    .values({ personId, serverName, serverUrl, issuer, clientInfo })
    .onConflictDoUpdate({
      target: [o.personId, o.serverName],
      set: {
        serverUrl,
        issuer,
        clientInfo,
        tokens: sql`CASE WHEN ${o.serverUrl} = ${serverUrl} AND ${o.issuer} = ${issuer} THEN ${o.tokens} ELSE NULL END`,
        updatedAt: new Date(),
      },
    });
}

/** Saves the tokens into the connection made for exactly this URL and issuer. Throws when there is none (the person
 *  removed the server, or it moved, while they were signing in): tokens are never saved against a different binding. */
export async function saveTokens(personId: string, serverName: string, serverUrl: string, issuer: string, tokens: StoredOAuthTokens): Promise<void> {
  const updated = await db
    .update(o)
    .set({ tokens: encryptToken(JSON.stringify(tokens)), updatedAt: new Date() })
    .where(and(eq(o.personId, personId), eq(o.serverName, serverName), eq(o.serverUrl, serverUrl), eq(o.issuer, issuer)))
    .returning({ serverName: o.serverName });
  if (updated.length === 0) throw new Error(`no OAuth connection for "${serverName}" at this URL and issuer to save the tokens into`);
}

/** Forgets the tokens and keeps the client: the next sign-in reuses it. */
export async function dropTokens(personId: string, serverName: string): Promise<void> {
  await db.update(o).set({ tokens: null, updatedAt: new Date() }).where(and(eq(o.personId, personId), eq(o.serverName, serverName)));
}

/** Deletes the connection and hands back what it held, so the caller can revoke the token with the provider. Null when
 *  there was none, or when its client no longer decrypts (nothing to revoke with; the row is deleted anyway). */
export async function dropConnection(personId: string, serverName: string): Promise<OAuthConnection | null> {
  const rows = await db
    .delete(o)
    .where(and(eq(o.personId, personId), eq(o.serverName, serverName)))
    .returning({ serverUrl: o.serverUrl, issuer: o.issuer, clientInfo: o.clientInfo, tokens: o.tokens });
  return rows[0] ? readConnection(rows[0]) : null;
}

/** Server names of the person that have an active OAuth token stored (for the «Desconectar» button on the Herramientas page). */
export async function listConnectedServers(personId: string): Promise<ReadonlySet<string>> {
  const rows = await db.select({ serverName: o.serverName, serverUrl: o.serverUrl, issuer: o.issuer, clientInfo: o.clientInfo, tokens: o.tokens }).from(o).where(eq(o.personId, personId));
  // Connected = a connection that reads (its client decrypts) and holds tokens that read; an unreadable row is none.
  return new Set(
    rows
      .filter((r) => {
        const conn = readConnection(r);
        return conn !== null && conn.tokens !== null;
      })
      .map((r) => r.serverName),
  );
}

/** Starts a sign-in and returns its `state`: 32 random bytes, base64url, good once and for ten minutes from `now`. */
export async function createFlow(flow: {
  personId: string;
  serverName: string;
  fingerprint: string;
  issuer: string;
  codeVerifier: string;
  scope: string | null;
  now: Date;
}): Promise<string> {
  const state = randomBytes(32).toString("base64url");
  await db.insert(f).values({
    state,
    personId: flow.personId,
    serverName: flow.serverName,
    fingerprint: flow.fingerprint,
    issuer: flow.issuer,
    codeVerifier: encryptToken(flow.codeVerifier),
    scope: flow.scope,
    expiresAt: new Date(flow.now.getTime() + FLOW_TTL_MS),
  });
  return state;
}

/** Takes the flow of a `state`, once. One compare-and-swap `UPDATE … WHERE usedAt IS NULL RETURNING` spends it, so of two
 *  callbacks at the same time exactly one gets the flow and the other hears "used". An expired flow is spent by that same
 *  statement — it cannot be retried — and answers "expired" this once (then "used"). A verifier that no longer decrypts
 *  is no flow: "unknown". The caller still checks that the flow is its person's, server's, fingerprint's. */
export async function takeFlow(state: string, now: Date): Promise<OAuthFlow | "expired" | "used" | "unknown"> {
  const taken = await db.update(f).set({ usedAt: now }).where(and(eq(f.state, state), isNull(f.usedAt))).returning();
  const row = taken[0];
  if (row) {
    if (row.expiresAt.getTime() <= now.getTime()) return "expired";
    let codeVerifier: string;
    try {
      codeVerifier = decryptToken(row.codeVerifier);
    } catch {
      return "unknown";
    }
    return { personId: row.personId, serverName: row.serverName, fingerprint: row.fingerprint, issuer: row.issuer, codeVerifier, scope: row.scope };
  }
  // Nothing to spend: either it was spent already or it never existed (the update's only conditions are those two).
  const existing = await db.select({ state: f.state }).from(f).where(eq(f.state, state)).limit(1);
  return existing.length > 0 ? "used" : "unknown";
}
