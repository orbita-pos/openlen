// LÁPIDA del 2026-08-29: el horneado de Colecciones sale del publicador.
//
// Lo que hacía —meter las filas del dueño DENTRO del HTML publicado, para que
// un catálogo fuera contenido indexable y no un `fetch`— lo hace ahora
// `horneaLectura` sobre un almacén declarado en la propia página. Mismo
// mecanismo, sin módulo que encender.
//
// Esa es la única parte de `collections` que valía la pena conservar, y se
// conservó ANTES de tocar ésta: el Plan 2 la dejó funcionando y probada de punta
// a punta. Demoler primero y reemplazar después habría dejado a las páginas con
// catálogo sin nada en medio.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const leer = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

describe("publicar ya no hornea colecciones", () => {
  it("el publicador no las nombra", () => {
    const fuente = leer("lib/publish/filesystem.ts");
    expect(fuente).not.toMatch(/bakeCollections/);
    expect(fuente).not.toMatch(/collections-block/);
    expect(fuente).not.toMatch(/settings\.collections/);
  });

  it("la vista previa tampoco", () => {
    expect(leer("lib/publish/preview-bake.ts")).not.toMatch(/collections-block/);
  });

  // Y lo que SÍ hornea sigue en pie: si el barrido se llevara el horneado del
  // almacén por delante, un menú dejaría de ser indexable sin que nadie lo note.
  it("pero sigue horneando los almacenes de lectura", () => {
    expect(leer("lib/projects.ts")).toMatch(/horneaLectura/);
  });
});
