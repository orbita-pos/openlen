// Server-side module (imports @/lib/db, node:crypto). Calco of
// lib/templates/store.ts, minus pages/thumbnails/featured — the marketing
// kit's post templates are single-file HTML with no multi-page/gallery meta.
import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getTemplateStorage } from "@/lib/storage/templates";
import type { PostFormat, PostGoal, PostRegister, PostTemplateStatus } from "./families";

export interface PostTemplateRecord {
  id: string;
  name: string;
  register: PostRegister;
  format: PostFormat;
  goal: PostGoal;
  storageKey: string;
  storageUrl: string;
  contentHash: string;
  size: number;
  status: PostTemplateStatus;
  createdAt: Date;
  updatedAt: Date;
  publishedAt: Date | null;
}

export interface PostCreateOrUpdateInput {
  id: string;
  name: string;
  register: PostRegister;
  format: PostFormat;
  goal: PostGoal;
  html: string;
  status?: PostTemplateStatus;
}

export async function listPostTemplates(opts?: {
  register?: PostRegister;
  goal?: PostGoal;
  status?: PostTemplateStatus;
}): Promise<PostTemplateRecord[]> {
  const status = opts?.status ?? "published";
  const conditions = [eq(schema.postTemplates.status, status)];
  if (opts?.register && opts.register !== "general") {
    // A register's kit always includes the `general` designs as fallback.
    conditions.push(inArray(schema.postTemplates.register, [opts.register, "general"]));
  } else if (opts?.register) {
    conditions.push(eq(schema.postTemplates.register, "general"));
  }
  if (opts?.goal) conditions.push(eq(schema.postTemplates.goal, opts.goal));
  const rows = await db
    .select()
    .from(schema.postTemplates)
    .where(and(...conditions))
    .orderBy(schema.postTemplates.createdAt);
  return rows.map(rowToRecord);
}

export async function getPostTemplate(id: string): Promise<PostTemplateRecord | null> {
  const rows = await db
    .select()
    .from(schema.postTemplates)
    .where(eq(schema.postTemplates.id, id))
    .limit(1);
  const row = rows[0];
  return row ? rowToRecord(row) : null;
}

export async function upsertPostTemplate(
  input: PostCreateOrUpdateInput,
): Promise<PostTemplateRecord> {
  const hash = sha256(input.html).slice(0, 12);
  const storageKey = `posts/${input.id}-${hash}.html`;
  const storage = getTemplateStorage();
  const buf = Buffer.from(input.html, "utf8");
  const uploaded = await storage.upload({
    key: storageKey,
    contentType: "text/html; charset=utf-8",
    body: buf,
  });

  const now = new Date();
  const status: PostTemplateStatus = input.status ?? "published";
  const values = {
    id: input.id,
    name: input.name,
    register: input.register,
    format: input.format,
    goal: input.goal,
    storageKey,
    storageUrl: uploaded.url,
    contentHash: hash,
    size: uploaded.size,
    status,
    updatedAt: now,
    publishedAt: status === "published" ? now : null,
  };

  await db
    .insert(schema.postTemplates)
    .values(values)
    .onConflictDoUpdate({
      target: schema.postTemplates.id,
      set: {
        name: values.name,
        register: values.register,
        format: values.format,
        goal: values.goal,
        storageKey: values.storageKey,
        storageUrl: values.storageUrl,
        contentHash: values.contentHash,
        size: values.size,
        status: values.status,
        updatedAt: values.updatedAt,
        publishedAt: values.publishedAt,
      },
    });

  const fresh = await getPostTemplate(input.id);
  if (!fresh) throw new Error(`upsertPostTemplate: row vanished (${input.id})`);
  return fresh;
}

export async function archivePostTemplate(id: string): Promise<void> {
  await db
    .update(schema.postTemplates)
    .set({ status: "archived", updatedAt: new Date() })
    .where(eq(schema.postTemplates.id, id));
}

// Fetch the raw HTML for a post template by id. Reads from storage URL since
// that's the authoritative copy.
export async function getPostTemplateHtml(id: string): Promise<string | null> {
  const t = await getPostTemplate(id);
  if (!t) return null;
  const res = await fetch(t.storageUrl, { cache: "no-store" });
  if (!res.ok) return null;
  return res.text();
}

function rowToRecord(row: typeof schema.postTemplates.$inferSelect): PostTemplateRecord {
  return {
    id: row.id,
    name: row.name,
    register: row.register as PostRegister,
    format: row.format as PostFormat,
    goal: row.goal as PostGoal,
    storageKey: row.storageKey,
    storageUrl: row.storageUrl,
    contentHash: row.contentHash,
    size: row.size,
    status: row.status as PostTemplateStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    publishedAt: row.publishedAt,
  };
}

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}
