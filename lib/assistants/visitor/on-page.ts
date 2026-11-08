// WHEN SHE CAN ANSWER VISITORS, AND WHAT «EN MI PÁGINA» SHOWS (spec local 2026-11-06-asistente-propio, §4.4.5; phases 2A
// and 2B). She answers once a publish with her saved something for her to know: the site's text, or what its data shows
// anyone (an app's shell has no text, but its public tables can say a lot). On but never published with her says so,
// after a reload too; published with nothing to know says that instead.
//
// Pure.
import type { PublicTable } from "@/lib/db/schema";

export interface OnPageState {
  readonly onPage: boolean;
  /** On, but the page hasn't been published with her yet. */
  readonly needsPublish: boolean;
  /** Published with her, and nothing for her to know: no text and no public data. */
  readonly nothingToKnow: boolean;
  /** An app or a game. */
  readonly forApp: boolean;
}

interface Found {
  readonly knowledge: string | null;
  readonly knowledgeAt?: Date | null;
  readonly publicData?: readonly PublicTable[];
}

export function canAnswer(found: Found | null): boolean {
  if (!found) return false;
  return Boolean(found.knowledge?.trim()) || (found.publicData?.length ?? 0) > 0;
}

export function onPageState(found: Found | null, isApp: boolean): OnPageState {
  const onPage = found !== null;
  const published = Boolean(found?.knowledgeAt);
  return { onPage, needsPublish: onPage && !published, nothingToKnow: onPage && published && !canAnswer(found), forApp: isApp };
}
