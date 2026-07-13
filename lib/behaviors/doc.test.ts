import { describe, expect, it } from "vitest";
import { buildBehaviorsDoc } from "./doc";
import { BEHAVIORS, BEHAVIOR_ORDER } from "./registry";

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
