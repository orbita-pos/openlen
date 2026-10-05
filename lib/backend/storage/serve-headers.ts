// Las cabeceras de la respuesta de un objeto: las de su `Renderer.setHeaders`
// (supabase/storage @ eccef5e7, src/storage/renderer/renderer.ts).

import type { ObjectMetadata } from "./db";

export interface ObjectHeaderOptions {
  readonly visibility: "public" | "private";
  /** `?download` (vacío) o `?download=<nombre>`. */
  readonly download?: string;
}

export function objectHeaders(meta: Partial<ObjectMetadata>, _o: ObjectHeaderOptions): Headers {
  const h = new Headers();
  h.set("Accept-Ranges", "bytes");
  if (meta.mimetype) h.set("Content-Type", meta.mimetype);
  if (meta.eTag) h.set("ETag", meta.eTag);
  h.set("X-Robots-Tag", "none");
  if (meta.lastModified) {
    const d = new Date(meta.lastModified);
    if (!Number.isNaN(d.getTime())) h.set("Last-Modified", d.toUTCString());
  }
  if (meta.cacheControl) h.set("Cache-Control", meta.cacheControl);
  return h;
}
