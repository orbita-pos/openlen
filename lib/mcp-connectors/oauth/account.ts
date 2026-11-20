// THE OPENLEN ACCOUNT A PHONE SIGN-IN WOULD GO TO (spec local 2026-11-17-oauth-de-conectores-mcp, §10.1; final review F5
// and R1). The way-back page of a phone sign-in asks a browser with no session «connect to the account <email>?», so what
// it names must be worth trusting: OpenLen accounts work before their email is verified (lib/auth/verify-email.ts), which
// means anybody can register somebody else's address, and a page that named it would ask the owner of that address to
// connect to an account that isn't theirs. So the page is offered only for an account whose email was verified
// (`users.emailVerified`: set by the verification link, by Google's own proof and by the takeover that gives an unverified
// sign-up to the address's owner).
import "server-only";
import { eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";

export interface OpenLenAccount {
  readonly email: string;
  readonly emailVerified: boolean;
}

/** The person's email and whether it was ever verified, or null when there is no such account. */
export async function accountOf(personId: string): Promise<OpenLenAccount | null> {
  const [row] = await db
    .select({ email: schema.users.email, emailVerified: schema.users.emailVerified })
    .from(schema.users)
    .where(eq(schema.users.id, personId))
    .limit(1);
  return row ? { email: row.email, emailVerified: row.emailVerified !== null } : null;
}
