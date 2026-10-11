// LA SESIÓN DE AGENTE para leer y (Parte 2) escribir con las MISMAS funciones
// que el editor de la lente Código (lib/agent/terminal/editar-a-mano.ts). Con
// `app`: sin ella, las guardas de una app no corren (el editor tiene ese hueco).
import type { AgentSession } from "@/lib/agent/tools";
import type { AppDeProyecto } from "@/lib/projects/types";

export function mcpAgentSession(p: {
  projectId: string;
  ownerId: string;
  personId: string;
  app: AppDeProyecto | null | undefined;
}): AgentSession {
  return {
    projectId: p.projectId,
    userId: p.ownerId,
    ...(p.personId !== p.ownerId ? { personId: p.personId } : {}),
    autor: "usuario",
    desde: "editor",
    page: null,
    ownerEmail: null,
    imageEditsThisTurn: 0,
    photoSearchesThisTurn: 0,
    busquedasVaciasSeguidas: 0,
    app: p.app ?? null,
  };
}
