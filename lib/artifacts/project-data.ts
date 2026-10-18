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
    const rows = await database.query(`select "path","content" from "projectFiles" where "projectId"=$1 and "path"=any($2::text[])`, [projectId, paths]);
    for (const file of rows) files[String(file.path)] = String(file.content);
    return { files, settings: { ...data?.settings } };
  };
}

export async function queryProjectArtifactData(ctx: ArtifactContext, input: RealArtifactDataRequest): Promise<QueryOutcome | null> {
  if (input.source === "backend") {
    const [{ getBackendByProject }, { getEnvironment, claimReadOnlyPassword }, { backendConfigured }] = await Promise.all([import("../backend/registry"), import("../backend/environments"), import("../backend/pg")]);
    if (!backendConfigured()) return null;
    const rec = await getBackendByProject(ctx.projectId);
    const env = await getEnvironment(ctx.projectId, input.environment);
    if (!rec || !env?.provisionedAt) return null;
    const [{ encryptToken, decryptToken }, { newDatabasePassword }, { provisionReadOnlyRole }, { runLiveQuery }] = await Promise.all([import("../integrations/crypto"), import("../backend/keys"), import("../backend/read-only"), import("../backend/sql-query")]);
    const encrypted = env.readOnlyPasswordEncrypted ?? await claimReadOnlyPassword(ctx.projectId, encryptToken(newDatabasePassword()), input.environment);
    const roPassword = decryptToken(encrypted);
    await provisionReadOnlyRole({ scope: env.scope, ref: rec.ref, password: roPassword });
    // runLiveQuery is named for its original CLI consumer, but accepts any
    // scope. Both environments use its SELECT-only role and READ ONLY tx.
    return runLiveQuery({ scope: env.scope, roPassword }, input.query);
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
