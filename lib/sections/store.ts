// Server-side module (imports @/lib/db). Presentational types live in
// ./types so client components can import them without dragging node:* in.
//
// Section library store — mirror of lib/templates/store.ts but for section
// FRAGMENTS. HTML body lives in object storage keyed by
// `sections/<id>-<contentHash>.html` (SAME bucket as templates, distinct
// prefix — see lib/storage/templates.ts). Metadata lives in Postgres so the
// gallery can filter by type without round-tripping to the bucket.
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { getTemplateStorage } from "@/lib/storage/templates";
import type {
  SectionMode,
  SectionStatus,
  SectionType,
} from "./types";

export type { SectionMode, SectionStatus, SectionType };

export interface SectionRecord {
  id: string;
  type: SectionType;
  name: string;
  variantLabel: string;
  rootTag: string;
  mode: SectionMode;
  storageKey: string;
  storageUrl: string;
  contentHash: string;
  size: number;
  /** :root custom properties parsed at ingest, for the re-theme path. */
  designTokens: Record<string, string> | null;
  /** Google-Fonts stylesheet hrefs to hoist into the host <head> on insert. */
  fonts: string[] | null;
  /** Content rendered by inline JS — insertion must preserve <script>. */
  needsJs: boolean;
  /** Ships decorative gradient placeholders to swap for real assets. */
  hasPlaceholders: boolean;
  thumbnailUrl: string | null;
  status: SectionStatus;
  createdAt: Date;
  updatedAt: Date;
  publishedAt: Date | null;
}

export async function listSections(opts?: {
  type?: SectionType;
  status?: SectionStatus;
}): Promise<SectionRecord[]> {
  const status = opts?.status ?? "published";
  const conditions = [eq(schema.sections.status, status)];
  if (opts?.type) conditions.push(eq(schema.sections.type, opts.type));
  const rows = await db
    .select()
    .from(schema.sections)
    .where(and(...conditions))
    .orderBy(schema.sections.type, schema.sections.id);
  return rows.map(rowToRecord);
}

// Admin/CLI: every row regardless of status (used by sections:count).
export async function listAllSectionsForAdmin(): Promise<SectionRecord[]> {
  const rows = await db
    .select()
    .from(schema.sections)
    .orderBy(schema.sections.type, schema.sections.id);
  return rows.map(rowToRecord);
}

export async function getSection(id: string): Promise<SectionRecord | null> {
  const rows = await db
    .select()
    .from(schema.sections)
    .where(eq(schema.sections.id, id))
    .limit(1);
  const row = rows[0];
  return row ? rowToRecord(row) : null;
}

export interface CreateSectionInput {
  id: string;
  type: SectionType;
  name: string;
  variantLabel: string;
  rootTag: string;
  mode?: SectionMode;
  html: string;
  designTokens?: Record<string, string>;
  fonts?: string[];
  needsJs?: boolean;
  hasPlaceholders?: boolean;
  status?: SectionStatus;
}

export async function upsertSection(
  input: CreateSectionInput,
): Promise<SectionRecord> {
  const hash = sha256(input.html).slice(0, 12);
  const storageKey = `sections/${input.id}-${hash}.html`;
  const storage = getTemplateStorage();
  const uploaded = await storage.upload({
    key: storageKey,
    contentType: "text/html; charset=utf-8",
    body: Buffer.from(input.html, "utf8"),
  });

  const now = new Date();
  const status: SectionStatus = input.status ?? "published";
  const values = {
    id: input.id,
    type: input.type,
    name: input.name,
    variantLabel: input.variantLabel,
    rootTag: input.rootTag,
    mode: input.mode ?? "light",
    storageKey,
    storageUrl: uploaded.url,
    contentHash: hash,
    size: uploaded.size,
    designTokens: input.designTokens ?? null,
    fonts: input.fonts ?? null,
    needsJs: input.needsJs ?? false,
    hasPlaceholders: input.hasPlaceholders ?? false,
    status,
    updatedAt: now,
    publishedAt: status === "published" ? now : null,
  };

  await db
    .insert(schema.sections)
    .values(values)
    .onConflictDoUpdate({
      target: schema.sections.id,
      set: {
        type: values.type,
        name: values.name,
        variantLabel: values.variantLabel,
        rootTag: values.rootTag,
        mode: values.mode,
        storageKey: values.storageKey,
        storageUrl: values.storageUrl,
        contentHash: values.contentHash,
        size: values.size,
        designTokens: values.designTokens,
        fonts: values.fonts,
        needsJs: values.needsJs,
        hasPlaceholders: values.hasPlaceholders,
        status: values.status,
        updatedAt: values.updatedAt,
        publishedAt: values.publishedAt,
      },
    });

  const fresh = await getSection(input.id);
  if (!fresh) throw new Error(`upsertSection: row vanished after insert (${input.id})`);
  return fresh;
}

export async function archiveSection(id: string): Promise<void> {
  await db
    .update(schema.sections)
    .set({ status: "archived", updatedAt: new Date() })
    .where(eq(schema.sections.id, id));
}

// Raw HTML fragment for a section, read from the authoritative storage URL.
export async function getSectionHtml(id: string): Promise<string | null> {
  const s = await getSection(id);
  if (!s) return null;
  const res = await fetch(s.storageUrl, { cache: "no-store" });
  if (!res.ok) return null;
  return res.text();
}

function rowToRecord(row: typeof schema.sections.$inferSelect): SectionRecord {
  return {
    id: row.id,
    type: row.type as SectionType,
    name: row.name,
    variantLabel: row.variantLabel,
    rootTag: row.rootTag,
    mode: row.mode as SectionMode,
    storageKey: row.storageKey,
    storageUrl: row.storageUrl,
    contentHash: row.contentHash,
    size: row.size,
    designTokens: (row.designTokens as Record<string, string> | null) ?? null,
    fonts: (row.fonts as string[] | null) ?? null,
    needsJs: row.needsJs,
    hasPlaceholders: row.hasPlaceholders,
    thumbnailUrl: row.thumbnailUrl,
    status: row.status as SectionStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    publishedAt: row.publishedAt,
  };
}

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}
