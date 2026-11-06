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
  // 🔴 Y DESDE EL 06/11, TAMPOCO EN LA PANTALLA DE INICIO: ahí ya no hay barra
  // (Jesús, sobre la de Gemini: «/new y / quiero que sea compartido»). Sin
  // proyecto, el marco de inicio pone su propio rail —con la navegación global—
  // y la cuenta a SU pie (`start-rail.tsx`). La barra vuelve a hablar sólo del
  // proyecto, y el modo `inicio` que la volvía navegación se fue.
  it("no pinta el idioma ni el avatar, nunca: la cuenta vive al pie de un rail", () => {
    const barra = leer("top-bar.tsx");
    expect(barra).not.toMatch(/LocaleSwitcher/);
    expect(barra).not.toMatch(/profileOpen/);
    expect(barra).not.toMatch(/<AccountMenu/);
    expect(barra).not.toMatch(/\binicio\b/);
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

  it("el rail del proyecto sólo existe con una página abierta; sin ella, el de inicio", () => {
    // Y no en el proyecto en blanco (12/10): hasta el primer mensaje es la
    // portada, con el marco de inicio.
    expect(pagina).toMatch(/\{pantallaDeInicio \? \(\s*<StartRail[\s\S]*?\) : \(\s*<LeftSidebar/);
    expect(pagina).toMatch(/const pantallaDeInicio =\s*!enElEditor \|\|\s*proyectoEnBlanco \|\|/);
  });

  it("y sin ella no hay barra: la navegación global va en el rail de inicio, con la cuenta a su pie (06/11)", () => {
    expect(pagina).toMatch(/\{!pantallaDeInicio && \(\s*<TopBar/);
    expect(pagina).not.toMatch(/inicio=\{/);
    expect(pagina).toMatch(/<StartRail[\s\S]{0,1500}account=\{\s*<AccountMenu/);
    // Lo que NO debe volver es la tira de pestañas en el centro del lienzo: eran
    // dos navegaciones compitiendo, y la de abajo le robaba el centro al propio
    // contenido de la pantalla.
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
