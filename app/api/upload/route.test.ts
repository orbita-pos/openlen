// @vitest-environment node
//
// A PDF for Len (26/10): the chat uploads it here and Len reads it with Read.
// Stored as it comes, like a video, under the project's folder; only a real PDF
// (it has to start with "%PDF-") and up to 20 MB.
import { beforeEach, describe, expect, it, vi } from "vitest";

const uploads = vi.hoisted(() => [] as { key: string; contentType: string; body: Buffer }[]);
vi.mock("@/lib/movil/quien", () => ({ usuarioDeLaPeticion: async () => "u1" }));
vi.mock("@/lib/movil/cors", () => ({ paraLaApp: (h: unknown) => h, respuestaPrevia: () => new Response(null) }));
vi.mock("@/lib/rate-limit", () => ({
  consumeToken: () => ({ allowed: true }),
  RATE_LIMITS: { upload: {}, uploadVideo: {}, uploadPdf: {} },
  rateLimitedResponse: () => new Response("slow", { status: 429 }),
}));
vi.mock("@/lib/storage", () => ({
  getStorage: () => ({
    upload: async (a: { key: string; contentType: string; body: Buffer }) => (uploads.push(a), { url: `/uploads/${a.key}`, size: a.body.length }),
  }),
}));

import { POST } from "./route";

const send = (file: File, generationId = "p1") => {
  const form = new FormData();
  form.set("file", file);
  form.set("generationId", generationId);
  return POST(new Request("http://localhost/api/upload", { method: "POST", body: form }));
};

beforeEach(() => {
  uploads.length = 0;
});

describe("POST /api/upload — a PDF", () => {
  it("🔴 a PDF is stored as it comes, under the project's folder, and its URL comes back", async () => {
    const res = await send(new File([Buffer.from("%PDF-1.7\nhola")], "Menú del día.pdf", { type: "application/pdf" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string; key: string; size: number; variants: unknown[] };
    expect(uploads).toHaveLength(1);
    expect(uploads[0]!.contentType).toBe("application/pdf");
    expect(uploads[0]!.key).toMatch(/^uploads\/p1\/[0-9a-f]{16}\.pdf$/);
    expect(body).toEqual({ url: `/uploads/${uploads[0]!.key}`, key: uploads[0]!.key, size: 13, variants: [] });
  });

  it("something that says it's a PDF and isn't, or one over 20 MB, is refused", async () => {
    const fake = await send(new File([Buffer.from("<html>")], "x.pdf", { type: "application/pdf" }));
    expect(fake.status).toBe(415);
    const big = await send(new File([Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(20 * 1024 * 1024)])], "big.pdf", { type: "application/pdf" }));
    expect(big.status).toBe(413);
    expect(uploads).toHaveLength(0);
  });
});
