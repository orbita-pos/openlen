// Nombres, tipos y tamaños, como Supabase Storage (supabase/storage @ eccef5e7,
// Apache-2.0): src/storage/limits.ts y src/storage/validators/mime-type.ts,
// copiados. Lo nuestro son los límites por defecto (los del plan gratis de
// Supabase) y que salen del entorno.

import { ERRORS } from "./errors";

export const MAX_OBJECTS_PER_REQUEST = 1000;

const VALID_OBJECT_KEY = /^[A-Za-z0-9_/!.*'() &$=@;:+,?-]*$/;
const VALID_BUCKET_NAME = /^[A-Za-z0-9_!.*'() &$=@;:+,?-]*$/;

export function isValidKey(key: string): boolean {
  return key.length > 0 && VALID_OBJECT_KEY.test(key);
}

export function isValidBucketName(bucketName: string): boolean {
  return bucketName.length > 0 && bucketName.length < 101 && VALID_BUCKET_NAME.test(bucketName);
}

export function mustBeValidKey(key?: string): asserts key is string {
  if (!key || !isValidKey(key)) throw ERRORS.InvalidKey(key || "");
}

export function mustBeValidBucketName(name?: string): asserts name is string {
  if (!name || !isValidBucketName(name)) throw ERRORS.InvalidBucketName();
}

/** Un trozo de la ruta, decodificado; un `%` mal formado es una clave que no
 *  vale (400), no un error del servidor. */
export function decodePathParam(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    throw ERRORS.InvalidKey(raw);
  }
}

export function isEmptyFolder(object: string): boolean {
  return object.endsWith(".emptyFolderPlaceholder");
}

export function parseFileSizeToBytes(valueWithUnit: string): number {
  const valuesRegex = /(^[0-9]+(?:\.[0-9]+)?)(gb|mb|kb|b)$/i;
  const m = valuesRegex.exec(valueWithUnit);
  if (!m) throw ERRORS.InvalidFileSizeLimit();
  const value = parseFloat(m[1]!);
  switch (m[2]!.toUpperCase()) {
    case "GB":
      return Math.round(value * 1e9);
    case "MB":
      return Math.round(value * 1e6);
    case "KB":
      return Math.round(value * 1000);
    default:
      return Math.round(value);
  }
}

// RFC 9110 5.6.2, 5.6.4 y 5.6.6: token, quoted-string y parámetros.
const TOKEN = "[!#$%&'*+.^_`|~0-9A-Za-z-]+";
const QUOTED_STRING = String.raw`"(?:[\t\x20\x21\x23-\x5b\x5d-\x7e\x80-\xff]|\\[\t\x20-\x7e\x80-\xff])*"`;
const MEDIA_TYPE = new RegExp(String.raw`^[\t ]*(${TOKEN})/(${TOKEN})[\t ]*`);
const PARAMETER = new RegExp(String.raw`;[\t ]*(?:${TOKEN}=(?:${TOKEN}|${QUOTED_STRING})[\t ]*)?`, "y");

function parseMediaType(mimeType: string, allowSubtypeWildcard = false): string | undefined {
  const match = MEDIA_TYPE.exec(mimeType);
  if (!match) return undefined;
  const type = match[1]!.toLowerCase();
  const subtype = match[2]!.toLowerCase();
  if (type.includes("*") || (subtype.includes("*") && !(allowSubtypeWildcard && subtype === "*"))) return undefined;
  let offset = match[0].length;
  while (offset < mimeType.length) {
    PARAMETER.lastIndex = offset;
    if (!PARAMETER.test(mimeType)) return undefined;
    offset = PARAMETER.lastIndex;
  }
  return `${type}/${subtype}`;
}

export function normalizeAllowedMimeTypes(mimeTypes: readonly string[]): string[] {
  const normalized = new Set<string>();
  for (const mimeType of mimeTypes) {
    const parsed = mimeType.length <= 1000 ? parseMediaType(mimeType, true) : undefined;
    if (!parsed) throw ERRORS.InvalidMimeType(mimeType);
    normalized.add(parsed);
  }
  return [...normalized];
}

export function validateMimeType(mimeType: string, allowedMimeTypes: readonly string[]): true {
  const requested = parseMediaType(mimeType);
  if (!requested) throw ERRORS.InvalidMimeType(mimeType);
  const wildcard = requested.slice(0, requested.indexOf("/") + 1) + "*";
  for (const allowed of allowedMimeTypes) {
    if (allowed === requested || allowed === wildcard) return true;
    const parsed = parseMediaType(allowed, true);
    if (parsed === requested || parsed === wildcard) return true;
  }
  throw ERRORS.InvalidMimeType(mimeType);
}

export interface StorageLimits {
  /** Bytes por fichero (su `uploadFileSizeLimit`). */
  readonly fileSizeLimit: number;
  /** Bytes de todos los ficheros de un proyecto. */
  readonly projectLimit: number;
}

const MiB = 1024 * 1024;

function positiveInt(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/** Por defecto, el plan gratis de Supabase: 50 MB por fichero, 1 GB en total. */
export function storageLimits(env: Record<string, string | undefined> = process.env): StorageLimits {
  return {
    fileSizeLimit: positiveInt(env.PAGES_STORAGE_FILE_SIZE_LIMIT, 50 * MiB),
    projectLimit: positiveInt(env.PAGES_STORAGE_PROJECT_LIMIT, 1024 * MiB),
  };
}
