import { describe, expect, it } from "vitest";
import { buildAgentContext, changelogBlock } from "./context";

const base = {
  now: new Date("2026-08-22T12:00:00Z"),
  state: { titulo: "x", publicado: false },
};

const cambio = (label: string, page: string | null = null) => ({
  label,
  page,
  createdAt: new Date("2026-08-22T11:00:00Z"),
});

describe("el registro de cambios", () => {
  // Sin cambios el contexto tiene que salir BYTE A BYTE como antes. Ya me pilló
  // una vez: colé el separador FUERA del bloque y disparaba con la lista vacía.
  it("sin cambios no añade ni un carácter", () => {
    const sin = buildAgentContext(base);
    expect(buildAgentContext({ ...base, cambios: [] })).toBe(sin);
    expect(changelogBlock([])).toBe("");
  });

  it("enumera lo que de verdad se guardó", () => {
    const out = buildAgentContext({
      ...base,
      cambios: [cambio("Agente (1 ops): Añadir sección de horarios")],
    });
    expect(out).toContain("Añadir sección de horarios");
    expect(out).toMatch(/real version log/);
  });

  it("dice que NO es la conversación — es lo que se guardó", () => {
    // Es la diferencia entre «creo que hicimos» y «esto se hizo». Si el modelo
    // lo lee como charla, volverá a fiarse de su memoria y a inventar.
    const out = changelogBlock([cambio("Agente (1 ops): Centrar el pie")]);
    expect(out).toMatch(/not the conversation/);
    expect(out).toMatch(/never got saved/);
  });

  it("nombra la página cuando el cambio no fue en el inicio", () => {
    const out = changelogBlock([cambio("Agente (1 ops): Cambiar el título", "menu")]);
    expect(out).toContain('(page "menu")');
  });

  it("se acota — no manda el historial entero en cada turno", () => {
    const muchos = Array.from({ length: 30 }, (_, i) => cambio(`Cambio ${i}`));
    const out = changelogBlock(muchos);
    expect(out).toContain("Cambio 0");
    expect(out).not.toContain("Cambio 20");
  });
});

// ⚰️ «el aviso de que no ve toda la conversación» se fue con A11: Len ve la
// charla entera desde el último resumen (ver context.test.ts, A11).

