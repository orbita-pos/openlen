import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { buildBehaviorsDoc } from "./doc";
import { BEHAVIORS, BEHAVIOR_ORDER } from "./registry";
import type { Behavior, BehaviorName } from "./types";

// Prueba la propiedad ESTRUCTURAL, no el texto: recorre BEHAVIOR_ORDER (la
// fuente real del registro, no una lista copiada a mano aquí) y afirma que
// la salida contiene el nombre, el marcador, el `when`, el `whenNot`
// COMPLETO (textual, no resumido) y el `example` COMPLETO de cada receta.
// Consecuencia directa: una receta nueva registrada en BEHAVIOR_ORDER entra
// SOLA en la salida sin tocar este archivo (ver el Paso 5 de verificación,
// que lo demuestra con una 8ª receta temporal); una receta que el generador
// deje fuera es CI rojo aquí, no un hueco silencioso en el prompt de la IA.
describe("buildBehaviorsDoc", () => {
  const doc = buildBehaviorsDoc();

  it("no está vacío y encabeza la sección explicando que OpenLen hornea el runtime", () => {
    expect(doc.length).toBeGreaterThan(0);
    expect(doc).toMatch(/HORNEA/);
  });

  describe.each(BEHAVIOR_ORDER.map((name) => [name, BEHAVIORS[name]] as const))(
    "receta: %s",
    (_name, b) => {
      it("lleva su nombre, marcador, when, whenNot y example completos en la salida", () => {
        // Ninguna receta del registro actual es `deprecated` (catálogo
        // cerrado desde el Task 13, las 7 son `stable`) — si eso cambia,
        // esta aserción debe fallar de forma RUIDOSA en vez de saltarse en
        // silencio, para que quien la lea decida a propósito qué hacer con
        // el caso deprecated, no que el test se auto-excluya sin avisar.
        expect(
          b.status,
          `${b.name}: es "deprecated" — este test asume el catálogo actual (las 7 stable) y necesita revisión explícita, no un skip silencioso`,
        ).not.toBe("deprecated");

        expect(doc, `falta el nombre "${b.name}"`).toContain(b.name);
        expect(doc, `falta el marcador ${b.marker}`).toContain(b.marker);
        expect(doc, `falta el "when" de ${b.name}`).toContain(b.doc.when);
        expect(doc, `falta el "whenNot" de ${b.name} (textual, no resumido)`).toContain(b.doc.whenNot);
        expect(doc, `falta el "example" de ${b.name}`).toContain(b.doc.example);
      });
    },
  );
});

// MINOR (revisión final de rama) — BEHAVIOR_NAMES/BEHAVIOR_COUNT/BEHAVIOR_LABELS
// derivaban de BEHAVIOR_ORDER en crudo, sin el filtro `status !== "deprecated"`
// que buildBehaviorsDoc() (arriba) ya aplica — present() (build.ts) NO filtra
// a propósito: deprecated se oculta de la IA pero SIGUE emitiendo para las
// páginas existentes (hallazgo Fable 2026-07-13; ver build.test.ts, "SIGUE
// emitiendo"). Sin este filtro, una receta deprecada saldría en la glosa/número/lista de la
// CABECERA de CONDUCTAS sin tener entrada ni runtime en el CUERPO de esa
// misma sección. Se prueba mockeando ./registry (mismo patrón que
// prose-derivation.test.ts, "Arreglo 1") porque los tres son consts de
// MÓDULO calculadas una sola vez al importar — no funciones parametrizables
// — así que la única forma de variar el registro que ven es re-importar el
// módulo fresco contra un registro mockeado.
describe("BEHAVIOR_NAMES / BEHAVIOR_COUNT / BEHAVIOR_LABELS excluyen las recetas deprecated", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock("./registry");
    vi.resetModules();
  });

  it("una receta deprecated desaparece del conteo, la lista de nombres y las glosas — igual que ya desaparece del cuerpo de buildBehaviorsDoc()", async () => {
    vi.doMock("./registry", async () => {
      const real = await vi.importActual<{
        BEHAVIORS: Record<BehaviorName, Behavior>;
        BEHAVIOR_ORDER: BehaviorName[];
      }>("./registry");
      return {
        BEHAVIORS: {
          ...real.BEHAVIORS,
          filter: { ...real.BEHAVIORS.filter, status: "deprecated" as const },
        },
        BEHAVIOR_ORDER: real.BEHAVIOR_ORDER,
      };
    });

    const {
      BEHAVIOR_NAMES: names,
      BEHAVIOR_COUNT: count,
      BEHAVIOR_LABELS: labels,
      buildBehaviorsDoc: buildDocFresh,
    } = await import("./doc");

    // Derivado, NO cableado (el `toBe(7)` de antes se ponía rojo con cada
    // receta nueva sin decir nada sobre lo que la prueba defiende): con una
    // receta deprecada, el conteo activo es el del registro MENOS una.
    const realOrder = (
      await vi.importActual<{ BEHAVIOR_ORDER: BehaviorName[] }>("./registry")
    ).BEHAVIOR_ORDER;
    expect(count, "filter (deprecated) sigue contando en BEHAVIOR_COUNT").toBe(
      realOrder.length - 1,
    );
    expect(names.split(", "), "filter (deprecated) sigue en BEHAVIOR_NAMES").not.toContain("filter");
    expect(labels, "filter (deprecated) sigue en BEHAVIOR_LABELS ('filtro')").not.toContain("filtro");
    // Cabecera Y cuerpo de la MISMA sección ahora coinciden: ninguno de los
    // dos menciona ya a filter.
    expect(buildDocFresh()).not.toContain("`data-ol-filter`");
  });
});
