import { describe, expect, it } from "vitest";

import { isReserved } from "./reserved";
import { validateSubdomain } from "./validate";
import { LIBRERIAS_HOST } from "@/lib/librerias";

// LO QUE VIGILA ESTA PRUEBA: que ningún host de infraestructura nuestro sea
// reclamable como subdominio de usuario.
//
// Las páginas publicadas y nuestros orígenes de R2 comparten el mismo comodín
// `*.openlen.com` (`infra/caddy/Caddyfile`). El DNS de Cloudflare manda un
// puñado de nombres a R2 antes de llegar al box, pero la lista de subdominios
// reservados es cosa aparte y NO se derivaba de ninguna de las dos: el
// 2026-09-01 `libs`, `uploads`, `templates` e `images` estaban los cuatro
// libres, y cualquiera podía reclamarlos desde Deploy.
//
// `libs` es el que duele: es el origen que `lib/librerias.ts` le da a TODOS los
// modelos para cargar JavaScript. Quien lo reclame sirve lo suyo en esas rutas.
// Lo contiene el `integrity` del catálogo, pero una etiqueta sin SRI ejecutaría
// lo que hubiera — o sea que reservarlo es defensa en profundidad, no adorno.

/** `libs.openlen.com` → `libs`. Derivado, para que renombrar el host no deje
 *  esta prueba comprobando una etiqueta que ya no existe. */
const etiquetaDeLibrerias = LIBRERIAS_HOST.split(".")[0]!;

describe("los orígenes de infraestructura no son reclamables", () => {
  it(`el host de librerías (${LIBRERIAS_HOST}) está reservado`, () => {
    expect(isReserved(etiquetaDeLibrerias)).toBe(true);
  });

  // Los otros tres no tienen una constante de la que derivarlos; van a mano,
  // y con su origen escrito al lado para que se vea que no son inventados.
  for (const [etiqueta, donde] of [
    ["uploads", "R2_PUBLIC_URL por defecto — lib/storage/index.ts"],
    ["templates", "las plantillas curadas — lib/generation/template-object-reader.ts"],
    ["images", "la librería de fotos — lib/db/schema.ts"],
  ] as const) {
    it(`${etiqueta} está reservado (${donde})`, () => {
      expect(isReserved(etiqueta)).toBe(true);
    });
  }

  it("y el validador los rechaza de verdad, no sólo la lista", () => {
    // isReserved a solas no prueba nada si el validador no lo llama.
    for (const etiqueta of [etiquetaDeLibrerias, "uploads", "templates", "images"]) {
      const r = validateSubdomain(etiqueta);
      expect(r.ok, `${etiqueta} debería rechazarse`).toBe(false);
    }
  });

  it("un nombre normal sigue pasando", () => {
    // El brazo de control: si el validador rechazara TODO, lo de arriba pasaría
    // igual y no estaría comprobando nada.
    expect(isReserved("clinica-rios")).toBe(false);
    expect(validateSubdomain("clinica-rios").ok).toBe(true);
  });
});
