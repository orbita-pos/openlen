import { describe, expect, it } from "vitest";
import { buildAgentSystemPrompt } from "./agent/catalog";
// NOT imported from the route.ts files themselves: a Next.js `route.ts` file
// may only export the recognized route-handler bindings (GET/POST/runtime/…)
// — Next's generated .next/types/app/api/**/route.ts type-checks the
// module's exports against that whitelist, so `export const SYSTEM_PROMPT`
// inside route.ts fails `tsc --noEmit`. Both routes split their prompt into
// a sibling system-prompt.ts (a plain module Next's router never touches,
// and — usefully for this test — with no native/DB/auth imports, so it can
// be statically imported straight under vitest, no node:test needed).
import { generateSystemMessage } from "../app/api/generate/system-prompt";
import { aiDesignSystemMessage } from "../app/api/templates/ai-design/system-prompt";

// ESTE FICHERO SE LLAMABA `design-guidance-seam.test.ts` y su mitad principal
// era «el guardia de la costura»: vigilaba que las superficies siguieran
// ofreciendo las 9 CONDUCTAS, por si alguien cambiaba el import de
// `lib/design-guidance` por `lib/design-guidance-v2.ts` —un fork sin commitear
// que traía la mentira «procedural <script> IS OK» y cero noción de conductas—.
//
// Esa mitad se borró el 2026-08-28, por dos motivos independientes:
//
//  1. `lib/design-guidance-v2.ts` YA NO EXISTE. El guardia vigilaba una puerta
//     tapiada.
//  2. Las conductas se RETIRARON el 2026-08-23. Una prueba que EXIGE que el
//     prompt siga ofreciendo el mecanismo retirado no protege nada: sujeta lo
//     viejo justo donde nadie mira. Mismo patrón que la prueba que exigía que
//     el prompt siguiera ofreciendo Pedidos.
//
// Y de paso midió algo real: la mitad que afirmaba sobre `crear` miraba
// `SYSTEM_PROMPT`, una constante que la ruta NO manda (manda
// `generateSystemMessage`, con el contrato mínimo aplicado). Verde sin exigir
// nada. Por eso la lista de abajo llama a lo que producción manda de verdad.

