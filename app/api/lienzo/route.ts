import { auth } from "@/auth";
import { lienzoApagado } from "@/lib/lienzo/host";
import { openCanvasDocument } from "@/lib/lienzo/open-document";
import { MAX_HTML_BYTES } from "@/lib/projects/limites-html";
import { accesoAlProyecto } from "@/lib/projects/acceso";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/lienzo — sube el documento que el taller va a enseñar y devuelve la
// URL desde la que el iframe lo carga, en `lienzo-<id>.<dominio de páginas>`.
//
// Es la mitad «servidor» de la acción `preview` de Claude Code: guarda cada
// documento en memoria y lo sirve por HTTP en otro origen. Ver
// docs/superpowers/specs/2026-09-15-un-solo-camino-de-renderizado-design.md.
//
// El `html` llega YA instrumentado por `derive()` (los scripts del editor). Aquí
// se le pasa `documentoDeVista` —logo, módulos, sello—, que no puede correr en
// el cliente porque es Rust. Los ajustes salen de la base, no del cliente. Lo
// hace `openCanvasDocument`, el mismo que abre la vista previa de la app del
// teléfono (`/api/movil/canvas`).
//
// Autorización: sesión + propiedad, el mismo par 401/404 que las demás rutas
// de proyecto.
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";

function json(cuerpo: unknown, status: number): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function POST(req: Request): Promise<Response> {
  if (lienzoApagado()) return json({ error: "apagado" }, 503);

  const session = await auth();
  if (!session?.user?.id) return json({ error: "sin_sesion" }, 401);

  const body = (await req.json().catch(() => null)) as
    | { projectId?: unknown; pagina?: unknown; html?: unknown }
    | null;
  if (!body || typeof body.projectId !== "string" || typeof body.html !== "string") {
    return json({ error: "cuerpo_invalido" }, 400);
  }
  if (Buffer.byteLength(body.html, "utf8") > MAX_HTML_BYTES) {
    return json({ error: "demasiado_grande" }, 413);
  }

  // El lienzo lo ven el dueño y sus miembros (lib/projects/acceso.ts).
  const acceso = await accesoAlProyecto(body.projectId, session.user.id);
  if (!acceso) return json({ error: "no_encontrado" }, 404);
  const abierto = await openCanvasDocument({
    projectId: body.projectId,
    ownerId: acceso.duenoId,
    personId: session.user.id,
    page: typeof body.pagina === "string" && body.pagina.length > 0 ? body.pagina : null,
    html: body.html,
    requestHost: req.headers.get("host"),
  });
  return abierto.ok ? json({ url: abierto.url }, 200) : json({ error: abierto.error }, abierto.status);
}
