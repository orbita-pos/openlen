// Sync a sheet-backed Collection from the rows of its Google Sheet ("datos
// vivos", spec 2026-07-14). This is the ONLY code allowed to write the items
// of a sheet-backed collection — it calls the *Unguarded write path in
// store.ts directly, bypassing SheetBackedReadOnlyError on purpose. Direction
// is one-way (Sheet → collection); nothing here ever writes back to the Sheet.
//
// Callers own fetching the Sheet (lib/live/sheet-source.ts's fetchSheet gives
// `rows: Record<string, string>[]` already) — this module only maps + upserts.

import {
  archiveItemUnguarded,
  createItemUnguarded,
  listItems,
  updateItemUnguarded,
  type ItemInput,
} from "./store";

interface MappedFields {
  title?: string;
  priceDisplay?: string;
  imageUrl?: string;
  subtitle?: string;
}

// Case-insensitive header → ItemInput field. Spanish-first (the target
// audience), English as fallback. Best-effort: an unmapped column is ignored.
const HEADER_ALIASES: Record<string, keyof MappedFields> = {
  nombre: "title",
  name: "title",
  "título": "title",
  titulo: "title",
  precio: "priceDisplay",
  price: "priceDisplay",
  foto: "imageUrl",
  imagen: "imageUrl",
  image: "imageUrl",
  img: "imageUrl",
  "subtítulo": "subtitle",
  subtitulo: "subtitle",
  "descripción": "subtitle",
  descripcion: "subtitle",
  subtitle: "subtitle",
  description: "subtitle",
};

/** Maps one sheet row via HEADER_ALIASES. A blank cell is treated the same as
 *  a missing/unmapped column — omitted, never written as "". When two header
 *  aliases for the same field both have values (unusual), the first non-empty
 *  one wins. */
function mapRow(row: Record<string, string>): MappedFields {
  const mapped: MappedFields = {};
  for (const [header, rawValue] of Object.entries(row)) {
    const field = HEADER_ALIASES[header.trim().toLowerCase()];
    if (!field) continue;
    const value = rawValue?.trim();
    if (!value) continue;
    if (mapped[field] === undefined) mapped[field] = value;
  }
  return mapped;
}

export interface SheetSyncResult {
  upserted: number;
  archived: number;
}

/** Upserts items by title (the v1 item identity) from `rows`, then archives
 *  any currently-published item whose title is no longer present in the
 *  sheet. Rows with no title-mapped column are skipped entirely — they
 *  neither create/update an item nor count toward "still present" for the
 *  archive pass. */
export async function syncCollectionFromSheet(
  projectId: string,
  collectionId: string,
  rows: Record<string, string>[],
): Promise<SheetSyncResult> {
  const existing = await listItems(projectId, collectionId, { includeArchived: false });
  const byTitle = new Map(existing.map((item) => [item.title.trim().toLowerCase(), item]));

  const seenTitles = new Set<string>();
  let upserted = 0;

  for (const row of rows) {
    const mapped = mapRow(row);
    if (!mapped.title) continue;

    const key = mapped.title.trim().toLowerCase();
    seenTitles.add(key);

    const patch: ItemInput = { title: mapped.title };
    if (mapped.priceDisplay !== undefined) patch.priceDisplay = mapped.priceDisplay;
    if (mapped.imageUrl !== undefined) patch.imageUrl = mapped.imageUrl;
    if (mapped.subtitle !== undefined) patch.subtitle = mapped.subtitle;

    const existingItem = byTitle.get(key);
    if (existingItem) {
      await updateItemUnguarded(projectId, existingItem.id, patch);
    } else {
      // Add the fresh row to byTitle right away: a SECOND row with the same
      // title later in this same batch must fall into the UPDATE path above,
      // not create a duplicate. Two rows sharing a title that didn't pre-exist
      // would otherwise both miss the map → two rows with one title → on the
      // next sync new Map(...) collapses them (last-wins) and orphans the
      // other forever.
      const created = await createItemUnguarded(projectId, collectionId, patch);
      byTitle.set(key, created);
    }
    upserted++;
  }

  let archived = 0;
  for (const [key, item] of byTitle) {
    if (seenTitles.has(key)) continue;
    await archiveItemUnguarded(projectId, item.id);
    archived++;
  }

  return { upserted, archived };
}
