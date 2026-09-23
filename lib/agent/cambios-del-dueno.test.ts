import { describe, expect, it } from "vitest";
import { describirCambiosDelDueno, loQueCambioElDueno } from "./cambios-del-dueno";

const DEL_LEN = ["<body>", "<h1>Clínica Vitalvet</h1>", "<p>Consulta general</p>", "</body>"].join("\n");
const CON_EL_DUENO = DEL_LEN.replace("Clínica Vitalvet", "Vitalvet · Urgencias 24h");

describe("lo que el dueño cambió a mano desde el último turno de Len", () => {
  it("🔴 dice el texto de antes y el de ahora", () => {
    expect(describirCambiosDelDueno(DEL_LEN, CON_EL_DUENO)).toEqual([
      "«Clínica Vitalvet» → «Vitalvet · Urgencias 24h»",
    ]);
  });

  it("un cambio sólo de marcado se cuenta, no se copia", () => {
    const estilo = DEL_LEN.replace("<p>", '<p style="color:blue">');
    expect(describirCambiosDelDueno(DEL_LEN, estilo)).toEqual([
      "y 1 cambio(s) de marcado o estilo sin texto visible",
    ]);
  });

  it("lo añadido y lo quitado se nombran", () => {
    const otro = DEL_LEN.replace("<p>Consulta general</p>", "<p>Vacunas</p>\n<p>Urgencias</p>");
    const r = describirCambiosDelDueno(DEL_LEN, otro);
    expect(r.join(" | ")).toContain("Vacunas");
  });

  it("busca la última escritura de Len EN ESA PÁGINA y la compara con lo de ahora", async () => {
    const versiones = [
      { id: "v-dueno-menu", source: "manual", page: "menu" },
      { id: "v-len", source: "chat", page: null },
      { id: "v-inicial", source: "initial", page: null },
    ];
    const leidas: string[] = [];
    const r = await loQueCambioElDueno({
      versiones,
      page: null,
      actual: CON_EL_DUENO,
      leerHtml: async (id) => {
        leidas.push(id);
        return id === "v-len" ? DEL_LEN : null;
      },
    });
    expect(leidas).toEqual(["v-len"]);
    expect(r).toEqual(["«Clínica Vitalvet» → «Vitalvet · Urgencias 24h»"]);
  });

  it("BRAZO DE CONTROL: si la página sigue como la dejó Len, no hay nada que decir", async () => {
    const r = await loQueCambioElDueno({
      versiones: [{ id: "v-len", source: "chat", page: null }],
      page: null,
      actual: DEL_LEN,
      leerHtml: async () => DEL_LEN,
    });
    expect(r).toEqual([]);
  });

  it("sin escrituras de Len en la página, tampoco", async () => {
    const r = await loQueCambioElDueno({
      versiones: [{ id: "v", source: "initial", page: null }],
      page: null,
      actual: CON_EL_DUENO,
      leerHtml: async () => DEL_LEN,
    });
    expect(r).toEqual([]);
  });

  it("si leer la versión revienta, el turno sigue sin el bloque", async () => {
    const r = await loQueCambioElDueno({
      versiones: [{ id: "v-len", source: "chat", page: null }],
      page: null,
      actual: CON_EL_DUENO,
      leerHtml: async () => {
        throw new Error("base caída");
      },
    });
    expect(r).toEqual([]);
  });
});
