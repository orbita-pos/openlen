// A PDF from the chat (26/10): uploaded through POST /api/upload under the
// project's folder, and what comes back is the file the message carries
// (`attachedFiles`). Checked before sending a byte: a PDF, up to 20 MB.
import { describe, expect, it, vi } from "vitest";

import { uploadPdf } from "./upload-pdf";

const pdf = (bytes: number, name = "Menú.pdf", type = "application/pdf") => new File([new Uint8Array(bytes)], name, { type });

describe("uploadPdf", () => {
  it("🔴 uploads it with the project as its folder and returns the file to attach", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ url: "/uploads/uploads/p1/abc123.pdf", size: 2048 })));
    expect(await uploadPdf(pdf(2048), "p1", fetchImpl as never)).toEqual({ ok: true, file: { url: "/uploads/uploads/p1/abc123.pdf", name: "Menú.pdf", size: 2048 } });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/upload");
    const form = init.body as FormData;
    expect(form.get("generationId")).toBe("p1");
    expect((form.get("file") as File).type).toBe("application/pdf");
  });

  it("refuses before sending: not a PDF, or over 20 MB; and says when the upload fails", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 500 }));
    expect(await uploadPdf(pdf(10, "foto.png", "image/png"), "p1", fetchImpl as never)).toEqual({ ok: false, reason: "not_pdf" });
    expect(await uploadPdf(pdf(20 * 1024 * 1024 + 1), "p1", fetchImpl as never)).toEqual({ ok: false, reason: "too_big" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await uploadPdf(pdf(10), "p1", fetchImpl as never)).toEqual({ ok: false, reason: "failed" });
  });
});
