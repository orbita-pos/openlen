// Las llaves del teléfono, en la base. Ver lib/movil/secreto.ts para el porqué
// de la huella.
import { and, eq, gt, isNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { huella, secretoNuevo, VIDA_DEL_CODIGO_MS } from "./secreto";

const c = schema.movilCodigos;
const l = schema.movilLlaves;

export async function crearCodigo(userId: string, estado: string): Promise<string> {
  const codigo = secretoNuevo();
  await db.insert(c).values({ huella: huella(codigo), userId, estado });
  return codigo;
}

export async function canjearCodigo(
  codigo: string,
  estado: string,
  nombre: string | null,
  ahora: Date = new Date(),
): Promise<{ llave: string; userId: string } | null> {
  const desde = new Date(ahora.getTime() - VIDA_DEL_CODIGO_MS);
  // UN solo UPDATE condicionado: dos canjes a la vez no pueden ganar los dos.
  const usado = await db
    .update(c)
    .set({ usadoEn: ahora })
    .where(and(eq(c.huella, huella(codigo)), eq(c.estado, estado), isNull(c.usadoEn), gt(c.creadoEn, desde)))
    .returning({ userId: c.userId });
  const userId = usado[0]?.userId;
  if (!userId) return null;
  const llave = secretoNuevo();
  await db.insert(l).values({ huella: huella(llave), userId, nombre: nombre ? nombre.slice(0, 80) : null });
  return { llave, userId };
}

/** De quién es esta llave. Apunta el último uso (una escritura por petición:
 *  si algún día pesa, se espacia). */
export async function usuarioDeLaLlave(llave: string, ahora: Date = new Date()): Promise<string | null> {
  const filas = await db.update(l).set({ ultimoUso: ahora }).where(eq(l.huella, huella(llave))).returning({ userId: l.userId });
  return filas[0]?.userId ?? null;
}

export async function borrarLlave(llave: string): Promise<void> {
  await db.delete(l).where(eq(l.huella, huella(llave)));
}

/** El correo del usuario. Con la llave del teléfono no hay sesión que lo
 *  traiga, y Len lo usa (`ownerEmail`) y el chat del dueño también. */
export async function correoDelUsuario(userId: string): Promise<string | null> {
  const u = await db.select({ email: schema.users.email }).from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  return u[0]?.email ?? null;
}
