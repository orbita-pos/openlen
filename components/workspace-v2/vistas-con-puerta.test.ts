// TODA VISTA TIENE QUE TENER PUERTA, O ESTAR DECLARADA SIN ELLA.
//
// POR QUÉ EXISTE. El 2026-09-16 se descubrió, probando producción, que el
// asistente NO SE PUEDE ENCENDER: su panel existe, funciona, y vive en una
// vista (`?view=modulos`) a la que no navega NADA en toda la aplicación.
//
// No fue un bug de lógica — fue una superficie construida a la que no se
// llega, y eso ninguna prueba lo veía. Ésta sí: si `page.tsx` acepta una
// vista, o el rail lleva a ella, o alguien tiene que ESCRIBIR por qué no.
//
// Misma forma que `SOLO_DE_LA_RUTA` en
// lib/agent/arnes-multiturno-como-la-ruta.test.ts: una lista de excepciones
// sin motivos es un sitio donde esconder el próximo olvido.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { RAIL_CREAR, RAIL_OPERAR } from "./rail-model";

const RAIZ = join(import.meta.dirname, "..", "..");
const PAGE = join(RAIZ, "app", "[locale]", "new", "page.tsx");

/** Vistas que `page.tsx` acepta y el rail NO lleva — cada una con DÓNDE se
 *  llega a ella. Sin el dónde, esto es un cajón de sastre. */
const SIN_PUERTA_EN_EL_RAIL: Record<string, string> = {
  projects: "desde el landing de inicio y el selector de proyecto",
  templates: "desde la pestaña Plantillas de la barra lateral",
  explore: "desde el landing de inicio",
  analytics: "alias de URL de `resultados`, que sí está en el rail",
};

/** Las vistas que `page.tsx` acepta, leídas de su fuente. */
function vistasAceptadas(): string[] {
  const src = readFileSync(PAGE, "utf8");
  const bloque = /const centerView: SectionView =([\s\S]*?)\?\s*viewParam/.exec(src);
  expect(bloque, "no se encontró el bloque que acepta ?view=").not.toBeNull();
  return [...bloque![1]!.matchAll(/viewParam === "([a-z]+)"/g)].map((m) => m[1]!);
}

const enElRail = new Set(
  [...RAIL_CREAR, ...RAIL_OPERAR]
    .filter((i) => i.kind === "view")
    .map((i) => (i as { view: string }).view),
);

describe("toda vista aceptada tiene puerta", () => {
  const vistas = vistasAceptadas();

  it("BRAZO DE CONTROL: se leyeron las vistas de verdad", () => {
    // Sin esto, un regex que devolviera [] dejaría la prueba de abajo en verde
    // sin haber mirado nada.
    expect(vistas.length).toBeGreaterThan(5);
    expect(vistas).toContain("messages");
    expect(enElRail.size).toBeGreaterThan(2);
  });

  it("🔴 ninguna vista se queda sin puerta y sin motivo", () => {
    const huerfanas = vistas.filter(
      (v) => !enElRail.has(v) && !(v in SIN_PUERTA_EN_EL_RAIL),
    );
    expect(
      huerfanas,
      `estas vistas no se alcanzan desde el rail y nadie dijo por qué: ${huerfanas.join(", ")}. ` +
        "O entran en el rail, o entran en SIN_PUERTA_EN_EL_RAIL con DÓNDE se llega a ellas.",
    ).toEqual([]);
  });

  it("la lista de excepciones no se pudre", () => {
    const sobran = Object.keys(SIN_PUERTA_EN_EL_RAIL).filter((v) => !vistas.includes(v));
    expect(
      sobran,
      `SIN_PUERTA_EN_EL_RAIL excusa vistas que ya no existen: ${sobran.join(", ")}`,
    ).toEqual([]);
  });
});
