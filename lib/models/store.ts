// Server-side module. Imports @/lib/db so any client-side bundling would
// fail at build time; no need for the explicit `server-only` marker, which
// also blocks usage from tsx CLI scripts (seed, etc.).
//
// Presentational types + family meta live in `./families.ts` so client
// components can import them without dragging node:* into the browser.
import { createHash } from "node:crypto";
import { cache } from "react";
import { and, count, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getModelStorage } from "@/lib/storage/models";
import {
  MODEL_FAMILY_META as _META,
  type ModelFamily,
  type ModelStatus,
} from "./families";

// ─────────────────────────────────────────────────────────────────────────────
// Models store — single entry point for reading/writing curated 3D models.
//
// Storage strategy: GLB binary lives in object storage (R2 in prod, FS in
// dev) keyed by `models/<id>-<contentHash>.glb` so each content version is
// its own immutable URL. Metadata lives in Postgres so the picker can
// paginate/filter/order without round-tripping to the bucket.
//
// Upload flow:
//   1. sha256 the GLB buffer, slice first 12 hex chars for the hash
//   2. upload to storage (idempotent — same hash means same object)
//   3. upsert the DB row pointing at that storageKey
// ─────────────────────────────────────────────────────────────────────────────

export type { ModelFamily, ModelStatus };

export interface ModelRecord {
  id: string;
  name: string;
  family: ModelFamily;
  author: string;
  pitch: string;
  description: string;
  storageKey: string;
  storageUrl: string;
  contentHash: string;
  size: number;
  /** Optional Gemini-generated scene spec. Null until set. */
  sceneSpec: Record<string, unknown> | null;
  tags: string[];
  license: string;
  status: ModelStatus;
  /** Pre-rendered WebP thumbnail URL for the picker cards. Null until
   *  the thumbnailing script has run for this row. */
  thumbnailUrl: string | null;
  /** Small AVIF tile (~600px) for gallery walls. Null until that script runs. */
  tileUrl: string | null;
  /** Full-size reference render. Reference-only — never served directly. */
  previewImageUrl: string | null;
  /** Hand-curated "top-tier" flag. Defaults to false. */
  featured: boolean;
  createdAt: Date;
  updatedAt: Date;
  publishedAt: Date | null;
}

// Re-export from families.ts so existing `from "@/lib/models/store"` imports
// keep working without dragging this server-only module into a client bundle.
export const MODEL_FAMILY_META = _META;

export async function listModels(opts?: {
  family?: ModelFamily;
  status?: ModelStatus;
}): Promise<ModelRecord[]> {
  const status = opts?.status ?? "published";
  const conditions = [eq(schema.models.status, status)];
  if (opts?.family) conditions.push(eq(schema.models.family, opts.family));
  const rows = await db
    .select()
    .from(schema.models)
    .where(and(...conditions))
    .orderBy(schema.models.createdAt);
  return rows.map(rowToRecord);
}

/** Live count of published models — powers any "N models" copy on marketing
 *  surfaces. cache()d so multiple callers in one render share a single COUNT. */
export const countModels = cache(async (): Promise<number> => {
  const rows = await db
    .select({ n: count() })
    .from(schema.models)
    .where(eq(schema.models.status, "published"));
  return Number(rows[0]?.n ?? 0);
});

// Admin-only: list EVERY row regardless of status (drafts + archived too).
export async function listAllForAdmin(): Promise<ModelRecord[]> {
  const rows = await db
    .select()
    .from(schema.models)
    .orderBy(schema.models.createdAt);
  return rows.map(rowToRecord);
}

export async function getModel(id: string): Promise<ModelRecord | null> {
  const rows = await db
    .select()
    .from(schema.models)
    .where(eq(schema.models.id, id))
    .limit(1);
  const row = rows[0];
  return row ? rowToRecord(row) : null;
}

export interface CreateOrUpdateModelInput {
  id: string;
  name: string;
  family: ModelFamily;
  author?: string;
  pitch: string;
  description: string;
  glb: Buffer;
  sceneSpec?: Record<string, unknown>;
  tags?: string[];
  license?: string;
  status?: ModelStatus;
}

export async function upsertModel(
  input: CreateOrUpdateModelInput,
): Promise<ModelRecord> {
  const hash = sha256Buffer(input.glb).slice(0, 12);
  const storageKey = `models/${input.id}-${hash}.glb`;
  const storage = getModelStorage();
  const uploaded = await storage.upload({
    key: storageKey,
    contentType: "model/gltf-binary",
    body: input.glb,
  });

  const now = new Date();
  const status: ModelStatus = input.status ?? "published";
  const values = {
    id: input.id,
    name: input.name,
    family: input.family,
    author: input.author ?? "OpenLen",
    pitch: input.pitch,
    description: input.description,
    storageKey,
    storageUrl: uploaded.url,
    contentHash: hash,
    size: uploaded.size,
    sceneSpec: input.sceneSpec ?? null,
    tags: input.tags ?? [],
    license: input.license ?? "cc0",
    status,
    updatedAt: now,
    publishedAt: status === "published" ? now : null,
  };

  await db
    .insert(schema.models)
    .values(values)
    .onConflictDoUpdate({
      target: schema.models.id,
      set: {
        name: values.name,
        family: values.family,
        author: values.author,
        pitch: values.pitch,
        description: values.description,
        storageKey: values.storageKey,
        storageUrl: values.storageUrl,
        contentHash: values.contentHash,
        size: values.size,
        sceneSpec: values.sceneSpec,
        tags: values.tags,
        license: values.license,
        status: values.status,
        updatedAt: values.updatedAt,
        publishedAt: values.publishedAt,
      },
    });

  const fresh = await getModel(input.id);
  if (!fresh) throw new Error(`upsertModel: row vanished after insert (${input.id})`);
  return fresh;
}

export async function archiveModel(id: string): Promise<void> {
  await db
    .update(schema.models)
    .set({ status: "archived", updatedAt: new Date() })
    .where(eq(schema.models.id, id));
}

/** Uploads a rendered AVIF thumbnail to storage and persists its URL on the
 *  model row. Used by the `models:thumbs` backfill script. Returns the
 *  public URL, mirroring `upsertModel`'s storage.upload → uploaded.url
 *  convention (same hash-keyed, content-addressed layout). */
export async function setModelThumbnail(
  id: string,
  avif: Buffer,
): Promise<string> {
  const hash = sha256Buffer(avif).slice(0, 12);
  const key = `models/thumbs/${id}-${hash}.avif`;
  const storage = getModelStorage();
  const uploaded = await storage.upload({
    key,
    contentType: "image/avif",
    body: avif,
  });

  await db
    .update(schema.models)
    .set({ thumbnailUrl: uploaded.url, updatedAt: new Date() })
    .where(eq(schema.models.id, id));

  return uploaded.url;
}

function rowToRecord(row: typeof schema.models.$inferSelect): ModelRecord {
  return {
    id: row.id,
    name: row.name,
    family: row.family as ModelFamily,
    author: row.author,
    pitch: row.pitch,
    description: row.description,
    storageKey: row.storageKey,
    storageUrl: row.storageUrl,
    contentHash: row.contentHash,
    size: row.size,
    sceneSpec: (row.sceneSpec as Record<string, unknown>) ?? null,
    tags: (row.tags as string[]) ?? [],
    license: row.license,
    status: row.status as ModelStatus,
    thumbnailUrl: row.thumbnailUrl,
    tileUrl: row.tileUrl,
    previewImageUrl: row.previewImageUrl,
    featured: row.featured,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    publishedAt: row.publishedAt,
  };
}

function sha256Buffer(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}
