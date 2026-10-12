// REVOCAR UN TOKEN (RFC 7009): de acceso o de refresco, cae la conexión entera
// (su familia). Un token personal se revoca solo. Nunca dice si existía.
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { isTokenShaped, tokenHash } from "../tokens";
import { REFRESH_PREFIX, revokeFamily } from "./issue";

export async function revokeByToken(token: string): Promise<void> {
  if (!token) return;
  const hash = tokenHash(token);
  if (token.startsWith(REFRESH_PREFIX)) {
    const [r] = await db
      .select({ familyId: schema.mcpRefreshTokens.familyId })
      .from(schema.mcpRefreshTokens)
      .where(eq(schema.mcpRefreshTokens.hash, hash))
      .limit(1);
    if (r) await revokeFamily(r.familyId);
    return;
  }
  if (!isTokenShaped(token)) return;
  const [t] = await db
    .select({ id: schema.mcpTokens.id, familyId: schema.mcpTokens.familyId })
    .from(schema.mcpTokens)
    .where(eq(schema.mcpTokens.hash, hash))
    .limit(1);
  if (!t) return;
  if (t.familyId) await revokeFamily(t.familyId);
  else await db.update(schema.mcpTokens).set({ revokedAt: new Date() }).where(eq(schema.mcpTokens.id, t.id));
}
