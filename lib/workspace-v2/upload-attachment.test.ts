// A file from the chat (26/10; office files and CSV, spec local 2026-10-26-len-skills): uploaded
// through POST /api/upload under the project's folder, and what comes back is the file the message
// carries (`attachedFiles`). Checked before sending a byte: a kind the chat takes, up to 20 MB.
import { describe, expect, it, vi } from "vitest";

import { ATTACHMENT_ACCEPT, uploadAttachment, uploadChatPhoto } from "./upload-attachment";

const file = (bytes: number, name = "Menú.pdf", type = "application/pdf") => new File([new Uint8Array(bytes)], name, { type });

describe("uploadAttachment", () => {
  it("🔴 uploads a PDF with the project as its folder and returns the file to attach, as before", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ url: "/uploads/uploads/p1/abc123.pdf", size: 2048 })));
    expect(await uploadAttachment(file(2048), "p1", fetchImpl as never)).toEqual({ ok: true, file: { url: "/uploads/uploads/p1/abc123.pdf", name: "Menú.pdf", size: 2048 } });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/upload");
    const form = init.body as FormData;
    expect(form.get("generationId")).toBe("p1");
    expect((form.get("file") as File).type).toBe("application/pdf");
  });

  it("an Excel goes with its kind, whatever type the browser gave it", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ url: "/uploads/uploads/p1/def456.xlsx", size: 4096 })));
    const r = await uploadAttachment(file(4096, "ventas.xlsx", ""), "p1", fetchImpl as never);
    expect(r).toEqual({ ok: true, file: { url: "/uploads/uploads/p1/def456.xlsx", name: "ventas.xlsx", size: 4096, kind: "xlsx" } });
    const form = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as FormData;
    expect((form.get("file") as File).type).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  });

  it("refuses before sending: a kind the chat doesn't take, or over 20 MB; and says when the upload fails", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 500 }));
    expect(await uploadAttachment(file(10, "foto.png", "image/png"), "p1", fetchImpl as never)).toEqual({ ok: false, reason: "not_supported" });
    expect(await uploadAttachment(file(10, "viejo.xls", ""), "p1", fetchImpl as never)).toEqual({ ok: false, reason: "not_supported" });
    expect(await uploadAttachment(file(20 * 1024 * 1024 + 1), "p1", fetchImpl as never)).toEqual({ ok: false, reason: "too_big" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await uploadAttachment(file(10), "p1", fetchImpl as never)).toEqual({ ok: false, reason: "failed" });
  });

  it("the file pickers accept every kind the chat takes", () => {
    for (const ext of [".pdf", ".xlsx", ".xlsm", ".docx", ".pptx", ".csv", ".mp4", ".webm", ".mov"]) expect(ATTACHMENT_ACCEPT).toContain(ext);
  });

  it("a video uploads with its own type and comes back with its kind", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ url: "/uploads/uploads/p1/vid.mov", size: 4096 })));
    const r = await uploadAttachment(file(4096, "clip.mov", ""), "p1", fetchImpl as never);
    expect(r).toEqual({ ok: true, file: { url: "/uploads/uploads/p1/vid.mov", name: "clip.mov", size: 4096, kind: "mov" } });
    const form = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as FormData;
    expect((form.get("file") as File).type).toBe("video/quicktime");
  });

  it("a video over 50 MB is refused before sending", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}"));
    expect(await uploadAttachment(file(50 * 1024 * 1024 + 1, "big.mp4", "video/mp4"), "p1", fetchImpl as never)).toEqual({ ok: false, reason: "too_big" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("uploadChatPhoto", () => {
  const ok = () => vi.fn(async (input: RequestInfo | URL) => (String(input).startsWith("data:") ? fetch(String(input)) : new Response(JSON.stringify({ url: "https://u/p.jpg" }))));

  it("a GIF goes as is, without being reduced", async () => {
    const reduce = vi.fn();
    const fetchImpl = ok();
    expect(await uploadChatPhoto(file(100, "risa.gif", "image/gif"), "p1", { reduce, fetchImpl: fetchImpl as never })).toEqual({ ok: true, image: { url: "https://u/p.jpg" } });
    expect(reduce).not.toHaveBeenCalled();
    const form = (fetchImpl.mock.calls.at(-1) as unknown as [string, RequestInit])[1].body as FormData;
    expect((form.get("file") as File).type).toBe("image/gif");
  });

  it("a JPEG goes reduced", async () => {
    const reduce = vi.fn(async () => ({ dataUrl: "data:image/jpeg;base64,/9j/" }));
    const fetchImpl = ok();
    expect(await uploadChatPhoto(file(100, "foto.jpg", "image/jpeg"), "p1", { reduce, fetchImpl: fetchImpl as never })).toEqual({ ok: true, image: { url: "https://u/p.jpg" } });
    expect(reduce).toHaveBeenCalledTimes(1);
  });

  it("a photo that can't be read is not_supported; a GIF over 5 MB is too_big; a failed upload is failed", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 500 }));
    expect(await uploadChatPhoto(file(100, "rota.png", "image/png"), "p1", { reduce: async () => null, fetchImpl: fetchImpl as never })).toEqual({ ok: false, reason: "not_supported" });
    expect(await uploadChatPhoto(file(5 * 1024 * 1024 + 1, "big.gif", "image/gif"), "p1", { fetchImpl: fetchImpl as never })).toEqual({ ok: false, reason: "too_big" });
    expect(await uploadChatPhoto(file(100, "a.gif", "image/gif"), "p1", { fetchImpl: fetchImpl as never })).toEqual({ ok: false, reason: "failed" });
  });
});
