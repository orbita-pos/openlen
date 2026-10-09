// lib/agent/person.ts — DE QUIÉN es lo personal en un turno.
//
// En un proyecto compartido (lib/projects/acceso.ts) `session.userId` es el
// DUEÑO: con él se lee y escribe el proyecto y él paga. Lo personal —la
// memoria de la persona— es de quien HABLA, que es `personId` cuando no es el
// dueño. Vive aparte de `tools.ts` porque `tools.ts` importa las herramientas
// de ficheros, y ellas lo necesitan: aquí no hay ciclo.
import type { AgentSession } from "@/lib/agent/tools";

/** La persona del turno: de quien es la memoria personal. */
export function personOf(session: Pick<AgentSession, "userId" | "personId">): string {
  return session.personId ?? session.userId;
}
