import { describe, expect, it } from "vitest";
import {
  EN_PARALELO,
  MAX_HALLAZGOS,
  deduplicar,
  modoDeRevision,
  revisarTurno,
  type Corrida,
  type Correr,
} from "./revisar-turno";
import { SISTEMA_DEL_REVISOR } from "./receta";

const uso = (o = 10) => ({ inputTokens: 100, outputTokens: o, cachedTokens: 50, thinkingTokens: 0 });
const ok = (texto: string): Corrida => ({ ok: true, texto, uso: uso() });

const c = (line: number | null, o: Record<string, unknown> = {}) => ({
  file: "/index.html",
  line,
  summary: `finding at ${line}`,
  failure_scenario: "the visitor sees it",
  ...o,
});

/** De qué ángulo es el encargo de un buscador (el último mensaje), por su cabecera. */
function anguloDe(mensajes: readonly string[]): string | null {
  const encargo = mensajes.at(-1) ?? "";
  const m = /### Angle ([A-D]) —/.exec(encargo);
  return encargo.includes("ONE angle only") && m ? m[1] : null;
}

const base = { peticion: "cambia el titular", diff: "--- a/index.html\n+++ b/index.html", cierre: "Listo." };

describe("cuándo se revisa", () => {
  it("hasta 4 pasos nada; de 5 a 9 una pasada; de 10 en adelante la completa", () => {
    expect([1, 4, 5, 9, 10, 40].map(modoDeRevision)).toEqual([null, null, "una_pasada", "una_pasada", "completa", "completa"]);
  });
});

describe("la pasada única (el esfuerzo bajo de Claude Code)", () => {
  it("UNA llamada con los cuatro ángulos, sin verificar, como mucho 4", async () => {
    const vistas: [string, readonly string[]][] = [];
    const correr: Correr = async (s, ms) => {
      vistas.push([s, ms]);
      return ok(JSON.stringify([1, 2, 3, 4, 5].map((l) => c(l, { category: "scope" }))));
    };
    const r = await revisarTurno({ modo: "una_pasada", ...base, correr });
    expect(vistas).toHaveLength(1);
    const [sistema, [tarea, encargo]] = vistas[0];
    expect(sistema).toBe(SISTEMA_DEL_REVISOR);
    expect(tarea).toContain("cambia el titular");
    expect(encargo).toContain("four angles");
    expect(r.hallazgos.map((h) => h.line)).toEqual([1, 2, 3, 4]);
    expect(r.hallazgos.every((h) => h.veredicto === null && h.angulo === "alcance")).toBe(true);
    expect(r).toMatchObject({ modo: "una_pasada", candidatos: 4, fallos: 0, llamadas: 1, refutados: 0 });
    expect(r.uso).toEqual(uso());
  });

  it("una respuesta ilegible es un FALLO contado, no «sin hallazgos» a secas", async () => {
    const r = await revisarTurno({ modo: "una_pasada", ...base, correr: async () => ok("all good") });
    expect(r.hallazgos).toEqual([]);
    expect(r.fallos).toBe(1);
  });

  it("si el revisor lanza, no tumba nada: es un fallo más", async () => {
    const r = await revisarTurno({
      modo: "una_pasada",
      ...base,
      correr: async () => {
        throw new Error("503");
      },
    });
    expect(r).toMatchObject({ hallazgos: [], fallos: 1, llamadas: 1 });
  });
});

