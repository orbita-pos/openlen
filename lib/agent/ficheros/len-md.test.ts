import { describe, expect, it } from "vitest";
import { MEMORY_INDEX, PERSONAL_LEN_MD, PROJECT_LEN_MD, isLegacyMemoryPath, memoryLayerOf, noteNameOf, notePath } from "./len-md";
import { resolverRuta } from "./sitio";

describe("LEN.md y la carpeta de memoria: las rutas", () => {
  it("~ es /home/user, como en la terminal", () => {
    expect(resolverRuta("~/.len/LEN.md")).toBe(PERSONAL_LEN_MD);
    expect(resolverRuta("~")).toBe("/home/user");
    expect(resolverRuta("LEN.md")).toBe(PROJECT_LEN_MD);
  });

  it("cada ruta, su capa", () => {
    expect(memoryLayerOf(PERSONAL_LEN_MD)).toBe("personal");
    expect(memoryLayerOf(PROJECT_LEN_MD)).toBe("project");
    expect(memoryLayerOf(MEMORY_INDEX)).toBe("index");
    expect(memoryLayerOf("/.len/memory/hero-oscuro-rechazado.md")).toBe("note");
    expect(memoryLayerOf("/index.html")).toBeNull();
    expect(memoryLayerOf("/.len/memory/sub/x.md")).toBeNull();
    expect(memoryLayerOf("/.len/memory/Mal_Nombre.md")).toBeNull();
  });

  it("el nombre de una nota sale de su ruta y vuelve a ella", () => {
    expect(noteNameOf("/.len/memory/hero-oscuro-rechazado.md")).toBe("hero-oscuro-rechazado");
    expect(noteNameOf(MEMORY_INDEX)).toBeNull();
    expect(notePath("hero-oscuro-rechazado")).toBe("/.len/memory/hero-oscuro-rechazado.md");
  });

  it("las rutas viejas se reconocen para decir adónde se mudaron", () => {
    expect(isLegacyMemoryPath("/memoria/dueno.md")).toBe(true);
    expect(isLegacyMemoryPath("/memoria/proyecto.md")).toBe(true);
    expect(isLegacyMemoryPath("/LEN.md")).toBe(false);
  });
});
