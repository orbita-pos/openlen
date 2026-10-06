import { describe, expect, it } from "vitest";
import { MAX_PHOTOS_PER_MESSAGE, photosForRow, photosOf } from "./chat-photos";

describe("las fotos de un mensaje", () => {
  it("lee filas viejas (un objeto) y nuevas (una lista)", () => {
    expect(photosOf(null)).toEqual([]);
    expect(photosOf({ url: "u1" })).toEqual([{ url: "u1" }]);
    expect(photosOf([{ url: "u1" }, { url: "u2", alt: "b" }])).toEqual([{ url: "u1" }, { url: "u2", alt: "b" }]);
  });
  it("🔴 una sola foto se guarda como siempre (objeto): las filas de un turno con una foto no cambian", () => {
    expect(photosForRow([{ url: "u1" }])).toEqual({ url: "u1" });
    expect(photosForRow([])).toBeNull();
    expect(photosForRow([{ url: "u1" }, { url: "u2" }])).toEqual([{ url: "u1" }, { url: "u2" }]);
  });
  it("el tope es el de Crear", () => {
    expect(MAX_PHOTOS_PER_MESSAGE).toBe(4);
  });
});
