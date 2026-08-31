// LOS AJUSTES DE LA PERSONA VIVEN AL PIE DEL RAIL, no en la barra de arriba.
//
// El 2026-08-31 bajaron ahí el idioma, el conmutador de claro/oscuro y el
// avatar con su menú. Los tres son ajustes de la PERSONA, no del sitio que
// edita, y cobraban tres huecos permanentes en la fila donde viven el nombre
// del proyecto, los créditos y Publicar. El idioma solo medía 100px — más que
// el botón de Deploy — en una barra donde a 390px el nombre del proyecto se
// quedaba en 32.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(process.cwd(), "components/workspace-v2");
/** Sin comentarios: una lápida que NOMBRA lo retirado no es lo retirado. */
const leer = (f: string) =>
  readFileSync(join(DIR, f), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");

describe("la barra superior ya no habla de la persona", () => {
  it("no pinta el idioma ni el claro/oscuro ni el avatar", () => {
    const barra = leer("top-bar.tsx");
    expect(barra).not.toMatch(/LocaleSwitcher/);
    expect(barra).not.toMatch(/onToggleDark/);
    expect(barra).not.toMatch(/profileOpen/);
  });

  it("y ni siquiera lee la sesión: habla del PROYECTO", () => {
    expect(leer("top-bar.tsx")).not.toMatch(/useSession/);
  });
});

describe("el menú de cuenta", () => {
  it("existe y reúne los tres ajustes", () => {
    expect(existsSync(join(DIR, "account-menu.tsx"))).toBe(true);
    const menu = leer("account-menu.tsx");
    expect(menu).toMatch(/LocaleSwitcher/);
    expect(menu).toMatch(/onToggleDark/);
    expect(menu).toMatch(/signOut/);
    // El sonido del editor viajó con ellos — era el único sitio desde donde se
    // alcanzaba, así que perderlo lo habría dejado inalcanzable.
    expect(menu).toMatch(/onToggleSoundMute/);
  });

  // Está anclado ABAJO del todo y pegado al borde izquierdo de la pantalla:
  // abrirlo hacia abajo lo sacaría de la ventana, y hacia la izquierda no hay
  // ventana.
  it("se abre hacia arriba y hacia la derecha", () => {
    expect(leer("account-menu.tsx")).toMatch(/bottom-0[\s\S]{0,40}left-full/);
  });

  it("lo monta el rail, no la barra", () => {
    const rail = leer("left-sidebar.tsx");
    expect(rail).toMatch(/<AccountMenu/);
    // LAS DOS RAMAS: el rail se pinta dos veces —plegado y desplegado— y una
    // sola llamada dejaría al usuario sin cuenta en una de ellas.
    expect((rail.match(/<AccountMenu/g) ?? []).length).toBe(2);
  });

  // BRAZO DE CONTROL: `mt-auto` es lo único que lo pega al fondo. Sin él el
  // avatar sale pegado al último icono del rail y deja de leerse como "tú".
  it("y va pegado al fondo, no detrás del último icono", () => {
    expect(leer("account-menu.tsx")).toMatch(/mt-auto/);
  });
});
