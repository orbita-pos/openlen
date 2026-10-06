// El almacén de R2 (Jesús, 04/10) sin red: un doble de `send` que apunta
// cada comando de S3 que se mandaría, y guarda lo subido para devolverlo.
import { describe, expect, it, vi } from "vitest";

import { StorageError, storageErrorResponse } from "./errors";
import { pageBlobStore, R2BlobStore, type S3Send } from "./r2-blob-store";

const MiB = 1024 * 1024;

function falso() {
  const calls: { name: string; input: Record<string, unknown> }[] = [];
  const objects = new Map<string, Uint8Array>();
  const parts = new Map<number, Uint8Array>();
  const send: S3Send = async (name, input) => {
    calls.push({ name, input });
    switch (name) {
      case "PutObject":
        objects.set(input.Key as string, input.Body as Uint8Array);
        return { ETag: '"put"' };
      case "CreateMultipartUpload":
        parts.clear();
        return { UploadId: "up-1" };
      case "UploadPart":
        parts.set(input.PartNumber as number, input.Body as Uint8Array);
        return { ETag: `"p${input.PartNumber as number}"` };
      case "CompleteMultipartUpload": {
        const all = [...parts.entries()].sort((a, b) => a[0] - b[0]).map(([, b]) => b);
        const size = all.reduce((n, b) => n + b.byteLength, 0);
        const out = new Uint8Array(size);
        let at = 0;
        for (const b of all) {
          out.set(b, at);
          at += b.byteLength;
        }
        objects.set(input.Key as string, out);
        return { ETag: '"multi-2"' };
      }
      case "AbortMultipartUpload":
        return {};
      case "GetObject": {
        const b = objects.get(input.Key as string);
        if (!b) throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });
        const m = typeof input.Range === "string" ? /^bytes=(\d+)-(\d+)$/.exec(input.Range) : null;
        const slice = m ? b.subarray(Number(m[1]), Number(m[2]) + 1) : b;
        return {
          Body: new Response(new Uint8Array(slice)).body,
          ContentLength: slice.byteLength,
          ...(m ? { ContentRange: `bytes ${m[1]}-${m[2]}/${b.byteLength}` } : {}),
        };
      }
      case "DeleteObjects":
        for (const o of (input.Delete as { Objects: { Key: string }[] }).Objects) objects.delete(o.Key);
        return {};
      case "CopyObject":
        objects.set(input.Key as string, objects.get(decodeURIComponent((input.CopySource as string).split("/").slice(1).join("/")))!);
        return {};
      case "ListObjectsV2": {
        // Como S3: el token es la última clave dada, no una posición.
        const after = (input.ContinuationToken as string | undefined) ?? "";
        const keys = [...objects.keys()].filter((k) => k.startsWith(input.Prefix as string) && k > after).sort();
        const page = keys.slice(0, 2);
        const next = keys.length > 2 ? page.at(-1) : undefined;
        return { Contents: page.map((Key) => ({ Key })), IsTruncated: Boolean(next), NextContinuationToken: next };
      }
      default:
        throw new Error(`comando inesperado ${name}`);
    }
  };
  return { calls, objects, send, names: () => calls.map((c) => c.name) };
}

// Un trozo por `pull`: un error en `start` tiraría lo ya encolado.
const flujo = (sizes: number[], fallaAlFinal = false) => {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(c) {
      if (i < sizes.length) {
        c.enqueue(new Uint8Array(sizes[i]!).fill(i + 1));
        i++;
      } else if (fallaAlFinal) c.error(new Error("se cortó"));
      else c.close();
    },
  });
};
const OPC = { contentType: "image/png", cacheControl: "max-age=3600", maxBytes: 50 * MiB };

