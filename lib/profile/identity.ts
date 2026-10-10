// LA FOTO Y EL NOMBRE DE UNA PERSONA, en la base: lo que lee la sesión
// (`refreshTokenIdentity`) y lo que escribe `/api/me/avatar`. Sin
// `server-only`: lo importa auth.ts, igual que `lib/db`.
import { eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";

import { avatarOf } from "./avatar";
import type { TokenIdentity } from "./session";

export async function sessionIdentity(userId: string): Promise<TokenIdentity | null> {
  const [row] = await db
    .select({ name: schema.users.name, avatarUrl: schema.users.avatarUrl, image: schema.users.image })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  return row ? { name: row.name, picture: avatarOf(row) } : null;
}

/** Pone (o quita, con null) la foto subida. Devuelve la de antes, para borrarla
 *  del almacén si era nuestra, y la de Google, para decir qué se pinta ahora. */
export async function setAvatarUrl(userId: string, url: string | null): Promise<{ previous: string | null; image: string | null }> {
  const [row] = await db
    .select({ avatarUrl: schema.users.avatarUrl, image: schema.users.image })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  await db.update(schema.users).set({ avatarUrl: url }).where(eq(schema.users.id, userId));
  return { previous: row?.avatarUrl ?? null, image: row?.image ?? null };
}
