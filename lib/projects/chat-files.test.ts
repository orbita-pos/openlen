import { describe, expect, it } from "vitest";

import { attachmentNote, attachmentPath, isVideoFile, kindFromName, kindOf, videoKindFromMime, videoKindFromName, type AttachedFile } from "./chat-files";

describe("attached files' kinds (spec local 2026-10-26-len-skills, §4.8)", () => {
  it("knows the office formats and CSV by their extension", () => {
    expect(kindFromName("ventas.XLSX")).toBe("xlsx");
    expect(kindFromName("macro.xlsm")).toBe("xlsm");
    expect(kindFromName("carta.docx")).toBe("docx");
    expect(kindFromName("deck.pptx")).toBe("pptx");
    expect(kindFromName("lista.csv")).toBe("csv");
    expect(kindFromName("menu.pdf")).toBe("pdf");
    expect(kindFromName("viejo.xls")).toBeNull();
    expect(kindFromName("foto.png")).toBeNull();
  });

  it("an old row without kind is a pdf", () => {
    const old: AttachedFile = { url: "https://cdn/uploads/p1/abc.pdf", name: "menu.pdf", size: 1 };
    const sheet: AttachedFile = { url: "https://cdn/uploads/p1/abc.xlsx", name: "ventas.xlsx", size: 1, kind: "xlsx" };
    expect(kindOf(old)).toBe("pdf");
    expect(kindOf(sheet)).toBe("xlsx");
  });

  it("keeps the file's extension in its path", () => {
    expect(attachmentPath({ url: "https://cdn/uploads/p1/abc123.xlsx", name: "Ventas marzo.xlsx", kind: "xlsx" })).toBe("/.openlen/attachments/abc123/Ventas-marzo.xlsx");
    expect(attachmentPath({ url: "https://cdn/uploads/p1/abc123.csv", name: "lista", kind: "csv" })).toBe("/.openlen/attachments/abc123/lista.csv");
  });

  it("the note names the type; a PDF's is the same as before", () => {
    expect(attachmentNote({ url: "https://cdn/uploads/p1/abc123.xlsx", name: "ventas.xlsx", size: 12_288, kind: "xlsx" })).toBe("[Attached file: /.openlen/attachments/abc123/ventas.xlsx (XLSX, 12KB)]");
    expect(attachmentNote({ url: "https://cdn/uploads/p1/abc123.pdf", name: "menu.pdf", size: 2048 })).toBe("[Attached file: /.openlen/attachments/abc123/menu.pdf (PDF, 2KB)]");
  });
});

describe("an attached video (spec local 2026-10-27-chat-drop-and-images, Part A)", () => {
  it("knows a video by its name or its type, and it is not a kind Read takes", () => {
    expect(videoKindFromName("clip.MP4")).toBe("mp4");
    expect(videoKindFromName("a.mov")).toBe("mov");
    expect(videoKindFromName("a.webm")).toBe("webm");
    expect(videoKindFromName("a.pdf")).toBeNull();
    expect(videoKindFromMime("video/quicktime")).toBe("mov");
    expect(videoKindFromMime("image/png")).toBeNull();
    expect(kindFromName("clip.mp4")).toBeNull();
    expect(isVideoFile({ kind: "mp4" })).toBe(true);
    expect(isVideoFile({ kind: "pdf" })).toBe(false);
    expect(isVideoFile({})).toBe(false);
  });

  it("tells Len the video's URL and that he can't watch it", () => {
    expect(attachmentNote({ url: "https://uploads.openlen.com/uploads/p1/ab.mp4", name: "hero.mp4", size: 3_250_000, kind: "mp4" })).toBe(
      "[Attached video: https://uploads.openlen.com/uploads/p1/ab.mp4 (MP4, 3.1MB). You can't watch it; to put it on the page, use this URL in a <video> element.]",
    );
  });
});
