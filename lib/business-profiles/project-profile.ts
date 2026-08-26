// The project's effective business profile («Mi negocio»): linked profile
// first, else the user's default. One resolution for the whole product.
//
// Se llamaba `whatsapp-default.ts` y exportaba además el número suelto, porque
// nació sirviendo al módulo de WhatsApp. Ese módulo se retiró el 2026-08-26: el
// canal de contacto lo elige quien hace la página —WhatsApp, Telegram, correo,
// lo que sea— y no lo decide OpenLen. Lo que queda es el perfil entero.

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
