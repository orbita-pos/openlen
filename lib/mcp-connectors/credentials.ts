// A PERSON'S KEYS FOR THEIR CONNECTORS (spec local 2026-11-06-conectores-mcp, §5.2): DeepSeek's credentials provider —
// configuration names a key, the value lives apart — in Postgres, encrypted at rest with the integrations' cipher
// (lib/integrations/crypto.ts). Only OpenLen's own forms write them; Len has no tool to read or write one. A management
// surface learns whether a key is set and when it changed, never its value.
import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { decryptToken, encryptToken } from "@/lib/integrations/crypto";

import { CREDENTIAL_NAME } from "./templates";

const t = schema.personCredentials;

export async function credentialNames(personId: string): Promise<{ name: string; updatedAt: Date }[]> {
  return db.select({ name: t.name, updatedAt: t.updatedAt }).from(t).where(eq(t.personId, personId)).orderBy(asc(t.name));
}

export async function setCredential(personId: string, name: string, value: string): Promise<void> {
  if (!CREDENTIAL_NAME.test(name)) throw new Error(`a credential name is 1 to 64 of A-Z, 0-9 and _: "${name}"`);
  const stored = encryptToken(value);
  await db
    .insert(t)
    .values({ personId, name, value: stored })
    .onConflictDoUpdate({ target: [t.personId, t.name], set: { value: stored, updatedAt: new Date() } });
}

export async function deleteCredential(personId: string, name: string): Promise<void> {
  await db.delete(t).where(and(eq(t.personId, personId), eq(t.name, name)));
}

/** The values of the named keys that are set and decrypt; a row that doesn't decrypt counts as missing. */
export async function resolveCredentials(personId: string, names: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (names.length === 0) return out;
  const rows = await db.select({ name: t.name, value: t.value }).from(t).where(and(eq(t.personId, personId), inArray(t.name, [...names])));
  for (const r of rows) {
    try {
      out.set(r.name, decryptToken(r.value));
    } catch {
      // A key that no longer decrypts (NEXTAUTH_SECRET rotated, a broken row) is a missing key: the person sets it again.
    }
  }
  return out;
}
