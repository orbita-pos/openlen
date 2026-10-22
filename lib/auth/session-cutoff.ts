// A password reset closes the sessions already open (2026-10-21).
//
// Sessions are JWTs (auth.config.ts, 30 days) that live in the browser: the server can't delete one. So
// each carries when it signed in (`authAt`, stamped by auth.config.ts) and the server compares it with
// the account's `passwordChangedAt` (set by app/api/auth/reset): a session from before the change gets no
// token, which Auth.js answers with no session and a cleared cookie. A session minted before `authAt`
// existed counts as signed in at 0, so it closes too once the password changes.
//
// One database read per account and minute (`forget` re-reads at once: the reset calls it). If the
// database can't answer, the session stands: signing in must not depend on this column existing.

type Token = { readonly sub?: string | null; readonly authAt?: unknown };
type Read = (userId: string) => Promise<Date | null>;

const EVERY_MS = 60_000;

/** When the token signed in, in ms since the epoch; 0 when it doesn't say. */
export function signedInAt(token: Token): number {
  return typeof token.authAt === "number" && Number.isFinite(token.authAt) ? token.authAt : 0;
}

export function sessionCutoff(read: Read, o: { readonly now?: () => number } = {}) {
  const now = o.now ?? Date.now;
  const known = new Map<string, { readonly changedAt: Date | null; readonly at: number }>();
  return {
    async stillValid(token: Token): Promise<boolean> {
      const userId = token.sub;
      if (!userId) return true;
      let entry = known.get(userId);
      if (!entry || now() - entry.at > EVERY_MS) {
        try {
          entry = { changedAt: await read(userId), at: now() };
        } catch {
          return true;
        }
        known.set(userId, entry);
      }
      return entry.changedAt === null || signedInAt(token) >= entry.changedAt.getTime();
    },
    forget(userId: string): void {
      known.delete(userId);
    },
  };
}

async function readPasswordChangedAt(userId: string): Promise<Date | null> {
  const [{ db, schema }, { eq }] = await Promise.all([import("@/lib/db"), import("drizzle-orm")]);
  const [row] = await db.select({ at: schema.users.passwordChangedAt }).from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  return row?.at ?? null;
}

/** The server's one: auth.ts asks it on every session read, the reset route forgets the account. */
export const passwordCutoff = sessionCutoff(readPasswordChangedAt);
