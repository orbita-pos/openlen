import { json, loadChatSite, requireChatSession } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ sub: string }> }): Promise<Response> {
  const { sub } = await params;
  const site = await loadChatSite(sub);
  if (!site || !site.chatEnabled) return json({ error: "not_found" }, 404);

  const session = await requireChatSession(req, site.projectId);
  if (session) {
    const { id, username, displayName } = session.user;
    return json({ user: { id, username, displayName } }, 200);
  }

  // AQUÍ ESTABA EL PUENTE A MIEMBROS. Un miembro ya logueado en el sitio se
  // auto-identificaba en el chat leyendo la cookie `ol_member`. El módulo
  // Miembros se retiró el 2026-08-21 y con él esa cookie: era la ÚLTIMA lectura
  // que quedaba en todo el repo.
  //
  // El chat no pierde nada: tiene identidad propia (`chatUsers`, con usuario y
  // contraseña) y sus rutas de registro, login e invitado. El puente era un
  // atajo, no un requisito.

  return json({ user: null }, 200);
}
