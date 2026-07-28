// The project's effective business profile («Mi negocio»): linked profile
// first, else the user's default. One resolution for the whole product —
// consumers: the settings PATCH route + agent activar_modulo (WhatsApp number
// fallback) and the agent's ESTADO `negocio` block (full profile).

import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getProfile, listProfiles } from "./store";
import type { BusinessProfileData } from "./types";

/** The project's effective profile data: linked profile first, else the
 *  user's default profile. Null when neither exists. Soft-fails — a profile
 *  lookup must never break the caller. */
export async function projectBusinessProfile(
  projectId: string,
  userId: string,
): Promise<BusinessProfileData | null> {
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
    return profile?.data ?? null;
  } catch {
    return null;
  }
}

/** The project's effective profile WhatsApp number — same resolution, one
 *  field. Kept as its own export: the settings PATCH consumer only needs the
 *  number and predates the full-profile resolver. */
export async function projectWhatsappDefault(
  projectId: string,
  userId: string,
): Promise<string | null> {
  const data = await projectBusinessProfile(projectId, userId);
  const n = data?.contact?.whatsapp?.trim();
  return n || null;
}
