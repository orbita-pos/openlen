import { describe, expect, it } from "vitest";

import { folderFor, imagePathFor, uploadEndpointFor } from "./image-paths";

describe("imagePathFor: where an uploaded image goes in the folder", () => {
  it("lower case, without accents, other characters as dashes; the extension it will have", () => {
    expect(imagePathFor("Foto Playa.JPG", new Set(), "webp")).toBe("/img/foto-playa.webp");
    expect(imagePathFor("Ñandú en la playa (2).png", new Set(), "webp")).toBe("/img/nandu-en-la-playa-2.webp");
  });

  it("taken: -2, -3…", () => {
    expect(imagePathFor("Foto Playa.JPG", new Set(["/img/foto-playa.webp"]), "webp")).toBe("/img/foto-playa-2.webp");
    expect(imagePathFor("a.png", new Set(["/img/a.webp", "/img/a-2.webp"]), "webp")).toBe("/img/a-3.webp");
  });

  it("an empty name is «imagen»; another folder when asked", () => {
    expect(imagePathFor("···.gif", new Set(), "gif")).toBe("/img/imagen.gif");
    expect(imagePathFor("Intro.MP4", new Set(), "mp4", "/video")).toBe("/video/intro.mp4");
  });
});

describe("folderFor and uploadEndpointFor", () => {
  it("each kind of media to its folder", () => {
    expect(folderFor("image/jpeg")).toBe("/img");
    expect(folderFor("video/mp4")).toBe("/video");
    expect(folderFor("audio/mpeg")).toBe("/audio");
    expect(folderFor("font/woff2")).toBe("/fonts");
    expect(folderFor("application/pdf")).toBe("/files");
  });

  it("the modal uploads to the folder, optimizing images", () => {
    expect(uploadEndpointFor("p 1")).toBe("/api/projects/p%201/ficheros/upload?optimize=image");
  });
});
