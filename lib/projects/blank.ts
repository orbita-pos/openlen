/**
 * EL PROYECTO EN BLANCO — la «New Session» de DeepSeek
 * (`packages/client/ui-workspace/README.md:30,76,78` de deepseek-harness):
 * existe antes del primer mensaje, se reutiliza en vez de crear otro, y lo que
 * está en blanco no sale en la lista salvo el que tienes abierto.
 *
 * En blanco = sin portada, sin páginas y sin conversación. Con conversación ya
 * no lo es aunque Len no llegara a escribir: lo que el usuario dijo es suyo.
 *
 * Puro: lo usan el servidor (la lista, `findOrCreateBlankProject`) y el cliente
 * (`/new` decide si pinta el estado vacío).
 */
export function isBlankProject(p: {
  readonly html: string | null | undefined;
  readonly pages: Readonly<Record<string, unknown>> | null | undefined;
  readonly chatTurns: number;
}): boolean {
  return !(p.html ?? "").trim() && Object.keys(p.pages ?? {}).length === 0 && p.chatTurns === 0;
}

/**
 * LA LISTA, COMO LA DE DEEPSEEK: un proyecto en blanco no sale, salvo el que
 * está abierto (`openId`) —ése se rotula «Proyecto nuevo»—. Una fila sin la
 * marca (`isBlank` ausente, de una respuesta vieja) sale siempre.
 */
export function visibleProjects<T extends { readonly id: string; readonly isBlank?: boolean }>(
  projects: readonly T[],
  openId: string | null,
): T[] {
  return projects.filter((p) => !p.isBlank || p.id === openId);
}
