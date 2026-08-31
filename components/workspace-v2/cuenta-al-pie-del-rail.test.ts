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

import { sinComentarios } from "@/lib/sin-comentarios";

const DIR = join(process.cwd(), "components/workspace-v2");
// Sin comentarios: una lápida que NOMBRA lo retirado no es lo retirado. Y el
// ORDEN de las dos pasadas importa — esta prueba se puso roja sin que nadie
// tocara lo que mide, porque un comentario nuevo de `account-menu.tsx` nombraba
// una ruta con comodín y eso abría un bloque falso que se tragaba el fichero.
// Ver `lib/sin-comentarios.ts`.
const leer = (f: string) => sinComentarios(readFileSync(join(DIR, f), "utf8"));

describe("la barra superior, EDITANDO, no habla de la persona", () => {
  // 🔴 ESTA PRUEBA CAMBIÓ DE FORMA EL MISMO DÍA, y no por capricho.
  //
  // Decía «la barra NO nombra `onToggleDark` en ninguna parte», y era cierto
  // mientras el taller tenía UNA sola barra. Esa tarde pasó a tener DOS: sin
  // proyecto abierto no hay rail —los cinco iconos actúan sobre una página que
  // no existe— y la cuenta, que vive a su pie, se iría con él. Así que en esa
  // pantalla vuelve arriba, o el usuario se queda sin idioma, sin tema y sin
  // cerrar sesión en cuanto sale de un proyecto.
  //
  // La decisión que hay que clavar no es «la barra nunca», es «la barra NO
  // cuando estás editando»: ahí el rail existe y esos tres huecos se los quitan
  // al nombre del proyecto, a los créditos y a Publicar.
  it("no pinta el idioma ni el avatar por su cuenta: sólo tras `inicio`", () => {
    const barra = leer("top-bar.tsx");
    // El selector de idioma NO lo monta la barra ni en la pantalla de inicio:
    // va dentro del menú de cuenta, que es quien lo lleva.
    expect(barra).not.toMatch(/LocaleSwitcher/);
    expect(barra).not.toMatch(/profileOpen/);
    // El único AccountMenu de la barra cuelga de `inicio`, o sea que editando
    // no se pinta. Sin esta comprobación, un `<AccountMenu>` suelto devolvería
    // el avatar a la barra del editor sin que nadie se enterara.
    const montajes = barra.match(/<AccountMenu/g) ?? [];
    expect(montajes.length, "la barra monta más de un AccountMenu").toBe(1);
    expect(barra).toMatch(/\{inicio && \(\s*<AccountMenu/);
  });

  it("y ni siquiera lee la sesión: habla del PROYECTO", () => {
    expect(leer("top-bar.tsx")).not.toMatch(/useSession/);
  });
});

describe("las dos pantallas del taller", () => {
  // Sin página abierta: ni rail, ni nombre de proyecto, ni Deploy. Con página:
  // el rail vuelve y la barra habla del proyecto.
  const pagina = sinComentarios(
    readFileSync(join(process.cwd(), "app/[locale]/new/page.tsx"), "utf8"),
  );

  it("el rail sólo existe con una página abierta", () => {
    expect(pagina).toMatch(/\{enElEditor && \(\s*<LeftSidebar/);
  });

  it("y sin ella la barra recibe la navegación global", () => {
    expect(pagina).toMatch(/inicio=\{/);
    // Las tres superficies suben A la barra. Lo que NO debe volver es la tira de
    // pestañas en el centro del lienzo: eran dos navegaciones compitiendo, y la
    // de abajo le robaba el centro al propio contenido de la pantalla.
    // Se busca su marca —el `aria-current` de la tira—, no la clave de i18n:
    // esa la sigue usando la barra para poner las etiquetas.
    expect(pagina).not.toMatch(/aria-current=\{startSurface === s/);
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
