// FILES IN AND OUT OF A TOOL (spec local 2026-11-04-herramientas-hechas-por-len, §4.4, §4.6). In: what the person
// picks in OpenLen's own picker (the workspace's `<input type="file">`, never the tool's frame) — the only files a job
// gets, so «what the person uploaded» holds mechanically and a tool can't hand a job its visitors' data. Out: a file a
// tool made in the frame (a PDF of today's bookings, made in the browser as §4.6 asks for visitor data), delivered to
// the same private store as Len's `present` and a job's `out/`, under the tool project.
import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { MAX_DELIVERABLE_BYTES } from "@/lib/agent/skills/present";
import { MAX_FILE_BYTES } from "@/lib/files/limits";

import type { JobUpload } from "./jobs/types";

export const UPLOAD_MAX_BYTES = MAX_FILE_BYTES;
export const UPLOADS_PER_PICK = 8;

const u = schema.toolUploads;
const hex16 = () => globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 16);

/** Only a file's own name, without folders or characters a path could misread. */
export function ownName(name: string): string {
  return (
    (name.split(/[\\/]/).pop() ?? "")
      .replace(/[^\p{L}\p{N}._ -]/gu, "-")
      .replace(/^[.-]+/, "")
      .slice(0, 100) || "file"
  );
}

export async function saveToolUpload(
  personId: string,
  toolProjectId: string,
  file: { readonly name: string; readonly bytes: Uint8Array; readonly contentType: string },
): Promise<{ id: string; name: string; size: number; contentType: string }> {
  if (file.bytes.byteLength === 0) throw new Error("empty");
  if (file.bytes.byteLength > UPLOAD_MAX_BYTES) throw new Error("too_large");
  const { putBlob, makePointer } = await import("@/lib/files/blob");
  const ref = await putBlob(file.bytes);
  const row = {
    id: `up-${hex16()}`,
    personId,
    toolProjectId,
    name: ownName(file.name),
    size: file.bytes.byteLength,
    contentType: file.contentType.slice(0, 100) || "application/octet-stream",
    pointer: makePointer(ref),
  };
  await db.insert(u).values(row);
  return { id: row.id, name: row.name, size: row.size, contentType: row.contentType };
}

/** The person's own uploads among `ids` — another person's ids come back as nothing. */
export async function uploadsOf(personId: string, ids: readonly string[]): Promise<JobUpload[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: u.id, name: u.name, size: u.size })
    .from(u)
    .where(and(eq(u.personId, personId), inArray(u.id, [...ids])));
  return rows;
}

/** An upload's name and bytes, for the job runner. */
export async function readToolUpload(id: string): Promise<{ name: string; bytes: Uint8Array } | null> {
  const [row] = await db.select({ name: u.name, pointer: u.pointer }).from(u).where(eq(u.id, id)).limit(1);
  if (!row) return null;
  const { getBlob } = await import("@/lib/files/blob");
  return { name: row.name, bytes: await getBlob(row.pointer) };
}

/** A file a tool delivers: the private store, under the tool project, served to whoever can open that project. */
export async function deliverFromTool(
  toolProjectId: string,
  file: { readonly name: string; readonly contentType: string; readonly bytes: Uint8Array },
): Promise<{ url: string }> {
  if (file.bytes.byteLength > MAX_DELIVERABLE_BYTES) throw new Error("too_large");
  const [{ deliveryStore }, { deliverableLocation }] = await Promise.all([import("@/lib/agent/skills/deliveries"), import("@/lib/agent/skills/present")]);
  const store = deliveryStore();
  if (!store) throw new Error("no_store");
  const where = deliverableLocation(toolProjectId, `deliver-${hex16()}`, ownName(file.name), hex16().slice(0, 8));
  await store.put(where.key, file.bytes, file.contentType.slice(0, 100) || "application/octet-stream");
  return { url: where.url };
}
