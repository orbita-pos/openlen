// LÁPIDA: qué secciones de módulo se pueden insertar de verdad.
//
// `ModuleSurface` declaraba cinco —bookings, collections, comments, chat,
// platforms— y CUATRO estaban muertas o muriendo:
//
//   bookings   retirado el 2026-08-21
//   comments   retirado el 2026-08-21
//   platforms  su banda murió el 2026-08-29 (era un TECHO: le decía al modelo
//              que las redes SON una banda, así que nunca proponía otra cosa)
//   collections muere el 2026-08-29 — lo hace mejor un almacén declarado
//
// Un tipo que enumera lo que ya no existe no es documentación desactualizada:
// es una lista que alguien lee para decidir qué se puede insertar, y que ofrece
// cuatro cosas que insertarían un contenedor vacío para siempre. Sin error, sin
// nada que mirar — el fallo mudo de esta casa.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const fuente = readFileSync(
  join(process.cwd(), "lib", "publish", "module-sections.ts"),
  "utf8",
);

describe("y el plan de «añadir módulo» se fue con ellos", () => {
  // `ContentModule` era EXACTAMENTE "collections" | "platforms": los dos que
  // murieron el 2026-08-29. Un asistente que te guía para añadir un módulo, sin
  // ningún módulo que añadir, es andamio con menú.
  it("no queda module-add-plan", () => {
    expect(existsSync(join(process.cwd(), "lib", "workspace-v2", "module-add-plan.ts"))).toBe(
      false,
    );
  });
});

describe("sólo se puede insertar lo que existe", () => {
  it("ModuleSurface declara únicamente chat", () => {
    const m = fuente.match(/export type ModuleSurface = ([^;]+);/);
    expect(m, "ModuleSurface ya no se declara").not.toBeNull();
    expect(m![1].trim()).toBe('"chat"');
  });

  it.each(["bookings", "comments", "platforms", "collections"])(
    "no queda copy ni marcador de %s",
    (muerto) => {
      expect(fuente).not.toMatch(new RegExp(`^\\s+${muerto}: \\{`, "m"));
      expect(fuente).not.toMatch(new RegExp(`data-ol-${muerto}`));
    },
  );

  // Y lo que sí vive sigue vivo: si el barrido se llevara el Chat por delante,
  // esto lo dice antes que un ojo.
  it("el chat conserva su copy y su marcador", () => {
    expect(fuente).toMatch(/^\s+chat: \{/m);
    expect(fuente).toContain("data-ol-chat-section");
  });
});
