import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { SOLO_AL_PUBLICAR, TAMBIEN_EN_EL_LIENZO } from "./bake-surfaces";

// Lee las TRANSFORMACIONES que un fichero IMPORTA y además LLAMA.
//
// 🔴 EL PATRÓN DECÍA `bake[A-Z0-9]` Y ESO DEJABA FUERA LA MITAD. Al publicar,
// una página pasa por `wirePublishedForms`, `applyLiveData`, tres `inject*`, el
// sello y cinco `strip/optimize/absolutize/consolidate/annotate` — ninguno se
// llama `bake*`, y ninguno lo veía este guardián. Es decir: el fichero prometía
// vigilar las diferencias entre superficies y vigilaba un tercio de ellas.
//
// EL LÍMITE, dicho en voz alta: esto sigue siendo un prefijo, no un análisis.
// Una transformación nueva que se llame `mejorarHtml()` se cuela igual. Lo que
// hace esta lista es cubrir TODOS los verbos con los que hoy se nombran, y
// obligar a que el que estrene uno nuevo lo vea aquí al no cuadrarle la cuenta.
//
// `gateReservedMarker` queda fuera a propósito: comprueba, no transforma.
const VERBOS = /^(bake|inject|wire|apply|seal|strip|optimize|absolutize|consolidate|optOut|annotate)[A-Z0-9]/;

// Contenedores: llaman a otras transformaciones en vez de ser una. Declararlos
// aquí es lo que permite comparar el LIENZO con publicar sin que sus widgets
// salgan como «inventados» — el lienzo los hereda llamando a este contenedor.
const CONTENEDORES = new Set(["bakeModulesForPreviewHtml"]);

function transformacionesDe(rel: string): Set<string> {
  const src = readFileSync(path.join(process.cwd(), rel), "utf8");
  const importados = new Set<string>();
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from/g)) {
    for (const bruto of m[1].split(",")) {
      const n = bruto.trim().split(" as ")[0]?.trim() ?? "";
      if (VERBOS.test(n) && !CONTENEDORES.has(n)) importados.add(n);
    }
  }
  // Sin expresión regular a propósito: una barra invertida perdida al
  // escribir el fichero convertía `\s` en `s` y el guardián pasaba en verde
  // sin comprobar nada. Dos `includes` no se pueden romper así.
  const llamado = (n: string) => src.includes(`${n}(`) || src.includes(`${n} (`);
  return new Set([...importados].filter(llamado));
}

const PUBLICAR = "lib/publish/filesystem.ts";
const VISTA_PREVIA = "lib/publish/preview-bake.ts";
const LIENZO = "lib/lienzo/documento.ts";

