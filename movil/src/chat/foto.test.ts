import { describe, expect, it } from "vitest";
import { medidasAchicadas } from "./foto";

describe("medidasAchicadas", () => {
  it("una foto grande del teléfono baja a 2048 por su lado mayor, sin deformarse", () => {
    expect(medidasAchicadas(4000, 3000)).toEqual({ ancho: 2048, alto: 1536 });
    expect(medidasAchicadas(3000, 4000)).toEqual({ ancho: 1536, alto: 2048 });
  });
  it("una que ya cabe se queda como está", () => {
    expect(medidasAchicadas(1200, 800)).toEqual({ ancho: 1200, alto: 800 });
  });
});