// Ninguna superficie manda gusto nuestro. Volvió por tres puertas en un día:
// el esqueleto de secciones dentro de DESIGN_GUIDANCE, la captura de una
// plantilla curada adjunta al brief, y un segundo mensaje `<reference>` que se
// presentaba al modelo como "the design taste catalog" — ése pasaba por debajo
// de una guarda que sólo miraba el system prompt.
//
// Lo que sí viaja es contrato: el vocabulario de tokens, del que dependen los
// controles de tema del editor.
describe("ninguna superficie manda gusto nuestro", () => {
  // LO QUE PRODUCCIÓN MANDA, no la constante de al lado. `crear` sustituye el
  // contrato por el mínimo y cambia las cláusulas del JavaScript en el
  // ensamblado; afirmar sobre `SYSTEM_PROMPT` medía otra jaula que la que
  // reciben las páginas de la gente.
  const PROMPTS: Array<[string, () => string]> = [
    ["crear", () => generateSystemMessage({})],
    ["editar", () => aiDesignSystemMessage()],
    ["Agente", () => buildAgentSystemPrompt()],
  ];

  // POR SUSTANCIA, NO POR ENCABEZADO. Esto afirmaba
  // `toContain("DESIGN CONTRACT — token vocabulary")`, el literal INGLÉS del
  // contrato completo — y pasaba porque miraba la constante `SYSTEM_PROMPT` de
  // crear en vez de lo que su ruta manda. Al apuntar a producción se cayó: el
  // contrato mínimo dice lo mismo en español («COLOR, FORMA Y TIPOGRAFÍA —
  // vocabulario obligatorio»). El encabezado es redacción; lo que el editor
  // necesita son los tokens y el bloque oscuro.
  it.each(PROMPTS)("%s exige el vocabulario de tokens", (_name, getPrompt) => {
    const p = getPrompt();
    expect(p, "sin --accent los controles de acento del editor no tienen a qué agarrarse").toContain("--accent");
    expect(p, "sin var() el color se repite a mano y el tema no se puede cambiar").toContain("var()");
    expect(p, "sin :root.dark la página no puede voltear a oscuro").toContain(":root.dark");
  });

  // NINGÚN PROMPT OFRECE UN MECANISMO RETIRADO COMO SI SIGUIERA VIVO.
  //
  // El contrato decía, dentro de la regla que prohíbe maquetar un login:
  // «(When the owner turns on the Members module, a real sign-in link is added
  // automatically at publish time)». Miembros se retiró el 2026-08-21, así que
  // el paréntesis prometía una tubería que ya no existe — y de paso insinuaba
  // que un enlace de sesión SÍ puede aparecer legítimamente, justo lo contrario
  // de la regla a la que acompañaba.
  //
  // Se comprueba en INGLÉS a propósito: el Agente nombra los módulos retirados
  // en español y DEBE hacerlo — «Reservas, Pedidos … SE RETIRARON» es la frase
  // que le impide fingir que activó uno. Lo que no puede aparecer es la ficha
  // en inglés que los presenta como maquinaria disponible.
  const RETIRADOS = [
    "Members module", "Bookings module", "Orders module",
    "Comments module", "Broadcast module",
  ];
  it.each(PROMPTS)("%s no ofrece ningún módulo retirado", (_name, getPrompt) => {
    // Aplanado ANTES de buscar: el contrato va envuelto a 76 columnas y
    // «Members module» cae partido en dos renglones. Sin esto la guarda pasaba
    // en verde con la promesa puesta — lo cazó su propio brazo de control.
    const p = getPrompt().replace(/\s+/g, " ");
    for (const m of RETIRADOS) {
      expect(p, `el prompt todavía ofrece «${m}», retirado el 2026-08-21`).not.toContain(m);
    }
  });

  // LAS CONDUCTAS, IGUAL. Se retiraron el 2026-08-23 y el JavaScript libre las
  // sustituye: «haz que este botón filtre» lo resuelve el modelo escribiéndolo,
  // no cableando `data-ol-filter`.
  //
  // Esta afirmación es la INVERSA de la que vivía aquí hasta el 2026-08-28
  // («%s todavía ofrece CONDUCTAS»), y no fue un cambio cosmético: `editar`
  // seguía mandando la sección entera con sus 9 marcadores —10.603 caracteres—
  // mientras crear y el Agente mandaban 0. Era la única superficie que
  // interpolaba `PUBLISH_CONTRACT` en crudo, sin pasar por `swapJsClauses`.
  //
  // Y no era código muerto: `chat-panel.tsx` cae a `ai-design` EN SILENCIO
  // cuando un turno del Agente falla.
  it.each(PROMPTS)("%s no ofrece las CONDUCTAS retiradas", (_name, getPrompt) => {
    const p = getPrompt();
    expect(p, "la sección CONDUCTAS volvió al prompt").not.toContain("CONDUCTAS");
    // Los marcadores, uno a uno: la sección puede irse y dejar detrás el manual
    // del carrusel, que es exactamente lo que pasó el 2026-08-23.
    for (const marcador of [
      "data-ol-countdown", "data-ol-filter", "data-ol-lightbox",
      "data-ol-copy", "data-ol-autoplay", "data-ol-theme",
      "data-ol-sticky", "data-ol-tabs", "data-ol-calc",
      "data-ol-row", "data-ol-scroller",
    ]) {
      expect(p, `el prompt todavía enseña a cablear «${marcador}»`).not.toContain(marcador);
    }
  });

  // Y en su lugar, las tres dicen que el JavaScript lo escribe el modelo. Sin
  // esto, quitar las conductas dejaría a `editar` sin conductas Y sin
  // JavaScript: un modelo que no puede construir NINGUNA interactividad, que es
  // peor que el punto de partida.
  it.each(PROMPTS)("%s sí ofrece el JavaScript del modelo", (_name, getPrompt) => {
    const p = getPrompt().replace(/\s+/g, " ");
    expect(p).toMatch(/SURVIVES publication|sobrevive a la publicación|sobrevive al guardar/i);
    // La mitad que se olvida: un `on*` se borra al guardar, así que un botón
    // cableado así nace mudo aunque el script sobreviva entero.
    expect(p).toContain("addEventListener");
  });

  const GUSTO = [
    ["el orden de las secciones", "SECTION SKELETON"],
    ["la barra de diseño", "DESIGN BAR"],
    ["las marcas ficticias", "FICTIONAL BRANDS"],
    ["las precisiones tipográficas", "TYPOGRAPHY PRECISIONS"],
    ["los fragmentos copiados de Mirror", "reference-snippet"],
    ["las recetas de CSS", "CSS RECIPES"],
    ["la presión a comprimir la salida", "OUTPUT EFFICIENCY"],
    ["el ojo de otras cuatro empresas", "Linear"],
  ] as const;

  for (const [surface, getPrompt] of PROMPTS) {
    it.each(GUSTO)(`${surface} no lleva %s`, (_name, marker) => {
      expect(getPrompt()).not.toContain(marker);
    });
  }

  // Las fuentes son gusto, no contrato. NADA en la tubería exige una lista:
  // normalize_font iza la familia que venga (su <link> de 12 es precarga, no
  // lista blanca), el saneador no toca <link>, y la CSS de publicación deja
  // `style-src` sin fijar. Aun así las tres superficies decían "Allowed
  // families:" con seis — y por eso una página de terror no podía tener
  // tipografía de terror.
  it.each(PROMPTS)("%s no cierra la lista de tipografías", (_name, getPrompt) => {
    expect(getPrompt()).not.toMatch(/Allowed families/i);
  });

  // El catálogo de gusto no viajaba por el system prompt sino por un mensaje
  // aparte, así que la guarda tiene que mirar el código, no sólo el prompt.
  it("nadie importa el catálogo de gusto", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === ".next") continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) { walk(full); continue; }
        if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue;
        if (full.endsWith(join("lib", "design-guidance.ts"))) continue;
        if (readFileSync(full, "utf8").includes("DESIGN_REFERENCE")) offenders.push(full);
      }
    };
    walk(join(process.cwd(), "app"));
    walk(join(process.cwd(), "lib"));
    expect(offenders, offenders.join(", ")).toEqual([]);
  });
});
