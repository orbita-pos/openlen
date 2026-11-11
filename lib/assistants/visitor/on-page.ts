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
  /** The last publish that baked HER bubble (phase 4). */
  readonly bakedAt?: Date | null;
  readonly publicData?: readonly PublicTable[];
}

export function canAnswer(found: Found | null): boolean {
  if (!found) return false;
  return Boolean(found.knowledge?.trim()) || (found.publicData?.length ?? 0) > 0;
}

/** She answers visitors: on the page, through a bubble a publish with her baked, with something to know. Knowing what
 *  the project published is not enough — since phase 4 she knows that before her bubble is there. */
export function answersVisitors(found: Found | null): boolean {
  return Boolean(found?.bakedAt) && canAnswer(found);
}

export function onPageState(found: Found | null, isApp: boolean): OnPageState {
  const onPage = found !== null;
  const published = Boolean(found?.bakedAt);
  return { onPage, needsPublish: onPage && !published, nothingToKnow: onPage && published && !canAnswer(found), forApp: isApp };
}
