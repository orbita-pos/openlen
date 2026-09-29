import { describe, expect, it } from "vitest";

import { cambiosParaElAgente } from "./cambios-para-el-agente";

describe("el registro de cambios que ve el Agente", () => {
  const cuando = new Date("2026-09-29T12:00:00Z");

  it("las copias de ANTES (del Chat y del taller) no son cambios; lo demás sí", () => {
    const r = cambiosParaElAgente([
      { label: "Before AI edit", page: null, createdAt: cuando },
      { label: "Before manual edit", page: null, createdAt: cuando },
      { label: "Reordered sections", page: null, createdAt: cuando },
      { label: "Edited content", page: "menu", createdAt: cuando },
    ]);
    expect(r.map((v) => v.label)).toEqual(["Reordered sections", "Edited content"]);
  });
});
