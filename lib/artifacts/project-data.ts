import "server-only";
import type { QueryOutcome } from "../backend/cli-core";
import type { ProjectData } from "../projects/types";
import type { ArtifactContext, ArtifactDatabase } from "./types";
import type { ArtifactProjectSources } from "./context";
import type { RealArtifactDataRequest } from "./data";

/** Already-authorized source loader. No getProject(): reading deliverable
 * context must not load chat history or normalize/save the original app. */
export function projectSourceLoader(database: ArtifactDatabase) {
  return async (projectId: string, paths: readonly string[]): Promise<ArtifactProjectSources> => {
    const [row] = await database.query(`select "data" from "projects" where "id"=$1`, [projectId]);
    const data = row?.data as ProjectData | undefined;
    const files: Record<string, string> = Object.create(null);
    if (typeof data?.html === "string" && paths.includes("/index.html")) files["/index.html"] = data.html;
    for (const [slug, page] of Object.entries(data?.pages ?? {})) if (paths.includes(`/${slug}/index.html`)) files[`/${slug}/index.html`] = page.html;
    // An app's files all come: freezing it takes the whole app (context.ts filters what is public).
    const rows = data?.app
      ? await database.query(`select "path","content" from "projectFiles" where "projectId"=$1`, [projectId])
      : await database.query(`select "path","content" from "projectFiles" where "projectId"=$1 and "path"=any($2::text[])`, [projectId, paths]);
    for (const file of rows) files[String(file.path)] = String(file.content);
    return { files,...data?.app?.catalogo&&{catalogo:data.app.catalogo}, settings: { ...data?.settings } };
  };
}

export async function queryProjectArtifactData(ctx: ArtifactContext, input: RealArtifactDataRequest): Promise<QueryOutcome | null> {
  if (input.source === "backend") {
    const { queryBackendReadOnly } = await import("../backend/live-read");
    return queryBackendReadOnly(ctx.projectId, input.environment, input.query);
  }
  if (input.source === "visits") {
    const { resumirVisitas } = await import("../resultados/visitas");
    const result = await resumirVisitas(ctx.projectId, input.zone, { desde: input.from, hasta: input.to });
    return { kind: "rows", columns: ["Día", "Visitas"], rows: result.rango.porDia.map((d) => [d.dia, d.vistas]), truncated: result.recortadoDesde !== null };
  }
  const { resumirFormularios } = await import("../resultados/formularios");
  const result = await resumirFormularios(ctx.projectId, ctx.actorId, input.zone, { cuales: "fecha", desde: input.from, hasta: input.to });
  return { kind: "rows", columns: ["Fecha", "Página", "Resumen"], rows: result.lista.map((f) => [f.fecha, f.pagina, f.linea]), truncated: result.lista.length >= 50 };
}