describe("las superficies hornean lo mismo, o está declarado", () => {
  const publicar = transformacionesDe(PUBLICAR);
  const previa = transformacionesDe(VISTA_PREVIA);
  // El lienzo delega los widgets en `bakeModulesForPreviewHtml`, que es la
  // misma función que usa `/p/`: lo que hornea es lo suyo MÁS lo de ese
  // contenedor. Comparar sólo su fichero diría que no hornea ningún widget, y
  // es falso.
  const lienzo = new Set([
    ...transformacionesDe(LIENZO),
    ...(readFileSync(path.join(process.cwd(), LIENZO), "utf8").includes("bakeModulesForPreviewHtml(")
      ? previa
      : []),
  ]);

  it("el extractor encuentra transformaciones en los tres ficheros", () => {
    // Si un refactor rompe el extractor, todo lo demás pasaría vacío y en
    // verde. Esta prueba es la que impide que el guardián se apague solo.
    //
    // El suelo va holgadamente por debajo de lo que hay (18 / 2 / 4 el
    // 2026-09-15): es un suelo contra «el extractor devolvió cero», no un
    // número que haya que defender.
    expect(publicar.size).toBeGreaterThan(10);
    expect(previa.size).toBeGreaterThan(1);
    expect(lienzo.size).toBeGreaterThan(2);
  });

  it("🔴 y ve lo que NO se llama bake*", () => {
    // La ampliación del 2026-09-15, sujeta con nombres concretos: sin esto,
    // alguien podría estrechar el patrón otra vez y el guardián seguiría verde
    // vigilando un tercio de la tubería.
    for (const n of ["wirePublishedForms", "applyLiveData", "injectAnalyticsSnippet", "sealRelease", "stripOpIds"]) {
      expect(publicar.has(n), `el extractor ya no ve ${n}`).toBe(true);
    }
  });

  it("todo lo que publica y la vista previa no, está declarado y explicado", () => {
    const soloAlPublicar = [...publicar].filter((b) => !previa.has(b)).sort();
    expect(soloAlPublicar).toEqual(Object.keys(SOLO_AL_PUBLICAR).sort());
  });

  it("🔴 y lo que publica y el LIENZO no, también", () => {
    // La tercera superficie, que es la que el usuario mira mientras edita y la
    // que el medidor mide desde la spec del 2026-09-15.
    const soloAlPublicar = [...publicar].filter((b) => !lienzo.has(b)).sort();
    const declarado = Object.keys(SOLO_AL_PUBLICAR)
      .filter((b) => !TAMBIEN_EN_EL_LIENZO.includes(b))
      .sort();
    expect(soloAlPublicar).toEqual(declarado);
  });

  it("no hay entradas rancias: todo lo declarado sigue existiendo", () => {
    const fantasmas = Object.keys(SOLO_AL_PUBLICAR).filter((b) => !publicar.has(b));
    expect(fantasmas, `ya no se hornean al publicar: ${fantasmas.join(", ")}`).toEqual([]);
    const fantasmasLienzo = TAMBIEN_EN_EL_LIENZO.filter((b) => !lienzo.has(b));
    expect(fantasmasLienzo, `el lienzo ya no las hace: ${fantasmasLienzo.join(", ")}`).toEqual([]);
  });

  it("ni la vista previa ni el lienzo hornean algo que la publicada no", () => {
    // La otra dirección del fallo, y la peor de las dos: enseñar en el editor
    // algo que el visitante jamás recibe.
    expect([...previa].filter((b) => !publicar.has(b)).sort()).toEqual([]);
    expect([...lienzo].filter((b) => !publicar.has(b)).sort()).toEqual([]);
  });

  it("cada motivo dice algo, no es un hueco relleno", () => {
    for (const [nombre, motivo] of Object.entries(SOLO_AL_PUBLICAR)) {
      expect(motivo.length, `${nombre} sin motivo de verdad`).toBeGreaterThan(40);
    }
  });
});

// ─── LA TERCERA SUPERFICIE ────────────────────────────────────────────────
//
// La cabecera de bake-surfaces.ts nombra TRES formas de pintar un proyecto —
// el taller, `/p/[id]` y la publicada— y este guardián sólo comparaba las dos
// últimas. Por ese hueco se coló el defecto del 2026-08-31: cuando los
// horneados de conductas y carrusel salieron de publicar Y de la vista previa
// (`3a4e2a97`, que además hizo bien las dos a la vez), el TALLER siguió
// inyectándolos por su cuenta. Resultado: el dueño veía su carrusel girar
// mientras editaba y al visitante le llegaba una lista muerta.
//
// Es la INVERSIÓN del fallo que este fichero se escribió para cazar, y la peor
// de las dos: el dueño no tiene ningún motivo para sospechar.
//
// El taller no llama a `bake*` —usa `inject*` de cliente— así que el extractor
// de arriba no le sirve. Lo que sí se puede afirmar, y es lo que importa: el
// lienzo NO puede inyectar un runtime que la página publicada no hornea.
describe("el taller no inyecta runtimes que la publicada ya no hornea", () => {
  const LIENZO = "components/workspace-v2/preview-area.tsx";
  const src = readFileSync(path.join(process.cwd(), LIENZO), "utf8");

  // Los dos runtimes que publicar dejó de hornear el 2026-08-26. Si alguien
  // devuelve su inyector al lienzo sin devolver también el horneado, aquí se
  // entera.
  const PROHIBIDOS = [
    ["el runtime de las conductas", "injectBehaviorsPreview"],
    ["el stash que ese runtime necesitaba", "stashBehaviorsPristineState"],
    ["la palanca que sólo servía para sincronizarlo", "useKillSwitches"],
  ] as const;

  for (const [queEs, simbolo] of PROHIBIDOS) {
    it(`el lienzo no usa ${queEs}`, () => {
      expect(src).not.toContain(simbolo);
    });
  }

  // Y el guardián se guarda a sí mismo: si el fichero del lienzo se renombra,
  // `src` sería "" y los tres `not.toContain` pasarían sin comprobar nada.
  it("el extractor está leyendo el lienzo de verdad", () => {
    expect(src).toContain("injectInlineEdit");
  });
});
