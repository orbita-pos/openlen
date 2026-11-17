import { usuarioDeLaPeticion } from "@/lib/movil/quien";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { exigirAcceso } from "@/lib/projects/acceso";
import { getProject } from "@/lib/projects";
import { getVersionHtml, listVersions } from "@/lib/projects/versions";
import { cambiosDe } from "@/lib/projects/deshacer-turno";
import { paginaDeRuta } from "@/lib/agent/ficheros/sitio";
import { bakeTailwind } from "@/lib/publish/bake-tailwind";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

// Dos documentos reales del mismo ámbito. Nunca se publica ni se modifica una
// versión para compararla. El cliente los muestra en marcos de origen opaco.
export const GET = paraLaApp(async (req: Request) => {
  const userId = await usuarioDeLaPeticion(req);
  if (!userId) return json({ error: "unauthorized" }, 401);
  const q = new URL(req.url).searchParams;
  const projectId = q.get("project")?.trim();
  const page = q.get("page") || null;
  if (!projectId) return json({ error: "missing_project" }, 400);
  const acceso = await exigirAcceso(projectId, userId, "ver");
  if (acceso instanceof Response) return acceso;
  const p = await getProject(projectId, acceso.duenoId);
  if (!p) return json({ error: "not_found" }, 404);
  // A Len card's «Antes / Ahora» (spec local 2026-11-16-movil-es-tu-asistente, §5.4): what THAT turn changed, kept
  // with it for its undo — never the page's latest change, which may be another turn's.
  const fila = q.get("fila")?.trim();
  if (fila) return json({ comparacion: await turnComparison(projectId, fila, p.title) });
  const actual = page ? p.data?.pages?.[page]?.html : p.data?.html;
  if (!actual || actual.length > 6_000_000) return json({ comparacion: null });
  const versiones = await listVersions({ projectId, userId: acceso.duenoId });
  // Las versiones se guardan antes de editar; algunas coinciden con el
  // documento actual tras deshacer o publicar. No presentar eso como cambio.
  for (const version of versiones.filter((v) => v.page === page).slice(0, 8)) {
    const antes = await getVersionHtml({ projectId, userId: acceso.duenoId, versionId: version.id });
    if (!antes || antes === actual || antes.length > 6_000_000) continue;
    // El sandbox no ejecuta el CDN de Tailwind: compilar sus clases conserva
    // el aspecto del documento sin habilitar scripts del usuario.
    const [previa, vigente] = await Promise.all([bakeTailwind(antes), bakeTailwind(actual)]);
    return json({ comparacion: {
      titulo: p.title,
      page,
      antes: { id: version.id, html: previa.html, fecha: version.createdAt },
      ahora: { id: "actual", html: vigente.html, fecha: p.updatedAt },
    } });
  }
  return json({ comparacion: null });
});

/** The page a turn changed (home first), before and after it. A page it created, deleted, or one whose change is no
 *  longer kept (the last 30 turns are), compares nothing. */
async function turnComparison(projectId: string, fila: string, titulo: string) {
  const turno = await cambiosDe(projectId, fila.slice(0, 100));
  const paginas = (turno?.cambios ?? [])
    .flatMap((c) => {
      const pagina = paginaDeRuta(c.ruta);
      return pagina && c.antes && c.despues && c.antes !== c.despues && c.antes.length <= 6_000_000 && c.despues.length <= 6_000_000
        ? [{ page: pagina.page, antes: c.antes, despues: c.despues }]
        : [];
    })
    .sort((a, b) => (a.page === null ? -1 : b.page === null ? 1 : a.page < b.page ? -1 : 1));
  const cambio = paginas[0];
  if (!cambio) return null;
  const [previa, vigente] = await Promise.all([bakeTailwind(cambio.antes), bakeTailwind(cambio.despues)]);
  return { titulo, page: cambio.page, antes: { id: `${fila}:antes`, html: previa.html }, ahora: { id: `${fila}:ahora`, html: vigente.html } };
}

export const OPTIONS = respuestaPrevia;
