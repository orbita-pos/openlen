// Las reglas de nombres, tipos y tamaños de Supabase Storage
// (src/storage/limits.ts y validators/mime-type.ts, portadas tal cual).
import { describe, expect, it } from "vitest";

import { StorageError } from "./errors";
import {
  isValidBucketName,
  isValidKey,
  normalizeAllowedMimeTypes,
  parseFileSizeToBytes,
  storageLimits,
  validateMimeType,
} from "./limits";

const lanza = (fn: () => unknown): StorageError => {
  try {
    fn();
  } catch (err) {
    if (err instanceof StorageError) return err;
    throw err;
  }
  throw new Error("no lanzó");
};

describe("nombres", () => {
  it("una clave admite los caracteres seguros de S3 y nada más (como Supabase)", () => {
    expect(isValidKey("u1/foto de perfil (1).png")).toBe(true);
    expect(isValidKey("ñandú.png")).toBe(false);
    expect(isValidKey("")).toBe(false);
  });
  it("un bucket no lleva barras y tiene menos de 101 caracteres", () => {
    expect(isValidBucketName("avatars")).toBe(true);
    expect(isValidBucketName("a/b")).toBe(false);
    expect(isValidBucketName("x".repeat(101))).toBe(false);
  });
});

describe("tipos MIME", () => {
  it("compara el tipo sin sus parámetros y con comodín de subtipo", () => {
    expect(validateMimeType("image/png; charset=binary", ["image/*"])).toBe(true);
    expect(validateMimeType("image/PNG", ["image/png"])).toBe(true);
  });
  it("lo que no está permitido: 415 con su mensaje", () => {
    const e = lanza(() => validateMimeType("text/html", ["image/*"]));
    expect(e).toMatchObject({ httpStatusCode: 415, code: "InvalidMimeType", message: "mime type text/html is not supported" });
  });
  it("normaliza la lista de un bucket y rechaza lo que no es un tipo", () => {
    expect(normalizeAllowedMimeTypes(["image/*", "Image/PNG", "image/png"])).toEqual(["image/*", "image/png"]);
    expect(lanza(() => normalizeAllowedMimeTypes(["imagen"]))).toMatchObject({ httpStatusCode: 415 });
  });
});

describe("tamaños", () => {
  it("parseFileSizeToBytes cuenta en decimal, como Supabase", () => {
    expect(parseFileSizeToBytes("1MB")).toBe(1_000_000);
    expect(parseFileSizeToBytes("1.5kb")).toBe(1500);
    expect(lanza(() => parseFileSizeToBytes("1 MB"))).toMatchObject({
      httpStatusCode: 400,
      message: "Invalid file size format, hint: use 20GB / 20MB / 30KB / 3B",
    });
  });
  it("por defecto, el plan gratis de Supabase: 50 MB por fichero y 1 GB por proyecto", () => {
    expect(storageLimits({})).toEqual({ fileSizeLimit: 50 * 1024 * 1024, projectLimit: 1024 * 1024 * 1024 });
    expect(storageLimits({ PAGES_STORAGE_FILE_SIZE_LIMIT: "1000", PAGES_STORAGE_PROJECT_LIMIT: "5000" })).toEqual({
      fileSizeLimit: 1000,
      projectLimit: 5000,
    });
  });
});
