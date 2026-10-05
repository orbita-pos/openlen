// Borrar un proyecto se lleva sus ficheros (lo engancha lib/backend/teardown.ts).
import { describe, expect, it, vi } from "vitest";

import { MemoryBlobStore } from "./blob-store";
import { purgeProjectStorage } from "./purge";

const vacio = () => new ReadableStream<Uint8Array>({ start: (c) => c.close() });
const OPC = { contentType: "text/plain", cacheControl: "no-cache", maxBytes: 10 };

describe("purgeProjectStorage", () => {
  it("borra todo lo del ref y nada de otro", async () => {
    const s = new MemoryBlobStore();
    await s.put("aaaaaaaaaaaaaaaaaaaa/b/x/v1", vacio(), OPC);
    await s.put("aaaaaaaaaaaaaaaaaaaa/c/y/v2", vacio(), OPC);
    await s.put("bbbbbbbbbbbbbbbbbbbb/b/x/v1", vacio(), OPC);
    await purgeProjectStorage("aaaaaaaaaaaaaaaaaaaa", s);
    expect(s.keys()).toEqual(["bbbbbbbbbbbbbbbbbbbb/b/x/v1"]);
  });

  it("sin almacén (sin R2) no hace nada; un ref que no es un ref, tampoco", async () => {
    await expect(purgeProjectStorage("aaaaaaaaaaaaaaaaaaaa", null)).resolves.toBeUndefined();
    const s = new MemoryBlobStore();
    await s.put("x/1", vacio(), OPC);
    await purgeProjectStorage("", s);
    await purgeProjectStorage("x", s);
    expect(s.keys()).toEqual(["x/1"]);
  });

  it("nunca lanza: el proyecto ya se borró", async () => {
    const roto = { ...new MemoryBlobStore(), deletePrefix: async () => Promise.reject(new Error("R2 caído")) };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(purgeProjectStorage("aaaaaaaaaaaaaaaaaaaa", roto as unknown as MemoryBlobStore)).resolves.toBeUndefined();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});
