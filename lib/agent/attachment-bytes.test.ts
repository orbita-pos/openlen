// @vitest-environment node
//
// The bytes of a PDF the user attached (26/10), for Read. The same doors as a
// photo (lib/agent/fotos-de-la-conversacion.ts): our upload on disk is read
// from disk; anything else is checked by validateUrl first and fetched without
// following redirects, under a size cap. And it has to be a PDF.
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { readAttachmentBytes } from "./attachment-bytes";
import { rutaDeSubidaPropia } from "./fotos-de-la-conversacion";

const ORIGEN = "http://localhost:3007/api/agent";
const DEV = { UPLOADS_DIR: "./public/uploads" };
const PDF = Buffer.from("%PDF-1.7\n…");

describe("readAttachmentBytes — the bytes of an attached PDF", () => {
  it("🔴 a photo path never opens a PDF, and a PDF path only when asked for .pdf", () => {
    expect(rutaDeSubidaPropia("http://localhost:3007/uploads/p1/a.pdf", ORIGEN, DEV)).toBeNull();
    expect(rutaDeSubidaPropia("http://localhost:3007/uploads/p1/a.pdf", ORIGEN, DEV, [".pdf"])).toBe(resolve("./public/uploads", "p1/a.pdf"));
    expect(rutaDeSubidaPropia("http://localhost:3007/uploads/p1/a.jpg", ORIGEN, DEV, [".pdf"])).toBeNull();
  });

  it("our upload on disk is read from disk; another address goes through validateUrl and no redirects", async () => {
    const leer = vi.fn(async () => PDF);
    expect(await readAttachmentBytes("http://localhost:3007/uploads/p1/a.pdf", { origen: ORIGEN, env: DEV, leer })).toEqual(new Uint8Array(PDF));
    expect(leer).toHaveBeenCalledWith(resolve("./public/uploads", "p1/a.pdf"));
    const validate = vi.fn(async () => ({ ok: true as const, value: {} }));
    const fetchImpl = vi.fn(async () => new Response(PDF));
    expect(await readAttachmentBytes("https://cdn.example/uploads/p1/a.pdf", { origen: ORIGEN, env: DEV, validate: validate as never, fetchImpl: fetchImpl as never })).toEqual(new Uint8Array(PDF));
    expect(validate).toHaveBeenCalledWith("https://cdn.example/uploads/p1/a.pdf");
    expect((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].redirect).toBe("error");
  });

  it("🔴 refused: a private address, something that isn't a PDF, a file over the cap, an HTTP error", async () => {
    const no = vi.fn(async () => ({ ok: false as const, error: { kind: "ssrf-blocked", reason: "10.0.0.5" } }));
    const fetchImpl = vi.fn(async () => new Response(PDF));
    expect(await readAttachmentBytes("http://10.0.0.5/a.pdf", { origen: ORIGEN, env: DEV, validate: no as never, fetchImpl: fetchImpl as never })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
    const ok = vi.fn(async () => ({ ok: true as const, value: {} }));
    const html = vi.fn(async () => new Response("<html>"));
    expect(await readAttachmentBytes("https://cdn.example/a.pdf", { origen: ORIGEN, env: DEV, validate: ok as never, fetchImpl: html as never })).toBeNull();
    const big = vi.fn(async () => new Response(Buffer.concat([PDF, Buffer.alloc(32)])));
    expect(await readAttachmentBytes("https://cdn.example/a.pdf", { origen: ORIGEN, env: DEV, validate: ok as never, fetchImpl: big as never, maxBytes: 16 })).toBeNull();
    const e404 = vi.fn(async () => new Response(PDF, { status: 404 }));
    expect(await readAttachmentBytes("https://cdn.example/a.pdf", { origen: ORIGEN, env: DEV, validate: ok as never, fetchImpl: e404 as never })).toBeNull();
    const leerHtml = vi.fn(async () => Buffer.from("<html>"));
    expect(await readAttachmentBytes("http://localhost:3007/uploads/p1/a.pdf", { origen: ORIGEN, env: DEV, leer: leerHtml })).toBeNull();
  });
});
