// /api/projects/[id]/miembros — LOS MIEMBROS DEL PROYECTO (compartir el
// proyecto; quién entra a qué: lib/projects/acceso.ts).
//
// GET    — quién está (dueño y miembros). El dueño ve además las invitaciones
//          pendientes, el gasto de cada uno con Len este mes y el tope.
// POST   — { email, rol }: invitar (sólo el dueño). Manda el correo con el enlace.
// PATCH  — { userId, rol } cambia el rol; { tope: number | null } pone el tope
//          mensual de créditos de los miembros (sólo el dueño).
// DELETE — ?userId= quita a un miembro (el dueño, o el propio miembro: irse);
//          ?email= cancela una invitación (sólo el dueño).
import { z } from "zod";

import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { accesoAlProyecto, puede, ROLES_DE_MIEMBRO, type AccesoAlProyecto } from "@/lib/projects/acceso";
import {
  cambiarRol,
  cancelarInvitacion,
  gastoDeMiembrosDelMes,
  invitar,
  listarMiembros,
  ponerTope,
  quitarMiembro,
  topeDelProyecto,
} from "@/lib/projects/miembros";
import { sendProjectInviteEmail } from "@/lib/email";
import { lenEmailAddress } from "@/lib/len-email/address";
import { avatarOf } from "@/lib/profile/avatar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

type Ctx = { params: Promise<{ id: string }> };

type Quien =
  | { readonly ok: false; readonly respuesta: Response }
  | { readonly ok: true; readonly id: string; readonly userId: string; readonly acceso: AccesoAlProyecto; readonly nombre: string | null };

async function quien(ctx: Ctx): Promise<Quien> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, respuesta: json({ error: "unauthorized" }, 401) };
  const { id } = await ctx.params;
  const acceso = await accesoAlProyecto(id, userId);
  if (!acceso) return { ok: false, respuesta: json({ error: "not_found" }, 404) };
  return { ok: true, id, userId, acceso, nombre: session.user?.name ?? session.user?.email ?? null };
}

const soloDueno = () => json({ error: "solo_dueno", message: "Only the project owner can manage members." }, 403);

export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  const q = await quien(ctx);
  if (!q.ok) return q.respuesta;
  const [dueno] = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
      avatarUrl: schema.users.avatarUrl,
      image: schema.users.image,
      handle: schema.users.handle,
    })
    .from(schema.users)
    .where(eq(schema.users.id, q.acceso.duenoId))
    .limit(1);
  const { miembros, invitaciones } = await listarMiembros(q.id);
  const esDueno = q.acceso.rol === "dueno";
  return json({
    rol: q.acceso.rol,
    yo: q.userId,
    dueno: dueno ? { userId: dueno.id, email: dueno.email, name: dueno.name, avatar: avatarOf(dueno), handle: dueno.handle } : null,
    // A un miembro no se le enseña lo que gasta cada uno: eso es del dueño.
    miembros: miembros.map((m) =>
      esDueno ? m : { userId: m.userId, email: m.email, name: m.name, avatar: m.avatar, handle: m.handle, rol: m.rol, desde: m.desde },
    ),
    // LEN POR CORREO: la dirección del proyecto, sólo a quien puede pedirle a Len.
    lenEmail: puede(q.acceso.rol, "editar") ? lenEmailAddress(q.id) : null,
    ...(esDueno
      ? { invitaciones, tope: await topeDelProyecto(q.id), gastoDelMes: await gastoDeMiembrosDelMes(q.id) }
      : {}),
  });
}

const Invitar = z.object({
  email: z.string().trim().email().max(320),
  rol: z.enum(ROLES_DE_MIEMBRO as [string, ...string[]]),
  /** El idioma de la interfaz de quien invita: el del correo. */
  idioma: z.string().max(8).optional(),
});

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const q = await quien(ctx);
  if (!q.ok) return q.respuesta;
  if (q.acceso.rol !== "dueno") return soloDueno();
  const body = Invitar.safeParse(await req.json().catch(() => null));
  if (!body.success) return json({ error: "invalid_body", message: "email and rol (editor | lector) are required" }, 400);
  const rol = body.data.rol as "editor" | "lector";
  const r = await invitar(q.id, q.userId, body.data.email, rol);
  if (!r.ok) return json({ error: r.motivo }, r.motivo === "limite" ? 402 : 409);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://openlen.com";
  const [p] = await db.select({ title: schema.projects.title }).from(schema.projects).where(eq(schema.projects.id, q.id)).limit(1);
  void sendProjectInviteEmail({
    to: body.data.email.toLowerCase(),
    projectTitle: p?.title ?? "",
    inviterName: q.nombre,
    rol,
    idioma: body.data.idioma ?? null,
    acceptUrl: `${siteUrl}/api/miembros/aceptar?token=${encodeURIComponent(r.token)}`,
  }).catch((err) => console.error("[miembros] el correo de invitación falló", err));
  return json({ ok: true, invitado: body.data.email.toLowerCase(), rol });
}

const Cambiar = z.union([
  z.object({ userId: z.string().min(1), rol: z.enum(ROLES_DE_MIEMBRO as [string, ...string[]]) }),
  z.object({ tope: z.number().int().min(0).max(10_000_000).nullable() }),
]);

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  const q = await quien(ctx);
  if (!q.ok) return q.respuesta;
  if (q.acceso.rol !== "dueno") return soloDueno();
  const body = Cambiar.safeParse(await req.json().catch(() => null));
  if (!body.success) return json({ error: "invalid_body" }, 400);
  if ("tope" in body.data) {
    await ponerTope(q.id, body.data.tope);
    return json({ ok: true, tope: body.data.tope });
  }
  const ok = await cambiarRol(q.id, body.data.userId, body.data.rol as "editor" | "lector");
  return ok ? json({ ok: true }) : json({ error: "not_found" }, 404);
}

export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  const q = await quien(ctx);
  if (!q.ok) return q.respuesta;
  const url = new URL(req.url);
  const email = url.searchParams.get("email");
  const userId = url.searchParams.get("userId");
  if (email) {
    if (q.acceso.rol !== "dueno") return soloDueno();
    await cancelarInvitacion(q.id, email);
    return json({ ok: true });
  }
  if (!userId) return json({ error: "invalid_body", message: "userId or email is required" }, 400);
  // Un miembro puede irse; quitar a OTRO es del dueño.
  if (q.acceso.rol !== "dueno" && userId !== q.userId) return soloDueno();
  const ok = await quitarMiembro(q.id, userId);
  return ok ? json({ ok: true }) : json({ error: "not_found" }, 404);
}
