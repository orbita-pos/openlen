// EL AVISO DE «VISTA LIMITADA», SÓLO EN LA VISTA PREVIA.
//
// Cuando el lienzo remoto no responde, la vista previa cae a una copia local en
// un iframe cerrado (sin formularios, sin datos guardados en el navegador, sin
// ventanas nuevas), y un aviso lo dice. El aviso habla de la VISTA PREVIA, pero
// salía encima de las cuatro lentes: en «Terminal» (F6a, plans/len-agente-2026)
// parecía que la terminal tuviera esos límites. Visto por Jesús el 02/10.
//
// Como las demás pruebas de este componente, mira el fuente: montarlo entero
// pide el lienzo remoto y sus iframes.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const FUENTE = readFileSync(path.join(__dirname, "preview-area.tsx"), "utf8");

describe("el aviso de vista limitada", () => {
  it("sólo se pinta con la lente de la vista previa", () => {
    expect(FUENTE).toContain('{vistaLimitada && lente === "pagina" && (');
  });
  it("y se pinta en un solo sitio (si aparece otro, esta prueba deja de valer)", () => {
    expect(FUENTE.match(/t\("preview\.vistaLimitada"\)/g)).toHaveLength(1);
  });
});
