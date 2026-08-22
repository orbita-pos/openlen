import { describe, expect, it } from "vitest";
import { buildAgentContext, changelogBlock } from "./context";

const base = {
  now: new Date("2026-08-22T12:00:00Z"),
  state: { titulo: "x", publicado: false },
  taggedHtml: '<h1 data-op-id="a">hola</h1>',
  userBrief: null,
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
    expect(out).toMatch(/registro real de versiones/);
  });

  it("dice que NO es la conversación — es lo que se guardó", () => {
    // Es la diferencia entre «creo que hicimos» y «esto se hizo». Si el modelo
    // lo lee como charla, volverá a fiarse de su memoria y a inventar.
    const out = changelogBlock([cambio("Agente (1 ops): Centrar el pie")]);
    expect(out).toMatch(/no es la conversación/);
    expect(out).toMatch(/no llegó a guardarse/);
  });

  it("nombra la página cuando el cambio no fue en el inicio", () => {
    const out = changelogBlock([cambio("Agente (1 ops): Cambiar el título", "menu")]);
    expect(out).toContain('(página "menu")');
  });

  it("se acota — no manda el historial entero en cada turno", () => {
    const muchos = Array.from({ length: 30 }, (_, i) => cambio(`Cambio ${i}`));
    const out = changelogBlock(muchos);
    expect(out).toContain("Cambio 0");
    expect(out).not.toContain("Cambio 20");
  });
});

describe("el aviso de que no ve toda la conversación", () => {
  /**
   * EL FALLO QUE CIERRA. MEDIDO el 2026-08-22: a «¿qué fue LO PRIMERO que te
   * pedí en esta conversación?» contestó nombrando el turno más VIEJO que aún
   * tenía en su ventana, presentándolo como el primero. Con total seguridad y
   * equivocado. No dijo «no me acuerdo» porque no sabía que estaba truncado.
   */
  it("cuando ve menos de lo que hay, se lo dice", () => {
    const out = buildAgentContext({
      ...base,
      conversacionRecortada: { visibles: 12, totales: 31 },
    });
    expect(out).toContain("últimos 12");
    expect(out).toContain("31");
    expect(out).toMatch(/no me acuerdo/);
  });

  it("cuando lo ve todo NO dice nada", () => {
    const sin = buildAgentContext(base);
    expect(buildAgentContext({ ...base, conversacionRecortada: { visibles: 4, totales: 4 } })).toBe(sin);
    expect(buildAgentContext({ ...base, conversacionRecortada: null })).toBe(sin);
  });

  // Si el aviso no dijera dónde SÍ está la historia completa, el modelo se
  // quedaría sólo con «no sé» — que es honesto pero inútil.
  it("le apunta al registro de cambios, que sí sobrevive", () => {
    const out = buildAgentContext({
      ...base,
      conversacionRecortada: { visibles: 12, totales: 31 },
    });
    expect(out).toMatch(/registro de cambios/);
  });
});
