// The project's effective business profile («Mi negocio»): linked profile
// first, else the user's default. One resolution for the whole product.
//
// Se llamaba `whatsapp-default.ts` y exportaba además el número suelto, porque
// nació sirviendo al módulo de WhatsApp. Ese módulo se retiró el 2026-08-26: el
// canal de contacto lo elige quien hace la página —WhatsApp, Telegram, correo,
// lo que sea— y no lo decide OpenLen. Lo que queda es el perfil entero.

import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { ensureDefaultProfile, getProfile, listProfiles, updateProfile } from "./store";
import type { BusinessProfileData } from "./types";
import { aprenderDelNegocio } from "./aprender";

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

/** Lo que puede salir mal. Los tres primeros los decide `aprenderDelNegocio`
 *  —el campo, el valor— y el cuarto es la base. Se enumeran a mano en vez de
 *  derivarlos: un tipo condicional sobre la unión se resolvía a `never` y
 *  dejaba el fallo sin forma, que es peor que repetir cuatro palabras. */
export type MotivoAprender =
  | "campo_desconocido"
  | "valor_vacio"
  | "valor_largo"
  | "no_guardado";

/**
 * ESCRIBE un dato aprendido en el perfil efectivo del proyecto.
 *
 * Resuelve por el MISMO camino que `projectBusinessProfile` —vinculado primero,
 * si no el predeterminado— porque escribir en otro perfil del que se lee es la
 * forma más silenciosa de perder un dato: el Agente confirma, el usuario lo da
 * por guardado, y la siguiente página lo sigue inventando.
 *
 * SIN PERFIL, SE CREA. El primer dato que el usuario suelta en una conversación
 * es también la primera vez que hace falta un sitio donde ponerlo; obligarle a
 * abrir «Mi negocio» antes es justo el formulario que esto viene a quitar.
 *
 * Devuelve lo que HABÍA en ese campo, para que quien llama pueda decirlo. Fuerza
 * el fallo hacia arriba: guardar es la mitad del trabajo del Agente, y un fallo
 * tragado aquí se convierte en una confirmación falsa.
 */
export async function aprenderEnPerfilDelProyecto(
  projectId: string,
  userId: string,
  campo: string,
  valor: string,
): Promise<
  | { ok: true; anterior: string | null; cambio: boolean }
  | { ok: false; motivo: MotivoAprender }
> {
  const rows = await db
    .select({ profileId: schema.projects.profileId })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)))
    .limit(1);
  const linkedId = rows[0]?.profileId ?? null;

  const perfil = linkedId
    ? await getProfile(userId, linkedId)
    : ((await listProfiles(userId)).find((p) => p.isDefault) ?? null);
  const destino = perfil ?? (await ensureDefaultProfile(userId));

  const r = aprenderDelNegocio(destino.data, campo, valor);
  if (!r.ok) return r;
  // Sin cambio no se escribe: una escritura que no cambia nada mueve el
  // `updatedAt` y hace que el perfil parezca tocado cuando no lo está.
  if (!r.cambio) return { ok: true, anterior: r.anterior, cambio: false };

  const guardado = await updateProfile(userId, destino.id, { data: r.data });
  if (!guardado) return { ok: false, motivo: "no_guardado" };
  return { ok: true, anterior: r.anterior, cambio: true };
}
