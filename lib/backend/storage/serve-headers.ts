// Las cabeceras de la respuesta de un objeto: las de su `Renderer.setHeaders`
// y `handleDownload` (supabase/storage @ eccef5e7, Apache-2.0,
// src/storage/renderer/renderer.ts) y su `parseRangeHeader` (src/storage/range.ts).
//
// LO NUESTRO, encima de Supabase (Review Focus 1 y 3 de
// plans/len-agente-2026/plan-2-5/d-storage.md):
//   · `X-Content-Type-Options: nosniff` siempre, y `Content-Security-Policy:
//     default-src 'none'; sandbox` en todo lo que puede ejecutar algo (SVG, XML,
//     JS, JSON…): un fichero que sube un visitante es DATO. Supabase sólo pasa
//     `text/html` a `text/plain`; aquí `<ref>.openlen.app` es del mismo sitio
//     que las páginas (openlen.app no está en la Public Suffix List).
//     Sin CSP lo que no ejecuta: imagen raster, audio, vídeo, PDF (el visor de
//     PDF de Chrome no pinta con `sandbox`), texto plano y binario.
//   · Lo privado sale `private`: Cloudflare cachea por extensión (`.png`).

import type { ObjectMetadata } from "./db";
import { StorageError } from "./errors";

export interface ObjectHeaderOptions {
  readonly visibility: "public" | "private";
  /** `?download` (vacío) o `?download=<nombre>`. */
  readonly download?: string;
}

/** Su `normalizeContentType`. */
function normalizeContentType(contentType: string | undefined): string | undefined {
  if (contentType?.toLowerCase().includes("text/html")) return "text/plain";
  return contentType;
}

const INERT = /^(image\/(png|jpeg|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon)|audio\/[\w.+-]+|video\/[\w.+-]+|application\/pdf|text\/plain|application\/octet-stream)$/;

function isInert(contentType: string | undefined): boolean {
  const base = (contentType ?? "").split(";")[0]!.trim().toLowerCase();
  return INERT.test(base);
}

function encodeExtValue(value: string): string {
  return encodeURIComponent(value).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

const HTTP_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

function toFilenameFallback(value: string): string {
  const fallback = value.replace(/[^\x20-\x7e]|["\\]/gu, "_");
  return HTTP_TOKEN.test(fallback) ? fallback : `"${fallback}"`;
}

export function objectHeaders(meta: Partial<ObjectMetadata>, o: ObjectHeaderOptions): Headers {
  const h = new Headers();
  h.set("Accept-Ranges", "bytes");
  const type = normalizeContentType(meta.mimetype);
  if (type) h.set("Content-Type", type);
  h.set("X-Content-Type-Options", "nosniff");
  // Por el tipo GUARDADO: un HTML que sale como text/plain sigue llevando sandbox.
  if (!isInert(meta.mimetype)) h.set("Content-Security-Policy", "default-src 'none'; sandbox");
  if (meta.eTag) h.set("ETag", meta.eTag);
  h.set("X-Robots-Tag", "none");
  if (meta.lastModified) {
    const d = new Date(meta.lastModified);
    if (!Number.isNaN(d.getTime())) h.set("Last-Modified", d.toUTCString());
  }
  const cc = meta.cacheControl || "no-cache";
  h.set("Cache-Control", o.visibility === "private" ? `private, ${cc}` : cc);
  if (o.download !== undefined) {
    h.set(
      "Content-Disposition",
      o.download === "" ? "attachment;" : `attachment; filename=${toFilenameFallback(o.download)}; filename*=UTF-8''${encodeExtValue(o.download)}`,
    );
  }
  return h;
}

export interface ByteRange {
  readonly fromByte: number;
  readonly toByte: number;
  readonly size: number;
}

function invalidRange(): StorageError {
  return new StorageError({ code: "InvalidRange", error: "invalid_range", httpStatusCode: 416, message: "invalid range provided" }).withStatusCode(416);
}

function isValidRange(fromByte: number, toByte: number, objectSize: number): boolean {
  return Number.isSafeInteger(fromByte) && Number.isSafeInteger(toByte) && fromByte >= 0 && toByte >= fromByte && fromByte < objectSize;
}

/** Su `parseRangeHeader`. */
export function parseRangeHeader(range: string, fileSize: number): ByteRange {
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || fileSize <= 0) throw invalidRange();
  const [, startValue, endValue] = match;
  if (!startValue && !endValue) throw invalidRange();
  if (!startValue) {
    const suffix = Number(endValue);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) throw invalidRange();
    const fromByte = Math.max(fileSize - suffix, 0);
    return { fromByte, toByte: fileSize - 1, size: fileSize - fromByte };
  }
  const fromByte = Number(startValue);
  const toByte = endValue ? Number(endValue) : fileSize - 1;
  if (!isValidRange(fromByte, toByte, fileSize)) throw invalidRange();
  const clamped = Math.min(toByte, fileSize - 1);
  return { fromByte, toByte: clamped, size: clamped - fromByte + 1 };
}
