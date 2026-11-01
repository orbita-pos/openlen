// The PDF preview of an Office deliverable, made by LibreOffice in the turn's box (spec local
// 2026-10-31-len-movil, §5.2): one command, under /tmp, within the budget; anything odd → no preview.
import { describe, expect, it, vi } from "vitest";

import { OFFICE_PREVIEW_KINDS, officePreview } from "./office-preview";

const PDF = new TextEncoder().encode("%PDF-1.7\n...");

function box(o: { exitCode?: number; output?: Uint8Array | null; throws?: boolean } = {}) {
  const files = new Map<string, Uint8Array>();
  const ejecutar = vi.fn(async (command: string, _o?: { timeoutMs?: number }) => {
    if (o.throws) throw new Error("box gone");
    const outdir = /--outdir '([^']+)'/.exec(command)?.[1];
    if (outdir && o.output !== null) files.set(`${outdir}/deck.pdf`, o.output ?? PDF);
    return { stdout: "", stderr: "", exitCode: o.exitCode ?? 0, ficheros: null };
  });
  const readFileBytes = vi.fn(async (path: string) => files.get(path) ?? null);
  return { ejecutar, readFileBytes };
}

describe("officePreview", () => {
  it("converts with soffice into a fresh folder under /tmp and returns the PDF", async () => {
    const t = box();
    const out = await officePreview(t, "/out/deck.pptx", 60_000);
    expect(out && new TextDecoder().decode(out.slice(0, 5))).toBe("%PDF-");
    expect(t.ejecutar).toHaveBeenCalledTimes(1);
    const [command, options] = t.ejecutar.mock.calls[0]!;
    expect(command).toContain("soffice --headless --convert-to pdf --outdir '/tmp/office-preview/");
    expect(command).toContain("'/out/deck.pptx'");
    expect(options).toEqual({ timeoutMs: 60_000 });
    expect(t.readFileBytes.mock.calls[0]![0]).toMatch(/^\/tmp\/office-preview\/[0-9a-f]{8}\/deck\.pdf$/);
  });

  it("quotes a path with a single quote in it", async () => {
    const t = box();
    await officePreview(t, "/out/it's.pptx", 1000);
    expect(t.ejecutar.mock.calls[0]![0]).toContain(`'/out/it'\\''s.pptx'`);
  });

  it("no preview when the command fails", async () => {
    expect(await officePreview(box({ exitCode: 1 }), "/out/deck.pptx", 1000)).toBeNull();
  });

  it("no preview when the PDF is missing", async () => {
    expect(await officePreview(box({ output: null }), "/out/deck.pptx", 1000)).toBeNull();
  });

  it("no preview when the output is not a PDF", async () => {
    expect(await officePreview(box({ output: new TextEncoder().encode("<html>") }), "/out/deck.pptx", 1000)).toBeNull();
  });

  it("no preview when the box throws", async () => {
    expect(await officePreview(box({ throws: true }), "/out/deck.pptx", 1000)).toBeNull();
  });

  it("no preview without a way to read the box, or without time left", async () => {
    const t = box();
    expect(await officePreview({ ejecutar: t.ejecutar }, "/out/deck.pptx", 1000)).toBeNull();
    expect(await officePreview(t, "/out/deck.pptx", 0)).toBeNull();
    expect(t.ejecutar).not.toHaveBeenCalled();
  });

  it("covers the Office kinds and csv", () => {
    expect([...OFFICE_PREVIEW_KINDS]).toEqual(["pptx", "docx", "xlsx", "xlsm", "csv"]);
  });
});
