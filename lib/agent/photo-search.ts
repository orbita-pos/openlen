// lib/agent/photo-search.ts — pure search over the "Imágenes by OpenLen"
// manifest (public/openlen-images/manifest.json), for the elegir_foto agent
// tool. Replicates the filtering semantics of the client picker
// (components/workspace-v2/replace-asset-modal.tsx's OpenLenTab: style exact
// match + free-text substring match against alt/id/family) but adds
// accent-insensitivity (the client only lowercases) since agent users type
// natural-language Spanish queries. Zero I/O — the manifest is handed in by
// the caller (AgentDeps.fetchImageManifest), so this stays trivially testable
// and can never throw on malformed data: anything unexpected is just filtered
// out, never a thrown error.

export interface CuratedPhoto {
  url: string;
  style: string;
  alt: string;
}

interface CuratedPhotoQuery {
  estilo?: string;
  busqueda?: string;
  limite?: number;
}

const DEFAULT_LIMIT = 6;
const MAX_LIMIT = 6;

interface ManifestEntry {
  id: string;
  style: string;
  alt: string;
  family: string[];
  url: string;
}

/** Case- AND accent-insensitive compare key (NFD strip combining marks). */
const COMBINING_MARKS_RE = /[̀-ͯ]/g;

function normalize(value: string): string {
  return value.normalize("NFD").replace(COMBINING_MARKS_RE, "").toLowerCase();
}

function clampLimit(limite: number | undefined): number {
  if (typeof limite !== "number" || !Number.isFinite(limite) || limite <= 0) {
    return DEFAULT_LIMIT;
  }
  return Math.min(Math.floor(limite), MAX_LIMIT);
}

function extractEntries(manifest: unknown): ManifestEntry[] {
  if (!manifest || typeof manifest !== "object") return [];
  const images = (manifest as { images?: unknown }).images;
  if (!Array.isArray(images)) return [];

  const out: ManifestEntry[] = [];
  for (const raw of images) {
    if (!raw || typeof raw !== "object") continue;
    const rec = raw as Record<string, unknown>;

    const style = typeof rec.style === "string" ? rec.style : "";
    const src = rec.src;
    const url =
      src && typeof src === "object" && typeof (src as Record<string, unknown>).hero === "string"
        ? ((src as Record<string, unknown>).hero as string)
        : "";
    // A photo with no style or no hero URL isn't usable — never surface it.
    if (!style || !url) continue;

    const id = typeof rec.id === "string" ? rec.id : "";
    const alt = typeof rec.alt === "string" ? rec.alt : "";
    const family = Array.isArray(rec.family)
      ? rec.family.filter((f): f is string => typeof f === "string")
      : [];

    out.push({ id, style, alt, family, url });
  }
  return out;
}

/** Mirrors the OpenLenTab client filter (style exact-match, term substring
 *  against `${alt} ${id} ${family.join(" ")}`) but case/accent-insensitive,
 *  and defensive against a malformed manifest (returns [] rather than
 *  throwing). Result is capped at 6 regardless of the requested `limite`. */
export function searchCuratedPhotos(
  manifest: unknown,
  query: CuratedPhotoQuery,
): CuratedPhoto[] {
  const entries = extractEntries(manifest);
  if (entries.length === 0) return [];

  const estilo = query.estilo?.trim() ? normalize(query.estilo) : undefined;
  const busqueda = query.busqueda?.trim() ? normalize(query.busqueda) : undefined;
  const limit = clampLimit(query.limite);

  const out: CuratedPhoto[] = [];
  for (const entry of entries) {
    if (estilo && normalize(entry.style) !== estilo) continue;
    if (busqueda) {
      const haystack = normalize(`${entry.alt} ${entry.id} ${entry.family.join(" ")}`);
      if (!haystack.includes(busqueda)) continue;
    }
    out.push({ url: entry.url, style: entry.style, alt: entry.alt });
    if (out.length >= limit) break;
  }
  return out;
}