describe("R2BlobStore.put", () => {
  it("un fichero pequeño: un solo PutObject con su tipo y su caché", async () => {
    const f = falso();
    const r = await new R2BlobStore({ send: f.send, bucket: "b" }).put("ref/x/a.png/v1", flujo([10, 5]), OPC);
    expect(r).toEqual({ size: 15, eTag: '"put"' });
    expect(f.names()).toEqual(["PutObject"]);
    expect(f.calls[0]!.input).toMatchObject({ Bucket: "b", Key: "ref/x/a.png/v1", ContentType: "image/png", CacheControl: "max-age=3600", ContentLength: 15 });
  });

  it("uno de 20 MiB: por partes de 8 MiB (3 UploadPart + Complete)", async () => {
    const f = falso();
    const r = await new R2BlobStore({ send: f.send, bucket: "b" }).put("k", flujo([5 * MiB, 5 * MiB, 5 * MiB, 5 * MiB]), OPC);
    expect(r.size).toBe(20 * MiB);
    expect(f.names()).toEqual(["CreateMultipartUpload", "UploadPart", "UploadPart", "UploadPart", "CompleteMultipartUpload"]);
    expect(f.calls.filter((c) => c.name === "UploadPart").map((c) => (c.input.Body as Uint8Array).byteLength)).toEqual([8 * MiB, 8 * MiB, 4 * MiB]);
    expect((f.calls.at(-1)!.input.MultipartUpload as { Parts: unknown[] }).Parts).toEqual([
      { ETag: '"p1"', PartNumber: 1 },
      { ETag: '"p2"', PartNumber: 2 },
      { ETag: '"p3"', PartNumber: 3 },
    ]);
    expect(f.objects.get("k")!.byteLength).toBe(20 * MiB);
  });

  it("pasarse de maxBytes a mitad: AbortMultipartUpload y EntityTooLarge", async () => {
    const f = falso();
    const err = await new R2BlobStore({ send: f.send, bucket: "b" })
      .put("k", flujo([9 * MiB, 9 * MiB]), { ...OPC, maxBytes: 10 * MiB })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StorageError);
    expect(err).toMatchObject({ httpStatusCode: 413 });
    expect(f.names()).toContain("AbortMultipartUpload");
    expect(f.names()).not.toContain("CompleteMultipartUpload");
    expect(f.objects.has("k")).toBe(false);
  });

  it("pasarse siendo pequeño: nada sale hacia R2", async () => {
    const f = falso();
    await expect(new R2BlobStore({ send: f.send, bucket: "b" }).put("k", flujo([10]), { ...OPC, maxBytes: 5 })).rejects.toMatchObject({ httpStatusCode: 413 });
    expect(f.calls).toEqual([]);
  });

  it("el cuerpo que se corta con la subida por partes empezada: se aborta", async () => {
    const f = falso();
    await expect(new R2BlobStore({ send: f.send, bucket: "b" }).put("k", flujo([9 * MiB], true), OPC)).rejects.toThrow("se cortó");
    expect(f.names()).toEqual(["CreateMultipartUpload", "UploadPart", "AbortMultipartUpload"]);
  });
});

describe("R2BlobStore: bajar, copiar, borrar", () => {
  it("get entero y con rango; lo que no está, null", async () => {
    const f = falso();
    const s = new R2BlobStore({ send: f.send, bucket: "b" });
    await s.put("k", flujo([3, 2]), OPC);
    const all = await s.get("k");
    expect(all!.size).toBe(5);
    expect([...new Uint8Array(await new Response(all!.body).arrayBuffer())]).toEqual([1, 1, 1, 2, 2]);
    const part = await s.get("k", { start: 2, end: 3 });
    expect(part!.size).toBe(5);
    expect([...new Uint8Array(await new Response(part!.body).arrayBuffer())]).toEqual([1, 2]);
    expect(f.calls.at(-1)!.input.Range).toBe("bytes=2-3");
    expect(await s.get("no")).toBeNull();
  });

  it("copy con CopySource codificado; delete por lotes de 1000; deletePrefix pagina", async () => {
    const f = falso();
    const s = new R2BlobStore({ send: f.send, bucket: "b" });
    await s.put("ref/a/foto de ñu.png/v1", flujo([1]), OPC);
    await s.copy("ref/a/foto de ñu.png/v1", "ref/a/copia.png/v2");
    expect(f.calls.at(-1)!.input.CopySource).toBe("b/ref/a/foto%20de%20%C3%B1u.png/v1");
    expect(f.objects.has("ref/a/copia.png/v2")).toBe(true);

    await s.delete(Array.from({ length: 1500 }, (_, i) => `x/${i}`));
    expect(f.calls.filter((c) => c.name === "DeleteObjects").map((c) => (c.input.Delete as { Objects: unknown[] }).Objects.length)).toEqual([1000, 500]);

    await s.put("ref/b/3", flujo([1]), OPC);
    await s.put("otro/1", flujo([1]), OPC);
    expect(await s.deletePrefix("ref/")).toBe(3);
    expect([...f.objects.keys()]).toEqual(["otro/1"]);
  });
});

