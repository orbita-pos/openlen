import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { guardarDocumento } from "@/lib/lienzo/almacen";
import { documentoDeVista } from "@/lib/lienzo/documento";
import { lienzoApagado, urlDelDocumento } from "@/lib/lienzo/host";
import { MAX_HTML_BYTES } from "@/lib/projects/limites-html";
import { validatePageSlug } from "@/lib/projects/site-pages";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/lienzo — sube el documento que el taller va a enseñar y devuelve la
// URL desde la que el iframe lo carga, en `lienzo-<id>.<dominio de páginas>`.
//
// Es la mitad «servidor» de la acción `preview` de Claude Code: su
// `…` guarda cada documento en un Map y lo sirve por HTTP en otro origen. Ver
// docs/superpowers/specs/2026-09-15-un-solo-camino-de-renderizado-design.md.
//
// El `html` llega YA instrumentado por `derive()` (los scripts del editor). Aquí
// se le pasa `documentoDeVista` —logo, módulos, sello—, que no puede correr en
// el cliente porque es Rust. Los ajustes salen de la base, no del cliente.
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

  const [fila] = await db
    .select({
      data: schema.projects.data,
      title: schema.projects.title,
      subdomain: schema.projects.subdomain,
      logoUrl: schema.projects.logoUrl,
    })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, body.projectId), eq(schema.projects.userId, session.user.id)))
    .limit(1);
  if (!fila) return json({ error: "no_encontrado" }, 404);

  let pagina: string | null = null;
  if (typeof body.pagina === "string" && body.pagina.length > 0) {
    const check = validatePageSlug(body.pagina);
    if (!check.ok || !fila.data?.pages?.[check.slug]) return json({ error: "no_encontrado" }, 404);
    pagina = check.slug;
  }

  // Sin dominio donde servirlo no se hornea ni se guarda nada: se dice. La URL
  // se construye con el id REAL, así que la comprobación va con la función
  // pura antes de gastar trabajo, y el resultado final se vuelve a comprobar.
  const hostDeLaPeticion = req.headers.get("host");
  const construir = (docId: string) =>
    urlDelDocumento({ projectId: body.projectId as string, docId, hostDeLaPeticion });
  if (construir("comprobacion") === null) return json({ error: "sin_host" }, 503);

  const html = documentoDeVista(body.html, {
    projectId: body.projectId,
    title: fila.title ?? null,
    sub: fila.subdomain ?? null,
    pagina,
    settings: fila.data?.settings,
    logoUrl: fila.logoUrl ?? null,
  });
  const docId = guardarDocumento({ html, projectId: body.projectId, userId: session.user.id, pagina });
  const url = construir(docId);
  return url === null ? json({ error: "sin_host" }, 503) : json({ url }, 200);
}
