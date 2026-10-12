// UNA PÁGINA DE CONEXIONES («Aplicaciones conectadas» y su ruta): de 20 en 20,
// con el cursor de la siguiente. Sin base: lo usan la página y la ruta sobre
// lo que ya devolvió listConnections.
export const CONNECTIONS_PAGE = 20;

export function pageConnections<T>(all: readonly T[], cursor?: string | null, size: number = CONNECTIONS_PAGE): { items: T[]; nextCursor: string | null } {
  const n = Number.parseInt(cursor ?? "0", 10);
  const start = Number.isFinite(n) && n > 0 ? n : 0;
  return { items: all.slice(start, start + size), nextCursor: start + size < all.length ? String(start + size) : null };
}
