/**
 * The projects a person can see, with their role (spec local 2026-10-31-len-movil, §5.6): their own as
 * owner and the ones shared with them, as the phone's project list shows them (the blank project left
 * out). What the phone's «Entregado» and «Tareas» gather from; each list then keeps its own rule (see,
 * or edit) per project, the same as the per-project routes.
 */
import "server-only";

import { listProjects, listProjectsByIds } from "@/lib/projects";
import type { RolEnProyecto } from "@/lib/projects/acceso";
import { proyectosCompartidos } from "@/lib/projects/miembros";

export interface VisibleProject {
  readonly id: string;
  readonly title: string;
  readonly role: RolEnProyecto;
}

export async function visibleProjects(userId: string): Promise<VisibleProject[]> {
  const [own, shared] = await Promise.all([listProjects(userId), proyectosCompartidos(userId)]);
  const roleOf = new Map(shared.map((s) => [s.projectId, s.rol]));
  const sharedRows = await listProjectsByIds(shared.map((s) => s.projectId));
  return [
    ...own.filter((p) => !p.isBlank).map((p) => ({ id: p.id, title: p.title, role: "dueno" as const })),
    ...sharedRows.filter((p) => !p.isBlank && roleOf.has(p.id)).map((p) => ({ id: p.id, title: p.title, role: roleOf.get(p.id)! })),
  ];
}
