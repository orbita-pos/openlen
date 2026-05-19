// Server-side module. Imports @/lib/db so any client-side bundling would
// fail at build time; no need for the explicit `server-only` marker, which
// also blocks usage from tsx CLI scripts (seed, etc.).
//
// Presentational types + family meta live in `./families.ts` so client
// components can import them without dragging node:* into the browser.
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getTemplateStorage } from "@/lib/storage/templates";
import {
  TEMPLATE_FAMILY_META as _META,
  type TemplateFamily,
  type TemplateMode,
  type TemplateStatus,
} from "./families";

// ─────────────────────────────────────────────────────────────────────────────
// Templates store — single entry point for reading/writing curated templates.
//
// Storage strategy: HTML body lives in object storage (R2 in prod, FS in dev)
// keyed by `templates/<id>-<contentHash>.html` so each content version is its
// own immutable URL. Metadata (name, family, accent, pitch, etc.) lives in
// Postgres so the gallery can paginate/filter/order without round-tripping
// to the bucket.
//
// Upload flow:
//   1. hash the HTML, build storageKey
//   2. upload to storage (idempotent — same hash means same object)
//   3. upsert the DB row pointing at that storageKey
//
// The same HTML uploaded under the same id is a no-op; uploading new HTML
// for an existing id creates a new object (old one becomes orphan) and
// updates the row.
// ─────────────────────────────────────────────────────────────────────────────

export type { TemplateFamily, TemplateMode, TemplateStatus };

export interface TemplateRecord {
  id: string;
  name: string;
  family: TemplateFamily;
  accent: string;
  pitch: string;
  description: string;
  mode: TemplateMode;
  storageKey: string;
  storageUrl: string;
  contentHash: string;
  size: number;
  status: TemplateStatus;
  createdAt: Date;
  updatedAt: Date;
  publishedAt: Date | null;
}

// Re-export from families.ts so existing `from "@/lib/templates/store"`
// imports keep working without dragging this server-only module into a
// client bundle (use `lib/templates/families` directly from client code).
export const TEMPLATE_FAMILY_META = _META;

export async function listTemplates(opts?: {
  family?: TemplateFamily;
  status?: TemplateStatus;
}): Promise<TemplateRecord[]> {
  const status = opts?.status ?? "published";
  const conditions = [eq(schema.templates.status, status)];
  if (opts?.family) conditions.push(eq(schema.templates.family, opts.family));
  const rows = await db
    .select()
    .from(schema.templates)
    .where(and(...conditions))
    .orderBy(schema.templates.createdAt);
  return rows.map(rowToRecord);
}

export async function getTemplate(id: string): Promise<TemplateRecord | null> {
  const rows = await db
    .select()
    .from(schema.templates)
    .where(eq(schema.templates.id, id))
    .limit(1);
  const row = rows[0];
  return row ? rowToRecord(row) : null;
}

export interface CreateOrUpdateInput {
  id: string;
  name: string;
  family: TemplateFamily;
  accent: string;
  pitch: string;
  description: string;
  mode: TemplateMode;
  html: string;
  status?: TemplateStatus;
}

export async function upsertTemplate(
  input: CreateOrUpdateInput,
): Promise<TemplateRecord> {
  const hash = sha256(input.html).slice(0, 12);
  const storageKey = `templates/${input.id}-${hash}.html`;
  const storage = getTemplateStorage();
  const buf = Buffer.from(input.html, "utf8");
  const uploaded = await storage.upload({
    key: storageKey,
    contentType: "text/html; charset=utf-8",
    body: buf,
  });

  const now = new Date();
  const status: TemplateStatus = input.status ?? "published";
  const values = {
    id: input.id,
    name: input.name,
    family: input.family,
    accent: input.accent,
    pitch: input.pitch,
    description: input.description,
    mode: input.mode,
    storageKey,
    storageUrl: uploaded.url,
    contentHash: hash,
    size: uploaded.size,
    status,
    updatedAt: now,
    publishedAt: status === "published" ? now : null,
  };

  await db
    .insert(schema.templates)
    .values(values)
    .onConflictDoUpdate({
      target: schema.templates.id,
      set: {
        name: values.name,
        family: values.family,
        accent: values.accent,
        pitch: values.pitch,
        description: values.description,
        mode: values.mode,
        storageKey: values.storageKey,
        storageUrl: values.storageUrl,
        contentHash: values.contentHash,
        size: values.size,
        status: values.status,
        updatedAt: values.updatedAt,
        publishedAt: values.publishedAt,
      },
    });

  const fresh = await getTemplate(input.id);
  if (!fresh) throw new Error(`upsertTemplate: row vanished after insert (${input.id})`);
  return fresh;
}

export async function archiveTemplate(id: string): Promise<void> {
  await db
    .update(schema.templates)
    .set({ status: "archived", updatedAt: new Date() })
    .where(eq(schema.templates.id, id));
}

// Fetch the raw HTML for a template by id. Reads from storage URL since
// that's the authoritative copy. Used by /api/projects/from-template to
// clone the body into a new user project.
export async function getTemplateHtml(id: string): Promise<string | null> {
  const t = await getTemplate(id);
  if (!t) return null;
  const res = await fetch(t.storageUrl, { cache: "no-store" });
  if (!res.ok) return null;
  return res.text();
}

function rowToRecord(row: typeof schema.templates.$inferSelect): TemplateRecord {
  return {
    id: row.id,
    name: row.name,
    family: row.family as TemplateFamily,
    accent: row.accent,
    pitch: row.pitch,
    description: row.description,
    mode: row.mode as TemplateMode,
    storageKey: row.storageKey,
    storageUrl: row.storageUrl,
    contentHash: row.contentHash,
    size: row.size,
    status: row.status as TemplateStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    publishedAt: row.publishedAt,
  };
}

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}
