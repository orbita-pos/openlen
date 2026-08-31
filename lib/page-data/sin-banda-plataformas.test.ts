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
// LO QUE SOBREVIVE, y por qué: `profile.links` sigue en el perfil del negocio.
// Sin esos datos el modelo se inventaría los enlaces, y un @usuario falso en una
// página publicada es el peor sitio donde puede estar un dato inventado.
import { readFileSync } from "node:fs";
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

describe("pero los datos del negocio siguen", () => {
  it("el perfil conserva sus enlaces", () => {
    // Sin esto el modelo se inventaría los @usuario, que es el peor dato falso
    // posible: uno que lleva a la cuenta de otra persona.
    expect(leer("lib/business-profiles/types.ts")).toMatch(/links\?: BusinessProfileLink\[\]/);
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
