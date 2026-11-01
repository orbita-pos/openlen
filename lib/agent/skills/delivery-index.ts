/**
 * The index of what Len delivered (spec local 2026-10-31-len-movil, §5.3): one row per file `present`
 * stored, so the phone's «Entregado» lists every project's deliveries, newest first, without reading
 * every chat turn. The file itself and its card stay where they were (private store, the turn).
 */
import "server-only";

import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";

import { db, schema } from "@/lib/db";

import { contentTypeOf, type DeliveredFile } from "./present";

export type DeliveryIndexRow = typeof schema.deliveredFiles.$inferSelect;

export async function indexDeliveries(projectId: string, turnId: string, files: readonly DeliveredFile[]): Promise<void> {
  if (files.length === 0) return;
  await db
    .insert(schema.deliveredFiles)
    .values(
      files.map((f) => ({
        id: randomUUID(),
        projectId,
        turnId,
        name: f.name,
        url: f.url,
        previewUrl: f.preview ?? null,
        size: f.size,
        contentType: contentTypeOf(f.name),
        description: f.description ?? null,
      })),
    )
    .onConflictDoNothing({ target: schema.deliveredFiles.url });
}

/** A project's files delivered between two instants (a scheduled run's), oldest first, as presented. */
export async function deliveriesBetween(projectId: string, from: Date, to: Date): Promise<DeliveryIndexRow[]> {
  return db
    .select()
    .from(schema.deliveredFiles)
    .where(and(eq(schema.deliveredFiles.projectId, projectId), gte(schema.deliveredFiles.createdAt, from), lte(schema.deliveredFiles.createdAt, to)))
    .orderBy(asc(schema.deliveredFiles.createdAt))
    .limit(20);
}

export async function listDeliveries(projectIds: readonly string[], limit: number): Promise<DeliveryIndexRow[]> {
  if (projectIds.length === 0) return [];
  return db
    .select()
    .from(schema.deliveredFiles)
    .where(inArray(schema.deliveredFiles.projectId, [...projectIds]))
    .orderBy(desc(schema.deliveredFiles.createdAt))
    .limit(limit);
}
