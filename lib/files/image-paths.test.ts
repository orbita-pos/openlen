import { describe, expect, it } from "vitest";

import { folderFor, imagePathFor, uploadEndpointFor, workspaceSrc } from "./image-paths";

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

// F7 (12/11): the page names a folder file by its path, and openlen.com does not serve that path.
describe("workspaceSrc: where the workspace paints a photo from", () => {
  it("a file of the project's folder → the folder's route, with the path encoded", () => {
    expect(workspaceSrc("p1", "/img/a.webp")).toBe("/api/projects/p1/ficheros/raw?ruta=%2Fimg%2Fa.webp");
    expect(workspaceSrc("p 1", "/img/mi foto.png")).toBe("/api/projects/p%201/ficheros/raw?ruta=%2Fimg%2Fmi%20foto.png");
  });

  it("a web address, a protocol-relative one, a data or blob address → as it is", () => {
    for (const url of ["https://cdn.example/b.png", "//cdn.example/b.png", "data:image/png;base64,AAAA", "blob:https://openlen.com/1"]) {
      expect(workspaceSrc("p1", url)).toBe(url);
    }
  });

  it("our own disk uploads in development and OpenLen's own routes are not folder files", () => {
    expect(workspaceSrc("p1", "/uploads/p1/a.jpg")).toBe("/uploads/p1/a.jpg");
    expect(workspaceSrc("p1", "/api/projects/p1/deliveries/t/a.jpg")).toBe("/api/projects/p1/deliveries/t/a.jpg");
  });

  it("with no project to ask → as it is", () => {
    expect(workspaceSrc(null, "/img/a.webp")).toBe("/img/a.webp");
    expect(workspaceSrc(undefined, "/img/a.webp")).toBe("/img/a.webp");
  });
});