describe("R2BlobStore: el bucket de R2 que no existe o al que el token no llega", () => {
  // La forma de los errores de @aws-sdk/client-s3: `name` y `$metadata`.
  const s3Error = (name: string, httpStatusCode: number) => Object.assign(new Error(name), { name, $metadata: { httpStatusCode } });
  const failing = (err: Error): S3Send => async () => {
    throw err;
  };

  it("sin bucket: ni «no encontrado» al bajar ni un 500 sin forma al subir; 503 que dice qué falta", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const s = new R2BlobStore({ send: failing(s3Error("NoSuchBucket", 404)), bucket: "openlen-page-storage" });
    const got = await s.get("k").catch((e: unknown) => e);
    expect(got).toBeInstanceOf(StorageError);
    const res = storageErrorResponse(got);
    expect(res.status).toBe(503);
    expect((await res.json()).message).toBe("Storage is not available on this server: its storage bucket does not exist");
    await expect(s.put("k", flujo([1]), OPC)).rejects.toMatchObject({ userStatusCode: 503 });
    await expect(s.copy("a", "b")).rejects.toMatchObject({ userStatusCode: 503 });
    // Al operador, en el registro: qué bucket y qué hacer.
    expect(String(log.mock.calls[0]![0])).toContain("«openlen-page-storage» no existe");
    expect(String(log.mock.calls[0]![0])).toContain("PAGES_BACKEND_RUNBOOK.md §4b");
    log.mockRestore();
  });

  it("el token sin acceso al bucket (403): el mismo 503, que lo dice", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const s = new R2BlobStore({ send: failing(s3Error("AccessDenied", 403)), bucket: "openlen-page-storage" });
    const res = storageErrorResponse(await s.put("k", flujo([1]), OPC).catch((e: unknown) => e));
    expect(res.status).toBe(503);
    expect((await res.json()).message).toBe("Storage is not available on this server: it has no access to its storage bucket");
    expect(String(log.mock.calls[0]![0])).toContain("añádelo al token de la app");
    log.mockRestore();
  });

  it("un objeto que no está sigue siendo null, y el 404 sin nombre de un HEAD también", async () => {
    expect(await new R2BlobStore({ send: failing(s3Error("NoSuchKey", 404)), bucket: "b" }).get("k")).toBeNull();
    expect(await new R2BlobStore({ send: failing(s3Error("NotFound", 404)), bucket: "b" }).get("k")).toBeNull();
  });
});

describe("pageBlobStore", () => {
  it("sin credenciales de R2: null (Storage contesta 503, no se finge)", () => {
    expect(pageBlobStore({})).toBeNull();
    expect(pageBlobStore({ R2_ACCOUNT_ID: "a", R2_ACCESS_KEY: "b" })).toBeNull();
  });
  it("con credenciales: un R2BlobStore sobre su bucket (por defecto openlen-page-storage)", () => {
    const s = pageBlobStore({ R2_ACCOUNT_ID: "a", R2_ACCESS_KEY: "b", R2_SECRET_KEY: "c" });
    expect(s).toBeInstanceOf(R2BlobStore);
    expect((s as R2BlobStore).bucket).toBe("openlen-page-storage");
    expect((pageBlobStore({ R2_ACCOUNT_ID: "a", R2_ACCESS_KEY: "b", R2_SECRET_KEY: "c", PAGES_STORAGE_R2_BUCKET: "otro" }) as R2BlobStore).bucket).toBe("otro");
  });
});
