// El contrato de códigos de la ruta, fijado como TEXTO.
//
// Se comprueba sobre el fichero y no levantando Next a propósito: lo que hay que
// impedir es que alguien cambie `403` por `404` en un refactor y que el JS que
// el modelo ya escribió deje de distinguir «no puedes» de «no existe». Esos
// códigos son API pública en cuanto la primera página los use.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ruta = readFileSync(
  join(process.cwd(), "app", "api", "d", "[sub]", "[store]", "route.ts"),
  "utf8",
);

describe("contrato de la ruta de datos", () => {
  it.each([
    ["almacen_no_declarado", 404],
    ["no_permitido", 403],
    ["documento_grande", 413],
    ["cuota_llena", 507],
    ["demasiadas_peticiones", 429],
  ])("%s responde %i", (codigo, status) => {
    const re = new RegExp(
      `${codigo}[\\s\\S]{0,160}?${status}|${status}[\\s\\S]{0,160}?${codigo}`,
    );
    expect(ruta).toMatch(re);
  });

  it("corre en nodejs y sin caché", () => {
    expect(ruta).toContain('export const runtime = "nodejs"');
    expect(ruta).toContain('export const dynamic = "force-dynamic"');
  });

  // El origen se comprueba SIEMPRE: sin esto, la página de un proyecto escribe
  // en la base de otro con sólo cambiar el `sub` de la URL.
  it("comprueba el origen del subdominio", () => {
    expect(ruta).toContain("checkSubdomainOrigin");
    // Y con TODOS los dominios publicados: comprobar sólo uno convierte al otro
    // en un agujero, porque .com y .app sirven las mismas carpetas.
    expect(ruta).toContain("publishedBaseHosts()");
  });

  it("limita por IP", () => {
    expect(ruta).toContain("checkAndConsume");
  });

  // La cuota se comprueba con el plan del DUEÑO del proyecto, no con uno fijo.
  it("la cuota mira el plan del dueño", () => {
    expect(ruta).toContain("schema.users.plan");
  });
});
