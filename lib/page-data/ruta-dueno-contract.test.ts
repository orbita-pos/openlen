// El contrato de la ruta que usa la pestaña de Datos, fijado como TEXTO.
//
// Se comprueba sobre el fichero en vez de levantar Next porque lo que hay que
// impedir es que alguien quite una de las dos comprobaciones en un refactor: sin
// sesión, o sin propiedad, esta ruta entrega los datos de cualquier proyecto a
// cualquiera que sepa un id.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ruta = readFileSync(
  join(process.cwd(), "app", "api", "projects", "[id]", "datos", "route.ts"),
  "utf8",
);

describe("la ruta de Datos del taller", () => {
  it("exige sesión", () => {
    expect(ruta).toContain("await auth()");
  });

  // Sin comprobar la propiedad, cualquier usuario con sesión lee los datos de
  // cualquier proyecto cambiando el id de la URL.
  it("comprueba que el proyecto es de quien pregunta", () => {
    expect(ruta).toMatch(/eq\(schema\.projects\.userId,[\s\S]{0,40}\)/);
  });

  // 401 sin sesión y 404 si no es tuyo, como el resto de rutas de proyecto: un
  // 403 confirmaría que ese proyecto EXISTE, que ya es más de lo que un extraño
  // debería poder averiguar.
  it("distingue «sin sesión» de «no es tuyo»", () => {
    expect(ruta).toMatch(/unauthorized[\s\S]{0,40}401|401[\s\S]{0,40}unauthorized/);
    expect(ruta).toMatch(/not_found[\s\S]{0,40}404|404[\s\S]{0,40}not_found/);
  });

  it("corre en nodejs y sin caché", () => {
    expect(ruta).toContain('export const runtime = "nodejs"');
    expect(ruta).toContain('export const dynamic = "force-dynamic"');
  });

  // El plan del dueño decide la cuota, y sale de la base — no de un valor por
  // defecto en la ruta.
  it("no inventa el plan", () => {
    expect(ruta).not.toMatch(/plan:\s*"free"/);
  });
});
