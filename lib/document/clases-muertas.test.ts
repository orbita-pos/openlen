import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { clasesQueNuncaAplican, frasesDeClasesMuertas, TAILWIND_MAYOR } from "./clases-muertas";

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

  /**
   * 🔴 LA CONSTANTE QUE NOMBRA UNA VERSIÓN, ATADA A LA VERSIÓN DE VERDAD.
   *
   * `TAILWIND_MAYOR` decide qué se denuncia, y en v4 `text-(--var)` es la forma
   * BUENA. Si alguien sube la dependencia y esta constante se queda en 3, el
   * detector empieza a acusar a la sintaxis correcta — y nada lo delataría: las
   * páginas saldrían bien y el informe diría que están rotas. Un aviso falso en
   * un canal que el usuario lee es peor que no tener el aviso.
   *
   * Es el mismo defecto que este repo ya ha pagado con las reglas de prompt que
   * nombran la interfaz: caducan en SILENCIO. La diferencia es que ésta suspende
   * y dice qué línea mover.
   */
  it("🔴 la versión que el detector asume es la que está instalada", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const rango = pkg.dependencies?.tailwindcss ?? pkg.devDependencies?.tailwindcss;
    expect(rango, "no se encontró tailwindcss en package.json").toBeTruthy();

    const instalada = Number(/(\d+)/.exec(rango!)?.[1]);
    expect(
      instalada,
      `tailwindcss está en la v${instalada} y el detector asume la v${TAILWIND_MAYOR}: ` +
        "revisa `FORMA_V4` en lib/document/clases-muertas.ts — en v4 `text-(--var)` " +
        "es la sintaxis CORRECTA y dejaría de ser un defecto",
    ).toBe(TAILWIND_MAYOR);
  });

  /**
   * Y LA MITAD QUE SE ME ESCAPÓ, cazada por el brazo de control de la prueba de
   * arriba: la versión gateaba la función ENTERA, así que subir la constante
   * dejaba mudo también al detector del espacio — que no depende de ninguna
   * versión, porque un espacio literal dentro del paréntesis parte el atributo
   * en todas. El comentario de `TAILWIND_MAYOR` ya decía eso y el código hacía
   * lo contrario.
   *
   * Se fija por separado para que no vuelvan a fundirse: una es una regla de
   * ortografía y la otra una regla de VERSIÓN.
   */
  it("la regla del espacio no depende de la versión de Tailwind", () => {
    const r = clasesQueNuncaAplican('<p class="text( --ol-fg-muted )">x</p>');
    expect(r).toHaveLength(1);
    // La comprobación de versión vive en el bloque de `FORMA_V4`, no envolviendo
    // la función: si algún día vuelve arriba, esta prueba se cae al cambiar la
    // constante, que es cuando hay que enterarse.
    const fuente = readFileSync("lib/document/clases-muertas.ts", "utf8");
    expect(
      fuente,
      "la puerta de versión volvió a envolver la función entera",
    ).not.toMatch(/^\s*if \(TAILWIND_MAYOR !== 3\) return \[\];/m);
  });

  it("lo dice para una persona: qué no pinta y qué se escribe en su lugar", () => {
    const f = frasesDeClasesMuertas(clasesQueNuncaAplican(conClase("text( --ol-fg-muted )")));
    expect(f[0]).toContain("no existe y no pinta nada");
    expect(f[0]).toContain("text-[var(--ol-fg-muted)]");
  });
});
