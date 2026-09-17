// Pure helpers for ExploreView — kept dependency-free so they run in the plain
// node/vitest env without pulling in react/next-intl client deps.

// Mirrors lib/community/store.ts's `ExploreCard` row shape as it arrives over
// the wire from GET /api/explore (JSON — `listedAt` serializes to an ISO
// string, not a Date).
export type ExploreItem = {
  id: string;
  title: string;
  thumbnailUrl: string | null;
  deployUrl: string | null;
  handle: string | null;
  avatarUrl: string | null;
  remixCount: number;
  listedAt: string | null;
};

/**
 * `deployUrl` → la URL absoluta que puede ir en un `href`, o `undefined`.
 *
 * 🔴 POR QUÉ NO SE PUEDE ENCHUFAR `deployUrl` DIRECTO EN UN `href`. La columna
 * se guarda BARE al publicar (`${sub}.${host}`, sin esquema — lib/projects.ts).
 * Un `href="kira.openlen.com"` no es un enlace al dominio viejo: es una RUTA
 * RELATIVA, y el navegador la resuelve contra la página actual.
 *
 * MEDIDO en producción el 2026-09-17: `/es/explore` servía las 24 tarjetas con
 * el href crudo → `https://openlen.com/es/kira.openlen.com` → 404. No pasaban
 * por el 308 del `.com` al `.app`: no llegaban a salir del sitio.
 *
 * El store ya deriva y devuelve absoluta (`lib/publish/deploy-url.ts`), así que
 * esto sólo entra en la fila SIN subdominio, donde no hay nada que derivar y
 * manda la columna. Está aquí, y no escrito dos veces, porque la misma tarjeta
 * contestaba distinto según por qué puerta se entrara: `explore-view.tsx`
 * (el taller) prefijaba, `explore-card.tsx` (`/explore` y `/[handle]`) no.
 */
export function liveUrlFor(deployUrl: string | null | undefined): string | undefined {
  if (!deployUrl) return undefined;
  return /^https?:\/\//i.test(deployUrl) ? deployUrl : `https://${deployUrl}`;
}

/** Cursor pagination: append a fetched page, dedupe by id (a boundary row can repeat). */
export function appendExplorePage(
  acc: ExploreItem[],
  page: ExploreItem[],
): ExploreItem[] {
  if (acc.length === 0) return page;
  const seen = new Set(acc.map((i) => i.id));
  return [...acc, ...page.filter((i) => !seen.has(i.id))];
}
