import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAgentSystemPrompt, buildFunctionDeclarations } from "./agent/catalog";
import { TOKENS_DEL_CONTRATO } from "./agent/tools";
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
import { redesignPromptFinal } from "./agent/redesign";
import { conContratoMinimo } from "./publish-contract-min";

/** Una entrada mínima: lo que se mide es el ANDAMIO del prompt, no el brief. */
const ENTRADA_REDISENO = {
  html: "<h1>x</h1>",
  direccion: "más moderna",
  brief: null,
};

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
    // 🔴 EL REDISEÑO FALTABA, y por eso se le escapó a esta guarda lo que la
    // guarda existe para cazar: interpolaba `DESIGN_GUIDANCE` ENTERA — 32.487
    // caracteres con el esqueleto de secciones, el orden y la barra de
    // diseño. O sea, la
    // definición literal de «gusto nuestro», en la única superficie que esta
    // lista no miraba. Una lista de superficies escrita a mano no avisa de la
    // que le falta; ésta ya se llamaba «ninguna superficie».
    ["rediseño", () => redesignPromptFinal(ENTRADA_REDISENO)],
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
  it.each(PROMPTS)("%s exige el vocabulario de tokens", (_name, getPrompt) => {
    const p = getPrompt();
    expect(p, "sin --ol-accent los controles de acento del editor no tienen a qué agarrarse").toContain("--ol-accent");
    expect(p, "sin var() el color se repite a mano y el tema no se puede cambiar").toContain("var()");
    expect(p, "sin el selector del editor la página no puede voltear a oscuro").toContain(
      ':root[data-ol-mode="dark"]',
    );
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
describe("el contrato mínimo alcanza a las cuatro superficies", () => {
  const SUPERFICIES: Array<[string, () => string]> = [
    ["crear", () => generateSystemMessage({})],
    ["editar", () => aiDesignSystemMessage()],
    ["Agente", () => buildAgentSystemPrompt()],
    ["rediseño", () => redesignPromptFinal(ENTRADA_REDISENO)],
  ];

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(SUPERFICIES)("%s manda el contrato MÍNIMO por defecto", (_n, getPrompt) => {
    const p = getPrompt();
    // La cabecera del mínimo, en español.
    expect(p).toContain("LO QUE LA PUBLICACIÓN IMPONE");
    // Y NO la del completo, que es lo que se estaba mandando.
    expect(p).not.toContain("OUTPUT FORMAT — strict rules");
  });

  it.each(SUPERFICIES)("%s vuelve al completo con OPENLEN_MIN_CONTRACT=0", (nombre, getPrompt) => {
    vi.stubEnv("OPENLEN_MIN_CONTRACT", "0");
    const p =
      nombre === "crear"
        ? generateSystemMessage({ OPENLEN_MIN_CONTRACT: "0" })
        : nombre === "rediseño"
          ? redesignPromptFinal(ENTRADA_REDISENO, { OPENLEN_MIN_CONTRACT: "0" })
          : getPrompt();
    expect(p).toContain("OUTPUT FORMAT — strict rules");
  });

  // EL MÍNIMO ADELGAZA DE VERDAD. Sin esta cuenta, la palanca podría estar
  // cableada y no recortar nada, que es justo el fallo que su guarda de
  // sustitución existe para impedir — pero desde el otro lado.
  it.each(SUPERFICIES)("%s pesa MENOS con el mínimo que con el completo", (nombre, getPrompt) => {
    const conMin = getPrompt();
    vi.stubEnv("OPENLEN_MIN_CONTRACT", "0");
    const conCompleto =
      nombre === "crear"
        ? generateSystemMessage({ OPENLEN_MIN_CONTRACT: "0" })
        : nombre === "rediseño"
          ? redesignPromptFinal(ENTRADA_REDISENO, { OPENLEN_MIN_CONTRACT: "0" })
          : getPrompt();
    expect(conMin.length).toBeLessThan(conCompleto.length);
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
 * Cada arreglo va con su CONTRA-PRUEBA a propósito: las dos frases son VERDAD
 * en `crear` —devuelve el documento entero y sus subpáginas declaradas se
 * construyen— así que un arreglo que las quitara de todas partes rompería la
 * superficie donde son ciertas, y saldría verde en cualquier prueba que sólo
 * mirase al Agente.
 */
describe("el contrato dicho para cada superficie", () => {
  const DOCUMENTO_ENTERO = "El primer carácter de tu respuesta es";
  const EL_ENLACE_CREA = "y esa página se crea";

  // 1. La respuesta del Agente son llamadas a herramientas más prosa para el
  //    usuario. El contrato le decía que empezara por `<` y acabara en
  //    `</html>`, contradiciendo su propio bloque TONO 130 líneas más arriba.
  it("el Agente NO recibe que su respuesta sea el documento entero", () => {
    expect(buildAgentSystemPrompt()).not.toContain(DOCUMENTO_ENTERO);
  });

  it("el Chat tampoco: sólo el Modo B devuelve documento, así que no se afirma", () => {
    expect(aiDesignSystemMessage()).not.toContain(DOCUMENTO_ENTERO);
  });

  it("CONTRA-PRUEBA: crear y el rediseño SÍ la reciben — ahí es verdad", () => {
    expect(generateSystemMessage({})).toContain(DOCUMENTO_ENTERO);
    expect(redesignPromptFinal(ENTRADA_REDISENO)).toContain(DOCUMENTO_ENTERO);
  });

  // 2. Escribir `href="/servicios"` sólo crea la página en `crear`. En las
  //    otras tres no crea nada: la ruta no existe, Caddy sirve la portada con
  //    un 200 y el enlace se rompe EN SILENCIO. O sea que el contrato enseñaba
  //    a cometer el fallo que otra de sus propias viñetas advierte.
  it("sólo `crear` recibe que un enlace CREA la página", () => {
    expect(generateSystemMessage({})).toContain(EL_ENLACE_CREA);
    expect(buildAgentSystemPrompt()).not.toContain(EL_ENLACE_CREA);
    expect(aiDesignSystemMessage()).not.toContain(EL_ENLACE_CREA);
    expect(redesignPromptFinal(ENTRADA_REDISENO)).not.toContain(EL_ENLACE_CREA);
  });

  it("y a las otras se les dice lo que SÍ pasa: la portada con un 200", () => {
    for (const p of [aiDesignSystemMessage(), redesignPromptFinal(ENTRADA_REDISENO)]) {
      expect(p).toContain("NO crea esa página");
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
  it("la lista de <iframe> permitidos se dice UNA vez, no dos", () => {
    for (const [nombre, prompt] of [
      ["agente", buildAgentSystemPrompt()],
      ["rediseño", redesignPromptFinal(ENTRADA_REDISENO)],
    ] as const) {
      const veces = prompt.split("Google Maps, YouTube y Vimeo").length - 1;
      expect(veces, `${nombre} la dice ${veces} veces`).toBe(1);
    }
  });

  it("NO SE PERDIÓ: el rediseño conserva la lista y sus formas de URL", () => {
    const p = redesignPromptFinal(ENTRADA_REDISENO);
    expect(p).toContain("player.vimeo.com/video/");
    expect(p).toContain("maps.google.com/maps?q=");
  });

  // 3.b LAS «CONDUCTAS», retiradas el 2026-08-23. `bakeBehaviors` no tiene ni
  //     un solo call site fuera de su propio test, así que un marcador heredado
  //     es hoy un atributo INERTE: no recibe runtime al publicar. Nombrarlas en
  //     una lista de CONSERVA no protegía nada y enseñaba un vocabulario que ya
  //     no existe. No se pierde cobertura — la regla que las cubría sigue
  //     siendo «CONSERVA todo elemento que lleve un atributo data-ol-*».
  it("ninguna superficie nombra ya las conductas", () => {
    for (const p of [buildAgentSystemPrompt(), redesignPromptFinal(ENTRADA_REDISENO)]) {
      expect(p).not.toMatch(/conductas?\b/i);
    }
    const redisenar = buildFunctionDeclarations({}).find((d) => d.name === "redisenar_pagina");
    expect(redisenar?.description).not.toMatch(/conductas?\b/i);
    expect(redisenar?.description).toContain("atributos data-ol-*");
  });

  it("NO SE PERDIÓ: «las dos mitades» sigue llegando al Agente", () => {
    expect(buildAgentSystemPrompt()).toContain("Escribe SIEMPRE LAS DOS MITADES");
  });

  it("NO SE PERDIÓ: el Agente conserva la lista de <iframe> y sus formas de URL", () => {
    const p = buildAgentSystemPrompt();
    expect(p).toContain("player.vimeo.com/video/");
    expect(p).toContain("maps.google.com/maps?q=");
  });

  // 4. LAS ÓRDENES DE CONSTRUCCIÓN. «Tailwind por CDN en el `<head>`», «Google
  //    Fonts por <link> en el `<head>`» y «tu CSS propio en un <style> del
  //    `<head>`» son órdenes de CONSTRUIR un documento. Un turno de edición no
  //    construye ningún `<head>`: recibe uno hecho, y la única forma de
  //    "obedecer" sería duplicar el script y la hoja que ya estaban.
  it("las superficies que EDITAN no reciben la orden de construir el <head>", () => {
    for (const p of [buildAgentSystemPrompt(), aiDesignSystemMessage()]) {
      expect(p).not.toContain("• Tailwind por CDN:");
      expect(p).not.toContain("• Tu CSS propio va en un");
      // Y lo que SÍ reciben: dónde viven esas tres cosas, sin ordenar crearlas.
      expect(p).toContain("El documento que edites ya las trae");
    }
  });

  it("CONTRA-PRUEBA: crear y el rediseño SÍ las reciben — ahí construyen el <head>", () => {
    for (const p of [generateSystemMessage({}), redesignPromptFinal(ENTRADA_REDISENO)]) {
      expect(p).toContain("• Tailwind por CDN:");
      expect(p).toContain("• Tu CSS propio va en un");
    }
  });

  it("el bloque oscuro se le ORDENA a quien crea y se le CONDICIONA a quien edita", () => {
    for (const p of [generateSystemMessage({}), redesignPromptFinal(ENTRADA_REDISENO)]) {
      expect(p).toContain("Emite también `:root[data-ol-mode=");
    }
    for (const p of [buildAgentSystemPrompt(), aiDesignSystemMessage()]) {
      expect(p).toContain("Si la página aún no lo define, escríbelo tú");
      // …y entonces OFICIO no puede seguir ordenándolo doce líneas más abajo,
      // o el contrato se contradiría a sí mismo dentro del mismo prompt.
      expect(p).not.toContain("Emite igualmente el bloque oscuro");
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
  it("el vocabulario que el contrato ordena es el que el editor LEE", () => {
    for (const [nombre, prompt] of [
      ["crear", generateSystemMessage({})],
      ["chat", aiDesignSystemMessage()],
      ["agente", buildAgentSystemPrompt()],
      ["rediseño", redesignPromptFinal(ENTRADA_REDISENO)],
    ] as const) {
      for (const token of TOKENS_DEL_CONTRATO) {
        expect(prompt, `${nombre} no nombra ${token}`).toContain(token);
      }
    }
  });

  it("y ya no ordena el espacio de nombres que nadie lee", () => {
    for (const prompt of [
      generateSystemMessage({}),
      aiDesignSystemMessage(),
      buildAgentSystemPrompt(),
      redesignPromptFinal(ENTRADA_REDISENO),
    ]) {
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
    expect(() => buildAgentSystemPrompt()).not.toThrow();
    expect(() => aiDesignSystemMessage()).not.toThrow();
  });
});
