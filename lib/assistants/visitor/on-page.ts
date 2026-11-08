// WHAT «EN MI PÁGINA» SHOWS WHEN HER PLACE LOADS (spec local 2026-11-06-asistente-propio, §4.4.5; phase 2A): on but
// never published with her says so after a reload too — she answers only once a publish saved what she knows —, and an
// app or a game can't have her bubble yet (its shell has no text for her to know; phase 2B).
//
// Pure.

export interface OnPageState {
  readonly onPage: boolean;
  /** On, but the page hasn't been published with her yet. */
  readonly needsPublish: boolean;
  /** An app or a game: not yet. */
  readonly forApp: boolean;
}

export function onPageState(found: { readonly knowledge: string | null } | null, isApp: boolean): OnPageState {
  const onPage = found !== null;
  return { onPage, needsPublish: onPage && !found.knowledge?.trim(), forApp: isApp };
}
