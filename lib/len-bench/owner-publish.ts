// lib/len-bench/owner-publish.ts — LEN-BENCH PUBLICA COMO EL DUEÑO QUE PULSA
// «PUBLICAR», no en modo system (que nunca cambia nada de producción sin el
// dueño: unas tablas o unas Edge Functions nuevas tumbaban la corrida). Los
// cambios de tablas del borrador se aplican sin copiar sus datos de prueba (lo
// que el botón trae marcado) y las funciones se despliegan aunque falten
// secretos de producción («Publicar igual»: el banco no los tiene). Un cambio
// destructivo de tablas sigue pidiendo confirmación, como al dueño.

import type { publishProject } from "@/lib/projects";

export function benchPublishParams(o: { readonly projectId: string; readonly ownerId: string; readonly subdomain: string }): Parameters<typeof publishProject>[0] {
  return {
    projectId: o.projectId,
    userId: o.ownerId,
    subdomain: o.subdomain,
    languages: [],
    skipFlightCheck: true,
    dataChanges: { mode: "owner", copyDraftData: false },
    functions: { skipMissingSecrets: true },
  };
}
