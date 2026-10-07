import { afterEach, describe, expect, it, vi } from "vitest";
import { instruccionesDeLen, buildFunctionDeclarations } from "./agent/catalog";
import { TOKENS_DEL_CONTRATO } from "./agent/tools";
import { diagnosticosDeLaEscritura } from "./agent/diagnosticos-de-la-escritura";
// NOT imported from the route.ts files themselves: a Next.js `route.ts` file
// may only export the recognized route-handler bindings (GET/POST/runtime/…)
// — Next's generated .next/types/app/api/**/route.ts type-checks the
// module's exports against that whitelist, so `export const SYSTEM_PROMPT`
// inside route.ts fails `tsc --noEmit`. The Chat route splits its prompt into
// a sibling system-prompt.ts (and so did `/api/generate`, retired with Crear
// on 2026-10-06) (a plain module Next's router never touches,
// and — usefully for this test — with no native/DB/auth imports, so it can
// be statically imported straight under vitest, no node:test needed).
import { aiDesignSystemMessage } from "../app/api/templates/ai-design/system-prompt";
import { conContratoMinimo, PUBLISH_CONTRACT_MIN } from "./publish-contract-min";

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
  // LO QUE PRODUCCIÓN MANDA, no la constante de al lado: afirmar sobre una
  // constante medía otra jaula que la que reciben las páginas de la gente.
  // ⚰️ «crear» (`/api/generate`) se fue el 2026-10-06: crear es el primer
  // mensaje a Len, que ya está en la lista.
  const PROMPTS: Array<[string, () => string]> = [
    ["editar", () => aiDesignSystemMessage()],
    ["Agente", () => instruccionesDeLen()],
    // ⚰️ «rediseño» (`lib/agent/redesign.ts`, `redisenar_pagina`) se retiró con
    // Len 2.0: un Write hace lo mismo sin un segundo modelo (decisión B8).
  ];

  // POR SUSTANCIA, NO POR ENCABEZADO. Esto afirmaba
  // `toContain("DESIGN CONTRACT — token vocabulary")`, el literal INGLÉS del
  // contrato completo — y pasaba porque miraba la constante `SYSTEM_PROMPT` de
  // crear en vez de lo que su ruta manda. Al apuntar a producción se cayó: el
  // contrato mínimo dice lo mismo en español («COLOR, FORMA Y TIPOGRAFÍA —
  // vocabulario obligatorio»). El encabezado es redacción; lo que el editor
  // necesita son los tokens y el bloque oscuro.
  //
  // ⚠️ Y ACTUALIZADA EL 2026-09-04, porque estaba sujetando la mitad rota.
  // Exigía `--accent` y `:root.dark`, que es EXACTAMENTE el vocabulario que el
  // editor NO lee: sus controles escriben `--ol-*` y conmutan el atributo
  // `data-ol-mode`. Los mensajes de esta prueba decían «sin --accent los
  // controles del editor no tienen a qué agarrarse» — cierto en la intención y
  // falso en el token, así que la prueba pasaba en verde mientras la función
  // que dice proteger llevaba meses muerta. Una prueba que fija el nombre
  // equivocado no es cobertura: es la mentira, sujeta.
  //
  // 🔴 Y LEN YA NO, desde el 2026-09-29 (OK de Jesús). El Tema descubre qué
  // variables lee la página y escribe en ésas, y conmuta su propio interruptor
  // oscuro (`el-tema-sigue-a-la-pagina.browser.test.ts`): el prefijo `--ol-`
  // protegía al editor de un defecto suyo, no al modelo de uno propio. El Chat
  // lo sigue recibiendo (Crear, que también, se retiró el 2026-10-06).
  const CON_VOCABULARIO_OL = PROMPTS.filter(([n]) => n !== "Agente");
  it.each(CON_VOCABULARIO_OL)("%s exige el vocabulario de tokens", (_name, getPrompt) => {
    const p = getPrompt();
    expect(p, "sin --ol-accent los controles de acento del editor no tienen a qué agarrarse").toContain("--ol-accent");
    expect(p, "sin var() el color se repite a mano y el tema no se puede cambiar").toContain("var()");
    expect(p, "sin el selector del editor la página no puede voltear a oscuro").toContain(
      ':root[data-ol-mode="dark"]',
    );
  });

  it("Len: sus colores en variables de :root, con SUS nombres, y el oscuro con el interruptor que elija", () => {
    const p = instruccionesDeLen();
    // Lo que el Tema sí necesita: los colores en variables.
    expect(p, "sin var() el color se repite a mano y el tema no se puede cambiar").toContain("used with `var()`");
    expect(p).toContain("with names of your choosing");
    // …y cómo las encuentra, que es contrato de NUESTRA API, no gusto.
    expect(p).toContain("they find them by how the page uses them");
    // El interruptor oscuro, cualquiera sobre <html>; la media query sola no.
    expect(p).toContain("under a class or an attribute of `<html>`");
    expect(p).toContain("`prefers-color-scheme` is one it can't turn on");
    // Lo que ya no recibe.
    expect(p).not.toContain("required vocabulary");
    expect(p).not.toContain("the `--ol-` prefix");
    expect(p).not.toContain(':root[data-ol-mode="dark"]');
    expect(p).not.toContain("--ol-");
  });

  it("Len: los <iframe> sobreviven todos, y su script va donde él quiera", () => {
    const p = instruccionesDeLen();
    expect(p).toContain("The `<iframe>`s you write survive everything");
    // Existían porque el editor borraba el iframe y el <script> anidado al
    // retocar a mano; ya no (`el-editor-no-borra-el-codigo.browser.test.ts`).
    expect(p).not.toContain("Spotify");
    expect(p).not.toContain("at the end of the body");
    // El orden que sí importa: la librería antes que su código.
    expect(p).toContain("They go in the <head>, before your own <script>");
  });

  it("CONTRA-PRUEBA: el Chat las sigue recibiendo", () => {
    const p = aiDesignSystemMessage();
    expect(p).toContain("Spotify, Calendly");
    expect(p).toContain("required vocabulary");
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
  // Se comprueba la ficha en INGLÉS que los presenta como maquinaria
  // disponible. El prompt del Agente ya no los nombra ni en español
  // (auditoría del 2026-09-29: Claude Code no enumera lo que no existe); que
  // no finja haber activado uno lo sujetan dos puertas de código, el enum de
  // `toggle_module` y `INSISTE_SIN_EFECTO`.
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
  it.each(PROMPTS)("%s sí ofrece el JavaScript del modelo", (name, getPrompt) => {
    const p = getPrompt().replace(/\s+/g, " ");
    expect(p).toMatch(/SURVIVES publication|SURVIVES publishing|survives saving/i);
    // «Usa `addEventListener`, no `onclick`» existía porque el editor borraba
    // los `on*` al retocar a mano. Desde el 2026-09-29 no los borra
    // (lib/publish/el-on-del-modelo.test.ts), así que Len ya no la recibe: una
    // regla que protegía a la plataforma de un defecto suyo. El Chat la sigue
    // teniendo.
    if (name === "Agente") expect(p).not.toContain("addEventListener");
    else expect(p).toContain("addEventListener");
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

/**
 * UNA PALANCA, CUATRO SUPERFICIES.
 *
 * `OPENLEN_MIN_CONTRACT` existía desde el 2026-08-23 y lo leía SÓLO `crear`.
 * Las otras tres mandaban `PUBLISH_CONTRACT` entero sin que nadie lo hubiera
 * decidido: simplemente nunca se les cableó. Y la vez anterior que una
 * capacidad se leyó por superficie, cada una entendió una cosa distinta
 * (hallazgo 1 del 2026-08-26).
 *
 * MEDIDO el 2026-09-01, en caracteres de lo que sale de cada función:
 *   crear     17.738 → 13.316   editar   20.590 → 16.168
 *   Agente    36.445 → 32.023   rediseño 27.198 → 10.509
 * Las tres primeras ahorran lo mismo (−4.422) porque el recorte es el mismo
 * trozo de contrato; el rediseño ahorra cuatro veces más porque además dejó de
 * interpolar `DESIGN_GUIDANCE` entera.
 */
describe("el contrato mínimo alcanza a las superficies", () => {
  // ⚰️ «crear» se fue con `/api/generate` el 2026-10-06.
  const SUPERFICIES: Array<[string, () => string]> = [
    ["editar", () => aiDesignSystemMessage()],
    ["Agente", () => instruccionesDeLen()],
  ];

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(SUPERFICIES)("%s manda el contrato MÍNIMO por defecto", (_n, getPrompt) => {
    const p = getPrompt();
    // La cabecera del mínimo, en inglés desde la traducción (2026-10-02).
    expect(p).toContain("WHAT PUBLISHING REQUIRES");
    // Y NO la del completo, que es lo que se estaba mandando.
    expect(p).not.toContain("OUTPUT FORMAT — strict rules");
  });

  it.each(SUPERFICIES)("%s vuelve al completo con OPENLEN_MIN_CONTRACT=0", (_n, getPrompt) => {
    vi.stubEnv("OPENLEN_MIN_CONTRACT", "0");
    expect(getPrompt()).toContain("OUTPUT FORMAT — strict rules");
  });

  /**
   * 🔴 EL ÚNICO DEFECTO DE PRODUCTO MEDIDO EL 2026-09-07, y su mecanismo.
   *
   * `/equipo` de un sitio de varias páginas nacía rota en móvil con la portada
   * impecable: un SVG con `width="320"` dentro de una tarjeta con relleno da
   * 385,6 px de ancho MÍNIMO, y una pista de rejilla de 341,6 px no lo encoge.
   * Medido en Chromium a 375 px: 9 elementos fuera, borde a 403 px.
   *
   * El contrato ya pedía «legible y usable desde 360 px», que es la META. Le
   * faltaba el MECANISMO, y sin él la regla no es accionable: el modelo no tiene
   * por qué saber que un atributo de ancho fija el mínimo de la pista.
   *
   * LA FRASE ESTÁ MEDIDA, no razonada. Sobre el artefacto REAL, en el navegador:
   *
   *   crudo                        9 fuera · scrollWidth 404 · borde 403
   *   con `max-w-full h-auto`      0 fuera · scrollWidth 375 · SVG 275x189
   *
   * Se eligió `max-w-full` y no `w-full` porque esta viñeta cubre también los
   * iconos: `max-w-` sólo ACOTA y nunca agranda. Las dos variantes se midieron y
   * dan el mismo resultado sobre el caso roto.
   */
  it.each(SUPERFICIES)("🔴 %s: el contrato dice CÓMO se dimensiona una imagen, no sólo que la página quepa", (_n, getPrompt) => {
    const p = getPrompt();
    expect(p).toContain('class="max-w-full h-auto"');
    // La meta sigue estando: el mecanismo la acompaña, no la sustituye.
    expect(p).toContain("Readable and usable from 360 px wide");
  });

  // EL MÍNIMO ADELGAZA DE VERDAD. Sin esta cuenta, la palanca podría estar
  // cableada y no recortar nada, que es justo el fallo que su guarda de
  // sustitución existe para impedir — pero desde el otro lado.
  it.each(SUPERFICIES)("%s pesa MENOS con el mínimo que con el completo", (_n, getPrompt) => {
    const conMin = getPrompt();
    vi.stubEnv("OPENLEN_MIN_CONTRACT", "0");
    expect(conMin.length).toBeLessThan(getPrompt().length);
  });

  /**
   * LA GUARDA DE LA SUSTITUCIÓN, desde el otro lado.
   *
   * `String.replace` que no encuentra su literal devuelve la cadena INTACTA:
   * un retoque de redacción en `PUBLISH_CONTRACT` dejaría la palanca sin efecto
   * y nadie se enteraría. El síntoma sería «el contrato mínimo ya no mejora»,
   * no «la sustitución no ocurrió».
   */
  it("LANZA cuando el contrato no aparece en el prompt", () => {
    expect(() => conContratoMinimo("un prompt cualquiera", "prueba")).toThrow(
      /no apareció en el prompt/,
    );
  });

  it("y con la palanca en 0 no lanza ni toca nada", () => {
    const r = conContratoMinimo("un prompt cualquiera", "prueba", {
      OPENLEN_MIN_CONTRACT: "0",
    });
    expect(r).toEqual({ prompt: "un prompt cualquiera", min: false });
  });
});


/**
 * EL CONTRATO, DICHO PARA CADA SUPERFICIE — 2026-09-04.
 *
 * Dos frases del contrato eran FALSAS en las superficies que EDITAN, y una
 * frase caducada dentro de un prompt no es suciedad: es una INSTRUCCIÓN, y el
 * modelo la obedece. El golden fija el texto ENTERO y por eso cazaría
 * cualquier deriva; esto fija el PORQUÉ, que un diff de 37.000 caracteres no
 * dice.
 *
 * Cada arreglo iba con su CONTRA-PRUEBA en `crear`, donde las dos frases eran
 * VERDAD (devolvía el documento entero y construía sus subpáginas declaradas).
 * Crear se retiró el 2026-10-06; la contra-prueba mira ahora el contrato
 * CRUDO: la frase sigue ahí, y lo que la quita es el corte por superficie
 * (`contratoParaSuperficie`). Sin eso, un «no la contiene» pasaría también si
 * alguien borrara la frase del contrato por error.
 */
describe("el contrato dicho para cada superficie", () => {
  const DOCUMENTO_ENTERO = "The first character of your response is";
  const EL_ENLACE_CREA = "and that page gets created";

  // 1. La respuesta del Agente son llamadas a herramientas más prosa para el
  //    usuario. El contrato le decía que empezara por `<` y acabara en
  //    `</html>`, contradiciendo su propio bloque TONO 130 líneas más arriba.
  it("el Agente NO recibe que su respuesta sea el documento entero", () => {
    expect(instruccionesDeLen()).not.toContain(DOCUMENTO_ENTERO);
  });

  it("el Chat tampoco: sólo el Modo B devuelve documento, así que no se afirma", () => {
    expect(aiDesignSystemMessage()).not.toContain(DOCUMENTO_ENTERO);
  });

  it("CONTRA-PRUEBA: el contrato crudo SÍ la trae — la quita el corte por superficie", () => {
    expect(PUBLISH_CONTRACT_MIN).toContain(DOCUMENTO_ENTERO);
  });

  // 2. Escribir `href="/servicios"` sólo creaba la página en `crear` (retirado
  //    el 2026-10-06). En las demás no crea nada: la ruta no existe, Caddy
  //    sirve la portada con un 200 y el enlace se rompe EN SILENCIO. O sea que
  //    el contrato enseñaba a cometer el fallo que otra de sus propias viñetas
  //    advierte.
  it("ninguna superficie recibe que un enlace CREA la página", () => {
    expect(PUBLISH_CONTRACT_MIN).toContain(EL_ENLACE_CREA);
    expect(instruccionesDeLen()).not.toContain(EL_ENLACE_CREA);
    expect(aiDesignSystemMessage()).not.toContain(EL_ENLACE_CREA);
  });

  it("y a las otras se les dice lo que SÍ pasa: la portada con un 200", () => {
    for (const p of [aiDesignSystemMessage()]) {
      expect(p).toContain("does NOT create that page");
    }
  });

  // 3. LA DUPLICACIÓN. El prompt del Agente decía once reglas dos veces porque
  //    sus REGLAS DURAS y el contrato cubren lo mismo. Se retiró la copia del
  //    contrato, que era la más pobre — pero SÓLO después de comparar las dos
  //    redacciones, y lo único que el contrato aportaba y su regla no se movió
  //    a la cláusula `agente`. Esta prueba es la que impide que una limpieza
  //    futura se lleve por delante una frase medida.
  //    El rediseño la repetía IGUAL, y se le aplicó el mismo arreglo el
  //    2026-09-04: su regla 5 traía la mitad corta y el contrato la completa,
  //    en las líneas 1146 y 1163 del golden. Las dos superficies van juntas
  //    aquí para que una limpieza futura no arregle una y deje la otra.
  //    Desde el 2026-09-29 Len ya no recibe una LISTA de permitidos —todo
  //    `<iframe>` sobrevive, también a la mano del usuario—, así que se cuenta
  //    la forma del mapa, que es lo que queda de aquel bloque.
  it("la lista de <iframe> permitidos se dice UNA vez, no dos", () => {
    for (const [nombre, prompt] of [
      ["agente", instruccionesDeLen()],
    ] as const) {
      const veces = prompt.split("maps.google.com/maps?q=").length - 1;
      expect(veces, `${nombre} la dice ${veces} veces`).toBe(1);
    }
  });

  // 3.b LAS «CONDUCTAS», retiradas el 2026-08-23. `bakeBehaviors` no tiene ni
  //     un solo call site fuera de su propio test, así que un marcador heredado
  //     es hoy un atributo INERTE: no recibe runtime al publicar. Nombrarlas en
  //     una lista de CONSERVA no protegía nada y enseñaba un vocabulario que ya
  //     no existe. No se pierde cobertura — la regla que las cubría sigue
  //     siendo «CONSERVA todo elemento que lleve un atributo data-ol-*».
  it("ninguna superficie nombra ya las conductas", () => {
    for (const p of [instruccionesDeLen()]) {
      expect(p).not.toMatch(/conductas?\b/i);
    }
    // Y el Agente ya no ofrece el rediseño con un segundo modelo: Len 2.0 lo
    // hace con un Write (plans/len-2/ficheros-plan.md, decisión B8).
    expect(buildFunctionDeclarations({}).find((d) => d.name === "redisenar_pagina")).toBeUndefined();
  });

  // Len 2.0: un Edit es un trozo, así que lo independiente tiene que ir en la
  // MISMA vuelta. Es la misma frase que usa Claude Code en
  // su prompt de sistema, en castellano.
  it("el Agente pide las llamadas independientes en paralelo, como Claude Code", () => {
    const p = instruccionesDeLen();
    expect(p).toContain("A single response can carry several tool calls");
    expect(p).toContain("send them together in that response");
    expect(p).toContain("they DON'T go together");
  });

  // SE MOVIÓ, NO SE PERDIÓ (2026-09-29, paso 6 de 2.5). La frase medida salió
  // del prompt de Len porque ahora la hace cumplir un diagnóstico, como Claude
  // Code no le pide al modelo que compile y se lo dice el LSP. Si alguien
  // quita el diagnóstico, esta prueba tiene que caer: la regla no puede
  // quedarse en ninguno de los dos sitios.
  it("«las dos mitades»: fuera del prompt del Agente, y la caza el diagnóstico", () => {
    expect(instruccionesDeLen()).not.toContain("BOTH HALVES");
    const html = '<!doctype html><html><head><style>.menu{display:none}</style></head><body><nav class="menu"></nav><script>m.classList.toggle("open")</script></body></html>';
    const ds = diagnosticosDeLaEscritura({ ruta: "/index.html", antes: null, despues: html, fuentes: [] });
    expect(ds.map((d) => d.codigo)).toContain("clase-sin-estilo");
  });

  it("NO SE PERDIÓ: el Agente conserva la lista de <iframe> y sus formas de URL", () => {
    const p = instruccionesDeLen();
    expect(p).toContain("player.vimeo.com/video/");
    expect(p).toContain("maps.google.com/maps?q=");
  });

  // 4. LAS ÓRDENES DE CONSTRUCCIÓN. «Tailwind por CDN en el `<head>`», «Google
  //    Fonts por <link> en el `<head>`» y «tu CSS propio en un <style> del
  //    `<head>`» son órdenes de CONSTRUIR un documento. Un turno de edición no
  //    construye ningún `<head>`: recibe uno hecho, y la única forma de
  //    "obedecer" sería duplicar el script y la hoja que ya estaban.
  it("las superficies que EDITAN no reciben la orden de construir el <head>", () => {
    for (const p of [instruccionesDeLen(), aiDesignSystemMessage()]) {
      expect(p).not.toContain("• Tailwind via CDN:");
      expect(p).not.toContain("• Your own CSS goes in a");
      // Y lo que SÍ reciben: dónde viven esas tres cosas, sin ordenar crearlas.
      // (Desde el 2026-10-06 Len también escribe desde cero —Crear es su
      // primer mensaje—, así que la frase dice las dos cosas: si ya están, se
      // añade dentro; si la página es nueva, lleva las tres.)
      expect(p).toContain("When the document already has them, add what you are missing INSIDE them");
    }
  });

  it("CONTRA-PRUEBA: el contrato crudo SÍ las trae — las quita el corte por superficie", () => {
    expect(PUBLISH_CONTRACT_MIN).toContain("• Tailwind via CDN:");
    expect(PUBLISH_CONTRACT_MIN).toContain("• Your own CSS goes in a");
  });

  it("el bloque oscuro no se le ORDENA a nadie: se le CONDICIONA a quien edita", () => {
    // La orden está en el contrato crudo (era la de Crear, retirado el
    // 2026-10-06), y el corte por superficie la cambia.
    expect(PUBLISH_CONTRACT_MIN).toContain("Also emit `:root[data-ol-mode=");
    // El Agente, sólo en la página que crea (H8): en la que ya existe manda ella.
    expect(instruccionesDeLen()).toContain("On a page you create yourself, also write its dark version");
    expect(aiDesignSystemMessage()).toContain("If the page doesn't define it yet, write it yourself");
    for (const p of [instruccionesDeLen(), aiDesignSystemMessage()]) {
      // …y entonces OFICIO no puede seguir ordenándolo doce líneas más abajo,
      // o el contrato se contradiría a sí mismo dentro del mismo prompt.
      expect(p).not.toContain("Emit the dark block anyway");
    }
  });

  // 5. EL VOCABULARIO DE TOKENS — la avería que costó una función entera del
  //    editor. El contrato ordenaba `--bg / --fg / --accent`; toda la
  //    maquinaria de tema lee `--ol-*`. Lo que unía los dos era la cadena
  //    born-canonical, y `5bfb2272` la apagó para lo del modelo — con razón,
  //    porque reescribía el diseño entero. El vocabulario obligatorio era la
  //    OTRA MITAD de ese puente: se quedó en pie restringiendo cómo escribe el
  //    modelo, sin nada al otro lado. Toda página nueva nacía sorda al Tema.
  //
  //    Esta prueba ata el texto del contrato a `TOKENS_DEL_CONTRATO`, que es
  //    la lista contra la que `cambiar_tema` decide si se niega. Mientras las
  //    dos tengan que coincidir aquí, no pueden volver a derivar en silencio.
  //
  //    Len salió de las dos el 2026-09-29: el Tema ya escribe en los nombres
  //    de la página, así que a él no se le ordena ningún espacio de nombres
  //    (ver «Len: sus colores en variables de :root, con SUS nombres» arriba).
  it("el vocabulario que el contrato ordena es el que el editor LEE", () => {
    for (const [nombre, prompt] of [
      ["chat", aiDesignSystemMessage()],
    ] as const) {
      for (const token of TOKENS_DEL_CONTRATO) {
        expect(prompt, `${nombre} no nombra ${token}`).toContain(token);
      }
    }
  });

  it("y ya no ordena el espacio de nombres que nadie lee", () => {
    for (const prompt of [aiDesignSystemMessage()]) {
      // `--ol-bg` NO contiene la subcadena `--bg`, así que esto distingue.
      for (const pelado of ["--bg", "--fg", "--accent", "--surface", "--border", "--radius"]) {
        expect(prompt).not.toContain(pelado);
      }
      // El conmutador del editor es un ATRIBUTO sobre <html>, no una clase:
      // `:root.dark` era justo lo que la cadena apagada convertía.
      expect(prompt).not.toContain(":root.dark");
    }
  });

  // 6. La palanca de emergencia no pasa por aquí: `PUBLISH_CONTRACT` está en
  //    inglés y estas marcas no existen en él. Lo que se comprueba es que el
  //    ajuste no LANCE por ese camino, que es como se rompe un prompt entero.
  it("con el contrato completo el prompt sigue construyéndose", () => {
    vi.stubEnv("OPENLEN_MIN_CONTRACT", "0");
    expect(() => instruccionesDeLen()).not.toThrow();
    expect(() => aiDesignSystemMessage()).not.toThrow();
  });
});
