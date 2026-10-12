// LOS PROYECTOS QUE VE UNA PERSONA: los suyos y los compartidos con ella, sin
// los en blanco, del más reciente al más viejo. Lo usan list_projects y el
// selector de proyecto del consentimiento.
import { listProjects, listProjectsByIds, type ProjectSummary } from "@/lib/projects";
import { proyectosCompartidos } from "@/lib/projects/miembros";

const ROLE = { dueno: "owner", editor: "editor", lector: "viewer" } as const;

export async function projectsVisibleTo(userId: string): Promise<{ p: ProjectSummary; role: "owner" | "editor" | "viewer" }[]> {
  const [own, shared] = await Promise.all([listProjects(userId), proyectosCompartidos(userId)]);
  const sharedRows = await listProjectsByIds(shared.map((s) => s.projectId));
  const roleOf = new Map(shared.map((s) => [s.projectId, ROLE[s.rol]]));
  return [
    ...own.filter((p) => !p.isBlank).map((p) => ({ p, role: "owner" as const })),
    ...sharedRows.filter((p) => !p.isBlank).map((p) => ({ p, role: roleOf.get(p.id) ?? ("viewer" as const) })),
  ].sort((a, b) => b.p.updatedAt.getTime() - a.p.updatedAt.getTime());
}
