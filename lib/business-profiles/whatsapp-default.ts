// One WhatsApp number for the whole product: the business profile («Mi
// negocio») is the default source; the module card's own field overrides it.
// Consumers: the settings PATCH route (module toggled on with no number) and
// the agent's activar_modulo (whatsapp + pedidos fallback chains).

import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getProfile, listProfiles } from "./store";

/** The project's effective profile WhatsApp number: linked profile first,
 *  else the user's default profile. Null when neither has one. Soft-fails —
 *  a profile lookup must never break a settings write. */
export async function projectWhatsappDefault(
  projectId: string,
  userId: string,
): Promise<string | null> {
  try {
    const rows = await db
      .select({ profileId: schema.projects.profileId })
      .from(schema.projects)
      .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)))
      .limit(1);
    const linkedId = rows[0]?.profileId ?? null;
    const profile = linkedId
      ? await getProfile(userId, linkedId)
      : ((await listProfiles(userId)).find((p) => p.isDefault) ?? null);
    const n = profile?.data?.contact?.whatsapp?.trim();
    return n || null;
  } catch {
    return null;
  }
}
