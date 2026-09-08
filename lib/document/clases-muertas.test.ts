import { describe, expect, it } from "vitest";

import { clasesQueNuncaAplican, frasesDeClasesMuertas } from "./clases-muertas";

const conClase = (cls: string) => `<!doctype html><html><body><p class="${cls}">x</p></body></html>`;

describe("las clases que no pueden pintar nada", () => {
  // EL CASO MEDIDO: 65 veces en un caso del corpus, cero en los otros 49.
  it("🔴 caza el paréntesis con espacio dentro, que es lo que escribió el modelo", () => {
    const r = clasesQueNuncaAplican(conClase("mt-3 text-sm text( --ol-fg-muted )"));
    expect(r).toHaveLength(1);
    expect(r[0]!.muerta).toBe("text( --ol-fg-muted )");
    expect(r[0]!.enSuLugar).toBe("text-[var(--ol-fg-muted)]");
  });

  // La trampa de verdad: ésta PARECE bien escrita. Es correcta en Tailwind v4 y
  // está muerta en la v3 que esta pila compila y sirve — medido en el navegador.
  it("🔴 caza también la forma de v4, que parece correcta y no lo es aquí", () => {
    const r = clasesQueNuncaAplican(conClase("bg-(--ol-surface-2)"));
    expect(r).toHaveLength(1);
    expect(r[0]!.muerta).toBe("bg-(--ol-surface-2)");
    expect(r[0]!.enSuLugar).toBe("bg-[var(--ol-surface-2)]");
  });

  it("dice dónde estaba, para poder encontrarla", () => {
    const r = clasesQueNuncaAplican(conClase("border-b border-soft bg( --ol-bg )"));
    expect(r[0]!.enClase).toContain("border-soft");
  });

  // LA PRECISIÓN ES LA MITAD DEL VALOR. Un detector que grita sobre clases
  // legítimas se acaba ignorando, y entonces no protege de nada — la misma vara
  // que se puso `css-wiring.ts` cuando decidió no avisar de "CSS muerto" a secas.
  describe("y NO acusa a lo que sí funciona", () => {
    it.each([
      ["la forma buena con corchetes", "text-[color:var(--ol-fg-muted)]"],
      ["la otra forma buena", "bg-[var(--ol-bg)]"],
      ["utilidades normales", "mt-4 text-lg max-w-readable flex items-center"],
      ["un valor arbitrario con función", "bg-[url('/x.png')]"],
      ["una fracción con paréntesis en un cálculo", "w-[calc(100%-2rem)]"],
      ["variantes responsivas", "md:grid-cols-2 lg:px-8"],
    ])("%s", (_, cls) => {
      expect(clasesQueNuncaAplican(conClase(cls))).toEqual([]);
    });

    it("un documento sin ningún paréntesis ni se mira", () => {
      expect(clasesQueNuncaAplican(conClase("mt-3 text-sm"))).toEqual([]);
    });
  });

  it("no repite la misma clase muerta veinte veces", () => {
    const p = '<p class="text( --ol-fg-muted )">x</p>';
    const r = clasesQueNuncaAplican(`<!doctype html><html><body>${p.repeat(20)}</body></html>`);
    expect(r).toHaveLength(1);
  });

  it("y se corta: un informe de cien líneas no lo lee nadie", () => {
    const muchas = Array.from(
      { length: 12 },
      (_, i) => `<p class="text( --ol-t${i} )">x</p>`,
    ).join("");
    expect(clasesQueNuncaAplican(muchas).length).toBeLessThanOrEqual(5);
  });

  // Es un diagnóstico, no una puerta: no puede costar la página.
  it("no lanza con basura", () => {
    expect(() => clasesQueNuncaAplican("<p class=>")).not.toThrow();
    expect(() => clasesQueNuncaAplican("")).not.toThrow();
  });

  it("lo dice para una persona: qué no pinta y qué se escribe en su lugar", () => {
    const f = frasesDeClasesMuertas(clasesQueNuncaAplican(conClase("text( --ol-fg-muted )")));
    expect(f[0]).toContain("no existe y no pinta nada");
    expect(f[0]).toContain("text-[var(--ol-fg-muted)]");
  });
});