describe("la receta completa (el esfuerzo medio)", () => {
  /** Un `correr` que contesta por papel: cada buscador lo suyo, cada verificador
   *  según la línea del candidato. */
  const guion = (o: {
    buscadores: Partial<Record<"A" | "B" | "C" | "D", string>>;
    voto: (cand: { line: number | null; summary: string }) => string;
  }): { correr: Correr; llamadas: (readonly string[])[]; prefijos: string[] } => {
    const llamadas: (readonly string[])[] = [];
    /** Lo que va delante del encargo: el sistema y la tarea. */
    const prefijos: string[] = [];
    const correr: Correr = async (s, ms) => {
      llamadas.push(ms);
      prefijos.push(JSON.stringify([s, ...ms.slice(0, -1)]));
      const a = anguloDe(ms);
      if (a) return ok(o.buscadores[a as "A"] ?? "[]");
      const cand = JSON.parse(/<candidate>\n([\s\S]*)\n<\/candidate>/.exec(ms.at(-1)!)![1]);
      return ok(o.voto(cand));
    };
    return { correr, llamadas, prefijos };
  };

  it("cuatro buscadores con la MISMA tarea, uno por ángulo, y un verificador por candidato", async () => {
    const g = guion({
      buscadores: { A: JSON.stringify([c(10)]), C: JSON.stringify([c(20), c(30)]) },
      voto: () => '{"verdict": "CONFIRMED", "evidence": "x"}',
    });
    const r = await revisarTurno({ modo: "completa", ...base, correr: g.correr });
    const buscadores = g.llamadas.filter((ms) => anguloDe(ms));
    expect(buscadores.map(anguloDe).sort()).toEqual(["A", "B", "C", "D"]);
    // 🔴 Todo lo de delante del encargo es IGUAL en las siete llamadas —el
    // sistema y la tarea con el diff—: es lo que se lee de caché.
    expect(new Set(g.prefijos).size).toBe(1);
    expect(g.llamadas.filter((ms) => !anguloDe(ms))).toHaveLength(3);
    expect(r.hallazgos.map((h) => [h.line, h.angulo])).toEqual([
      [10, "alcance"],
      [20, "procedencia"],
      [30, "procedencia"],
    ]);
    expect(r).toMatchObject({ candidatos: 3, llamadas: 7, fallos: 0, refutados: 0 });
  });

  it("🔴 REFUTED se cae, y un voto que no se entiende también (medio es precisión)", async () => {
    const g = guion({
      buscadores: { B: JSON.stringify([c(1), c(2), c(3)]) },
      voto: ({ line }) =>
        line === 1 ? '{"verdict": "REFUTED", "evidence": "the user asked"}' : line === 2 ? "hmm" : '{"verdict": "PLAUSIBLE"}',
    });
    const r = await revisarTurno({ modo: "completa", ...base, correr: g.correr });
    expect(r.hallazgos.map((h) => [h.line, h.veredicto])).toEqual([[3, "PLAUSIBLE"]]);
    expect(r).toMatchObject({ refutados: 1, fallos: 1 });
  });

  it("CONFIRMED antes que PLAUSIBLE; dentro, el puesto que les dio su buscador", async () => {
    const g = guion({
      buscadores: {
        A: JSON.stringify([c(1), c(2)]),
        D: JSON.stringify([c(3), c(4)]),
      },
      voto: ({ line }) => `{"verdict": "${line === 2 || line === 4 ? "CONFIRMED" : "PLAUSIBLE"}", "evidence": "l${line}"}`,
    });
    const r = await revisarTurno({ modo: "completa", ...base, correr: g.correr });
    expect(r.hallazgos.map((h) => h.line)).toEqual([2, 4, 1, 3]);
    expect(r.hallazgos[0]).toMatchObject({ veredicto: "CONFIRMED", evidencia: "l2" });
  });

  it("mismo fichero y misma línea es el mismo sitio: se queda el escenario más concreto y se verifica UNA vez", async () => {
    const g = guion({
      buscadores: {
        A: JSON.stringify([c(7, { failure_scenario: "short" })]),
        B: JSON.stringify([c(7, { failure_scenario: "the brand phrase disappears from the hero on every page load" })]),
        C: JSON.stringify([c(7, { file: "/menu/index.html" })]),
      },
      voto: () => '{"verdict": "CONFIRMED"}',
    });
    const r = await revisarTurno({ modo: "completa", ...base, correr: g.correr });
    expect(r.candidatos).toBe(3);
    expect(r.hallazgos).toHaveLength(2);
    expect(r.hallazgos.find((h) => h.file === "/index.html")).toMatchObject({ angulo: "quitado" });
    expect(g.llamadas.filter((ms) => !anguloDe(ms))).toHaveLength(2);
  });

  it("como mucho 8 hallazgos", async () => {
    const seis = (desde: number) => JSON.stringify(Array.from({ length: 6 }, (_, i) => c(desde + i)));
    const g = guion({
      buscadores: { A: seis(100), B: seis(200), C: seis(300) },
      voto: () => '{"verdict": "CONFIRMED"}',
    });
    const r = await revisarTurno({ modo: "completa", ...base, correr: g.correr });
    expect(r.candidatos).toBe(18);
    expect(r.hallazgos).toHaveLength(MAX_HALLAZGOS);
    // Los primeros de cada buscador van delante: A1, B1, C1, A2, B2, C2, …
    expect(r.hallazgos.slice(0, 3).map((h) => h.line)).toEqual([100, 200, 300]);
  });

  it("un buscador caído no tumba a los demás; se cuenta", async () => {
    const correr: Correr = async (_s, ms) => {
      const a = anguloDe(ms);
      if (a === "A") throw new Error("timeout");
      if (a === "B") return { ok: false, motivo: "upstream", uso: uso(3) };
      if (a === "C") return ok(JSON.stringify([c(5)]));
      if (a === "D") return ok("[]");
      return ok('{"verdict": "CONFIRMED"}');
    };
    const r = await revisarTurno({ modo: "completa", ...base, correr });
    expect(r.hallazgos.map((h) => h.line)).toEqual([5]);
    expect(r.fallos).toBe(2);
    // El uso suma TODAS las llamadas, también la caída que sí gastó.
    expect(r.uso.outputTokens).toBe(10 + 3 + 10 + 10);
  });

  it(`nunca más de ${EN_PARALELO} llamadas a la vez (el tope de Claude Code)`, async () => {
    let enVuelo = 0;
    let maximo = 0;
    const correr: Correr = async (_s, ms) => {
      enVuelo++;
      maximo = Math.max(maximo, enVuelo);
      await new Promise((r) => setTimeout(r, 1));
      enVuelo--;
      const a = anguloDe(ms);
      if (a) return ok(JSON.stringify(Array.from({ length: 6 }, (_, i) => c(i + 1, { file: `/${a}.html` }))));
      return ok('{"verdict": "PLAUSIBLE"}');
    };
    const r = await revisarTurno({ modo: "completa", ...base, correr });
    expect(r.llamadas).toBe(4 + 24);
    expect(maximo).toBeLessThanOrEqual(EN_PARALELO);
    expect(maximo).toBeGreaterThan(4);
  });
});

describe("deduplicar", () => {
  it("sin línea, el mismo sitio es el mismo resumen en el mismo fichero", () => {
    const d = deduplicar([
      { ...c(null, { summary: "Phone not added" }), puesto: 2 },
      { ...c(null, { summary: "phone not added", failure_scenario: "longer scenario here" }), puesto: 0 },
      { ...c(null, { summary: "other thing" }), puesto: 1 },
    ]);
    expect(d).toHaveLength(2);
    expect(d[0]).toMatchObject({ failure_scenario: "longer scenario here", puesto: 0 });
  });
});
