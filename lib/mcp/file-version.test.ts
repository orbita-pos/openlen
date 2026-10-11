// @vitest-environment node
import { describe, expect, it } from "vitest";
import { fileVersion } from "./file-version";

describe("la versión de un fichero", () => {
  it("es la huella del contenido: igual contenido, igual versión; un byte, otra", () => {
    expect(fileVersion("hola")).toMatch(/^[0-9a-f]{12}$/);
    expect(fileVersion("hola")).toBe(fileVersion("hola"));
    expect(fileVersion("hola")).not.toBe(fileVersion("hola "));
  });
});
