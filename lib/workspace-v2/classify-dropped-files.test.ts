// Files dropped or pasted on the chat (spec local 2026-10-27-chat-drop-and-images, Part A): each
// one goes where the `+` would put it — a photo, a file Len reads or a video — and what the chat
// doesn't take, or doesn't fit, is named, never lost in silence.
import { describe, expect, it } from "vitest";

import { classifyDroppedFiles } from "./classify-dropped-files";

const MB = 1024 * 1024;
const file = (name: string, type: string, bytes = 10) => {
  const f = new File([new Uint8Array(1)], name, { type });
  Object.defineProperty(f, "size", { value: bytes });
  return f;
};
const names = (fs: readonly File[]) => fs.map((f) => f.name);

describe("classifyDroppedFiles", () => {
  it("routes photos, documents and videos, in drop order", () => {
    const r = classifyDroppedFiles(
      [file("a.png", "image/png"), file("b.pdf", "application/pdf"), file("c.mp4", "video/mp4"), file("d.xlsx", "")],
      { photos: 4, files: 4 },
    );
    expect(names(r.photos)).toEqual(["a.png"]);
    expect(names(r.files)).toEqual(["b.pdf", "c.mp4", "d.xlsx"]);
    expect(r.rejected).toEqual([]);
  });

  it("rejects what the chat doesn't take, naming it", () => {
    const r = classifyDroppedFiles([file("x.zip", "application/zip"), file("y.exe", ""), file("z.heic", "image/heic")], { photos: 4, files: 4 });
    expect(r.rejected).toEqual([
      { name: "x.zip", reason: "not_supported" },
      { name: "y.exe", reason: "not_supported" },
      { name: "z.heic", reason: "not_supported" },
    ]);
  });

  it("too big: a GIF over 5 MB, a PDF over 20 MB, a video over 50 MB; a 12 MB JPEG is a photo (it gets reduced)", () => {
    const r = classifyDroppedFiles(
      [
        file("big.gif", "image/gif", 6 * MB),
        file("big.pdf", "application/pdf", 21 * MB),
        file("big.webm", "video/webm", 51 * MB),
        file("camera.jpg", "image/jpeg", 12 * MB),
      ],
      { photos: 4, files: 4 },
    );
    expect(r.rejected).toEqual([
      { name: "big.gif", reason: "too_big" },
      { name: "big.pdf", reason: "too_big" },
      { name: "big.webm", reason: "too_big" },
    ]);
    expect(names(r.photos)).toEqual(["camera.jpg"]);
  });

  it("limit: only what fits, the rest named as limit", () => {
    const photos = [1, 2, 3, 4, 5, 6].map((i) => file(`p${i}.webp`, "image/webp"));
    const r = classifyDroppedFiles(photos, { photos: 3, files: 4 });
    expect(names(r.photos)).toEqual(["p1.webp", "p2.webp", "p3.webp"]);
    expect(r.rejected).toEqual([4, 5, 6].map((i) => ({ name: `p${i}.webp`, reason: "limit" })));
  });

  it("a video counts as a file", () => {
    const r = classifyDroppedFiles([file("v.mov", ""), file("w.pdf", "application/pdf")], { photos: 4, files: 1 });
    expect(names(r.files)).toEqual(["v.mov"]);
    expect(r.rejected).toEqual([{ name: "w.pdf", reason: "limit" }]);
  });
});
