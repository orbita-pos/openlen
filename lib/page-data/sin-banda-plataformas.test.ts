// LÁPIDA del 2026-08-29: muere la BANDA de plataformas, sobreviven los DATOS.
//
// Jesús: «alguien no va a querer tener su icono de YouTube en la esquina, va a
// querer una sección completa de su info… y capaz alguien quiera su página para
// cada red social. El problema viene si le digo al agente y dirá que sólo se
// puede así por el módulo».
//
// Tenía razón, y estaba escrito: el prompt le enseñaba al modelo que «el botón
// flotante de contacto, LA BANDA DE PLATAFORMAS y el pie… leen el PERFIL». O sea
// que las plataformas ERAN una banda horneada con su forma fija, no unos enlaces
// que él pudiera maquetar. Un TECHO — la misma forma que tenían las conductas
// antes de JS libre.
//
// LO QUE SOBREVIVÍA, y ya no: `profile.links`, el campo del perfil de donde
// salían los enlaces. El 2026-08-31 se retiró el perfil ENTERO —tabla incluida—
// y con él ese campo. La preocupación no cambió: un @usuario inventado en una
// página publicada es el peor sitio donde puede estar un dato falso, porque
// lleva a la cuenta de otra persona.
//
// Lo que la atiende ahora es otra cosa: el modelo escribe los enlaces DENTRO
// del documento con el destino que le dio el dueño, y la prohibición de
// inventárselos vive en el prompt. Es lo que se clava abajo.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const leer = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

describe("la banda de plataformas ya no se hornea", () => {
  it("publicar no la inyecta", () => {
    const fuente = leer("lib/publish/filesystem.ts");
    expect(fuente).not.toMatch(/PLATFORMS_BAND_MARKER/);
    expect(fuente).not.toMatch(/platforms-band/);
  });

  it("la vista previa tampoco", () => {
    expect(leer("lib/publish/preview-bake.ts")).not.toMatch(/platforms-band/);
  });

  // Lo que de verdad importa: que el modelo deje de creer que existe una forma
  // prescrita. Mientras el prompt la nombre, seguirá ofreciéndola.
  it("el prompt del Agente no le ofrece una banda", () => {
    expect(leer("lib/agent/catalog.ts")).not.toMatch(/banda de plataformas/i);
  });
});

// ⚰️ AQUÍ VIVÍA `preview-bake-platforms-resolver.test.ts`, una prueba contra la
// base de datos que fijaba algo que costó encontrar: la vista previa tenía que
// resolver el perfil «el enlazado primero, y si no el de por defecto» —no parar
// en un join estricto contra `projects.profileId`—, porque esa columna es ON
// DELETE SET NULL y un proyecto sin enlace explícito pero con un dueño que sí
// tiene negocio DEBÍA llenar la banda igual.
//
// Se va con la banda: su sujeto era llenarla. El conocimiento queda escrito
// aquí porque el día que algo vuelva a leer el perfil desde la vista previa, esa
// resolución sigue siendo la correcta.

describe("y el perfil entero se fue detrás", () => {
  // 🔴 INVERTIDA en el paso 5 (2026-08-31). Decía «el perfil conserva sus
  // enlaces» y leía `lib/business-profiles/types.ts` para clavar que el campo
  // `links` siguiera ahí — porque de ahí salían los @usuario que el modelo no
  // debe inventarse. Ese fichero era el último del perfil y se fue con la tabla.
  //
  // LA REGLA NO SE FUE CON ÉL, y es lo único que de verdad protegía esto: los
  // enlaces los escribe ahora el modelo DENTRO del documento, y la prohibición
  // de inventárselos vive en el prompt. Es lo que clava la prueba de abajo, que
  // era la que importaba desde el principio.
  it("no queda ni el módulo de tipos", () => {
    expect(existsSync(join(process.cwd(), "lib/business-profiles"))).toBe(false);
  });

  // ⚰️ Aquí se fijaba que «Mi negocio» siguiera siendo donde se editan esos
  // enlaces. Esa sección murió el 2026-08-31 con el perfil entero, y con ella
  // el último sitio del producto que pedía TECLEAR un dato antes de usarlo.
  //
  // Lo que ocupa su lugar es la propia página: el modelo escribe el `<a
  // href="https://instagram.com/…">` con el destino que el dueño le dio, y ese
  // enlace se edita como cualquier otro. La regla contra inventarlos no se fue
  // con el perfil — vive en el prompt, y esto la fija.
  it("y el modelo sigue teniendo prohibido inventarse un @usuario", () => {
    expect(leer("lib/agent/catalog.ts")).toMatch(/NUNCA inventes un enlace/);
  });
});
