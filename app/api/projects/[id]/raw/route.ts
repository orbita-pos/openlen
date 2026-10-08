import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { bakeModulesForPreview } from "@/lib/publish/preview-bake";
import { embedSandboxHeaders, isFramedRequest } from "@/lib/publish/embed-sandbox";
import { entornoPublicoDeLaApp } from "@/lib/apps/entorno";
import { guardarDocumento } from "@/lib/lienzo/almacen";
import { documentoDeVista } from "@/lib/lienzo/documento";
import { lienzoApagado, urlDelDocumento } from "@/lib/lienzo/host";
import { exigirAcceso } from "@/lib/projects/acceso";

export const runtime = "nodejs";

// GET /api/projects/<id>/raw — auth-gated text/html of the project's current
// data.html. Used by the workspace Pages sidebar to embed live iframe
// thumbnails of the user's own projects without having to round-trip through
// the JSON GET + parse. Browser caches the response per-id so scrolling the
// project list doesn't refetch.
//
// `?bake=1` en pestaña propia es «abrir en pestaña» del taller, y NO se sirve
// aquí: se guarda en el lienzo y se redirige a `lienzo-<id>.<dominio de
// páginas>` (2026-10-04). Allí la página corre con SU origen —su JavaScript, su
// `localStorage`—, de otro sitio que openlen.com y sin la sesión del dueño. Lo
// que sí se sirve aquí (miniaturas, la reserva) va siempre con origen opaco
// (`lib/publish/embed-sandbox.ts`).
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return text("unauthorized", 401);

  const { id } = await ctx.params;
  const acceso = await exigirAcceso(id, session.user.id, "ver");
  if (acceso instanceof Response) return acceso;
  const duenoId = acceso.duenoId;
  if (!id) return text("missing id", 400);

  const rows = await db
    .select({
      data: schema.projects.data,
      title: schema.projects.title,
      subdomain: schema.projects.subdomain,
      logoUrl: schema.projects.logoUrl,
    })
    .from(schema.projects)
    .where(
      and(eq(schema.projects.id, id), eq(schema.projects.userId, duenoId)),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return text("not found", 404);

  const url = new URL(req.url);
  // ?bake=1 — the editor's "open in new tab" for unpublished drafts: the tab
  // shows what publish will produce. Thumbnail embeds skip it (no param) —
  // they don't need widgets.
  const wantBake = url.searchParams.get("bake") === "1";

  // Multi-page: ?page=<slug> serves that site page's document instead of
  // home — the editor's "open in new tab" for an unpublished subpage.
  const pageSlug = url.searchParams.get("page");
  const page = pageSlug ? row.data?.pages?.[pageSlug] : null;
  if (pageSlug && !page) return text("page not found", 404);
  const html = page ? page.html : (row.data?.html ?? "");
  const pagina = page ? pageSlug : null;

  // «ABRIR EN PESTAÑA» → AL LIENZO, en `.app`. El mismo documento que enseña el
  // lienzo remoto del taller (`documentoDeVista`: logo, módulos y sello, el
  // constructor de publicar en modo vista previa) y el mismo almacén, que lo
  // guarda 30 minutos desde la última lectura.
  if (wantBake && !isFramedRequest(req) && !lienzoApagado()) {
    const hostDeLaPeticion = req.headers.get("host");
    // Con la función pura antes de hornear: sin dominio de lienzo (o con un id
    // que no es un uuid) no se gasta nada y se cae a la reserva de abajo.
    if (urlDelDocumento({ projectId: id, docId: "comprobacion", pagina, hostDeLaPeticion }) !== null) {
      const app = row.data?.app ?? null;
      const entorno = app ? await entornoPublicoDeLaApp(id) : undefined;
      const vista = documentoDeVista(html, {
        projectId: id,
        title: row.title ?? null,
        sub: row.subdomain ?? null,
        pagina,
        settings: row.data?.settings,
        logoUrl: row.logoUrl ?? null,
        app,
      });
      const docId = guardarDocumento({
        html: vista,
        projectId: id,
        userId: duenoId,
        pagina,
        app,
        ...(entorno ? { entorno } : {}),
      });
      const destino = urlDelDocumento({ projectId: id, docId, pagina, hostDeLaPeticion });
      if (destino) {
        return new Response(null, {
          status: 303,
          headers: { location: destino, "cache-control": "no-store" },
        });
      }
    }
  }

  // LA RESERVA, y las miniaturas: servido aquí, SIEMPRE con origen opaco.
  const baked = wantBake
    ? await bakeModulesForPreview(html, {
        projectId: id,
        title: row.title ?? null,
        sub: row.subdomain ?? null,
        page: pagina,
        data: row.data,
        // Origen opaco siempre (ver la cabecera): nada de players de terceros,
        // que en él no montan y quedan en negro.
        sandboxed: true,
      }).catch(() => html)
    : html;

  return new Response(baked, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      // We want the latest edits to show; a stale list of project
      // thumbnails defeats the purpose. Browser may cache the HTTP
      // response for a few seconds inside the same tab, but no shared
      // / CDN caching.
      "cache-control": "private, no-cache, must-revalidate",
      "x-frame-options": "SAMEORIGIN",
      // Origen opaco, incrustado o en pestaña: el JavaScript del proyecto
      // nunca corre como openlen.com. Ver lib/publish/embed-sandbox.ts.
      ...embedSandboxHeaders(req),
    },
  });
}

function text(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain" },
  });
}
