import { describe, expect, it } from "vitest";

import { modelRuntimePromptBlock } from "@/lib/ai-stream/model-runtime";
import { modelPruebaPromptBlock } from "@/lib/ai-stream/model-prueba";

import { SYSTEM_PROMPT, generateSystemMessage, systemPromptFor } from "./system-prompt";

/**
 * LA DIRECTIVA DE ESTRUCTURA, Y POR QUÉ EXISTE.
 *
 * Medido 2026-08-20 sobre 14 páginas de briefs muy distintos —terror, colorear
 * para niños, club de comedia, videojuego, escuela, panadería—: TODAS salieron
 * `nav → header → 3-5 section → footer`. Nadie se lo pedía; el prompt le
 * entrega la estructura al modelo explícitamente. Es su atractor.
 *
 * Con la directiva, en un A/B de 6 briefs (0,63 MXN): la forma canónica pasó de
 * 5/6 a 2/6 y la rejilla de tres columnas de 5/6 a 2/6, sin una sola página
 * rota — 0 texto bajo 4.5:1 y 0 desborde horizontal en las que se renderizaron.
 *
 * Este test es lo que impide que se caiga en un refactor sin que nadie lo note:
 * volvería el esqueleto único y no habría ningún síntoma que lo delatara.
 */
describe("la directiva de estructura sigue en el prompt", () => {
  it("nombra los tres hábitos que se midieron", () => {
    expect(SYSTEM_PROMPT).toContain("ESTRUCTURA");
    for (const habito of ["tarjetas de tres en tres", "héroe centrado", "porque parece que falta"]) {
      expect(SYSTEM_PROMPT, `la directiva ya no nombra: ${habito}`).toContain(habito);
    }
  });

  // La primera redacción los PROHIBÍA y sobre-corrigió: le quitó el índice a un
  // ensayo largo, que es justo donde un índice sirve. La directiva pide
  // decidir, no obedecer — y eso también hay que sostenerlo.
  it("pide elegirlos, no prohibirlos", () => {
    expect(SYSTEM_PROMPT).toContain("ELEGIR, no heredar");
    expect(SYSTEM_PROMPT).toContain("Consérvalos cuando esta página los pida");
  });

  it("no toca lo que el prompt ya prometía: la estructura es del modelo", () => {
    expect(SYSTEM_PROMPT).toContain("are yours to decide");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// El interruptor del contrato mínimo (2026-08-21).
// ───────────────────────────────────────────────────────────────────────────

import { PUBLISH_CONTRACT } from "@/lib/design-guidance";
import { PUBLISH_CONTRACT_MIN } from "@/lib/publish-contract-min";

const min = () => systemPromptFor({ OPENLEN_MIN_CONTRACT: "1" });

describe("el interruptor del contrato mínimo", () => {
  // INVERTIDO el 2026-08-23: el mínimo es el DEFECTO. Antes había que
  // acordarse de encenderlo, y por eso pasó tres días decidido y sin usar.
  it("por defecto sale el MÍNIMO — la ausencia enciende", () => {
    expect(systemPromptFor({})).not.toBe(SYSTEM_PROMPT);
    expect(systemPromptFor({})).toContain("LO QUE LA PUBLICACIÓN IMPONE");
  });

  it("sólo el literal 0 devuelve el contrato completo", () => {
    // Ya no sale IDÉNTICO: el volteo del JavaScript es incondicional desde el
    // 2026-08-26 y le cambia su bloque. Lo que el interruptor decide sigue
    // siendo cuál de los dos contratos entra, y eso es lo que se mide.
    const completo = systemPromptFor({ OPENLEN_MIN_CONTRACT: "0" });
    expect(completo).not.toContain("LO QUE LA PUBLICACIÓN IMPONE");
    expect(completo).toContain("JAVASCRIPT");
    // Un "false" o un "no" NO apagan: la vuelta atrás es una sola forma, igual
    // que en `lib/publish/kill-switches.ts`.
    expect(systemPromptFor({ OPENLEN_MIN_CONTRACT: "false" })).not.toBe(SYSTEM_PROMPT);
    expect(systemPromptFor({ OPENLEN_MIN_CONTRACT: "true" })).not.toBe(SYSTEM_PROMPT);
  });

  it("encendido, la sustitución OCURRE — si no, el brazo sería falso", () => {
    const out = min();
    expect(out).not.toBe(SYSTEM_PROMPT);
    expect(out).not.toContain(PUBLISH_CONTRACT);
    expect(out).toContain("LO QUE LA PUBLICACIÓN IMPONE");
    // EL RECORTE SE MIDE ENTRE LAS DOS RAMAS, no contra el literal crudo.
    //
    // Antes era `out.length < SYSTEM_PROMPT.length * 0.4`, y eso comparaba el
    // prompt ENSAMBLADO contra la constante SIN ensamblar. Mide bien mientras
    // lo único que pase entre las dos sea el recorte; en cuanto se añade un
    // bloque a las DOS ramas por igual, el numerador crece y el denominador no,
    // y la guarda se pone roja sin que el recorte haya fallado. Pasó el
    // 2026-08-31 con el catálogo de librerías (1.531 bytes que no tocan el
    // contrato). Comparar rama contra rama cancela todo lo compartido y deja
    // justo lo que el interruptor decide.
    //
    // Sigue siendo un brazo de control de verdad: si la sustitución dejara de
    // ocurrir, las dos ramas saldrían IDÉNTICAS y el cociente sería 1.
    const completo = systemPromptFor({ OPENLEN_MIN_CONTRACT: "0" });
    expect(out.length).toBeLessThan(completo.length * 0.8);
  });

  // La directiva de arriba vive FUERA del contrato, así que el recorte no
  // puede llevársela por delante.
  it("la directiva de estructura sobrevive al recorte", () => {
    expect(min()).toContain("ESTRUCTURA");
    expect(min()).toContain("ELEGIR, no heredar");
  });
});

/** Lo que el recorte NO puede perder: cada una rompe la página publicada. */
describe("lo obligatorio sobrevive al recorte", () => {
  const OBLIGATORIO: [string, RegExp][] = [
    ["documento completo", /<!doctype html>/i],
    ["Tailwind por CDN", /cdn\.tailwindcss\.com/],
    ["Google Fonts", /fonts\.googleapis\.com/],
    ["los iframes permitidos", /iframe/i],
    // Pinned el 2026-08-31: el contrato prometía que un `<a href>` se convertía
    // en mapa al publicar, y ese horneado se había borrado cinco días antes
    // (`3a4e2a97`). Nadie se enteró porque nada lo sujetaba: toda página de
    // negocio local nacía sin mapa. Ahora la forma que SÍ funciona —el embed sin
    // clave de Google Maps— es obligatoria en el contrato.
    ["la forma del mapa que de verdad sobrevive", /maps\.google\.com\/maps\?q=/],
    ["data-slot-path prohibido", /data-slot-path/],
    // ⚰️ AQUÍ SE EXIGÍA `data-ol-photo`, y esta línea sujetaba una mentira.
    // El 2026-09-04 `39edba05` retiró del CONTRATO la promesa de que un hueco
    // de degradado marcado se rellenaba con una foto real, porque el horneado
    // no existe desde `4feb19d9`. Pero la MISMA instrucción vivía además en el
    // bloque NON-NEGOTIABLE de esta superficie —«a real curated photo is
    // swapped in after generation»—, y esta prueba la mantenía viva: el
    // contrato pedía la página TERMINADA doce líneas más abajo mientras el
    // bloque de arriba seguía pidiendo el hueco. Sólo `crear` la tenía; el
    // Agente y el Chat no. Retiradas las dos el 2026-09-04.
    ["nada de huecos que rellene otro", /resolve the area YOURSELF/],
    ["href absoluto con esquema", /mailto:/],
    // `--ol-accent-ink`, no `--accent-ink`: el vocabulario pasó al espacio que
    // los controles de Tema del editor LEEN. Ver `lib/publish-contract-min.ts`.
    ["vocabulario de tokens", /--ol-accent-ink/],
    ["360 px", /360\s?px/],
  ];
  for (const [nombre, re] of OBLIGATORIO) {
    it(`conserva: ${nombre}`, () => expect(min()).toMatch(re));
  }
});

/**
 * La hipótesis que este interruptor existe para poder probar: que el
 * vocabulario de página y los ejemplos de markup fijan la forma antes de que el
 * brief hable. Si algo se cuela, el brazo deja de medir lo que dice medir.
 */
describe("lo que el recorte tiene que haber quitado", () => {
  it("cero vocabulario de arquitectura de página", () => {
    const coladas = ["landing", "marketing", "hero", "carousel", "carrusel", "testimoni"]
      .filter((p) => new RegExp(p, "i").test(PUBLISH_CONTRACT_MIN));
    expect(coladas).toEqual([]);
  });

  it("casi ningún ejemplo de HTML — el actual trae decenas", () => {
    const etiquetas = (t: string) =>
      [...t.matchAll(/<(section|div|nav|header|article|button|ul|li|a|img|code|p|span)\b/gi)].length;
    // Los dos que quedan son literales obligatorios: el <script> de Tailwind y
    // el <style> del <head>.
    expect(etiquetas(PUBLISH_CONTRACT_MIN)).toBeLessThanOrEqual(2);
    expect(etiquetas(PUBLISH_CONTRACT)).toBeGreaterThan(20);
  });

  it("las nueve CONDUCTAS quedan FUERA — pérdida CONOCIDA, no descuido", () => {
    // Sin esto el modelo no emite los marcadores y las páginas nacen sin
    // countdown, filtro, lightbox… Antes de encender esto en producción hay que
    // inyectar la receta que el brief pida, no las nueve siempre.
    expect(PUBLISH_CONTRACT_MIN).not.toContain("data-ol-countdown");
    expect(PUBLISH_CONTRACT).toContain("data-ol-countdown");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// HALLAZGO 19 — «el arnés de evaluación no mide lo que producción manda».
//
// `scripts/evals-pages.ts` mandaba `SYSTEM_PROMPT` PELADO mientras la ruta
// manda `systemPromptFor(env) + runtime + prueba`. Con el contrato pesando el
// 85% del prompt eso no es un matiz: el marcador salía verde sobre una jaula
// distinta de la que reciben las páginas de la gente —sin contrato mínimo, sin
// el JavaScript del modelo, sin la prueba— y con ese verde se autorizaba un
// despliegue. Y el mismo mensaje estaba escrito TRES veces en `route.ts`, que
// es exactamente cómo se llega a una cuarta copia distinta sin que nadie lo vea.
describe("generateSystemMessage — una sola fuente para lo que se manda", () => {
  it("no es SYSTEM_PROMPT pelado: lleva el contrato mínimo, como producción", () => {
    expect(generateSystemMessage({})).not.toBe(SYSTEM_PROMPT);
    expect(generateSystemMessage({})).toContain("LO QUE LA PUBLICACIÓN IMPONE");
  });

  it("con OPENLEN_MODEL_JS=1 lleva el bloque del runtime Y el de la prueba", () => {
    const env = { OPENLEN_MODEL_JS: "1" };
    const runtime = modelRuntimePromptBlock();
    const prueba = modelPruebaPromptBlock();
    // Si estos dos salieran vacíos la prueba pasaría sin comprobar nada.
    expect(runtime).not.toBe("");
    expect(prueba).not.toBe("");
    expect(generateSystemMessage(env)).toContain(runtime);
    expect(generateSystemMessage(env)).toContain(prueba);
  });

  // RETIRADA con el interruptor. Fijaba que con `OPENLEN_MODEL_JS=0` el
  // mensaje que se manda fuera EXACTAMENTE `systemPromptFor(env)` — o sea, que
  // el bloque del JavaScript no cobrara ni un carácter a quien no lo usaba.
  // Ahora lo usa todo el mundo, así que el bloque siempre suma.
  it("y lo que añade es el bloque del JavaScript, no otra cosa", () => {
    const env = {};
    const extra = generateSystemMessage(env).replace(systemPromptFor(env), "");
    expect(extra).toContain("INTERACCIÓN CON JAVASCRIPT");
  });

  // Lo que produjo el hallazgo fue la COPIA A MANO, así que se vigila la copia
  // a mano y no el resultado: el día que alguien vuelva a ensamblar el mensaje
  // en la ruta o en el arnés, esto cae antes de que las dos se separen.
  it("ni la ruta ni el arnés vuelven a ensamblarlo por su cuenta", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    for (const f of [join("app", "api", "generate", "route.ts"), join("scripts", "evals-pages.ts")]) {
      const src = readFileSync(join(process.cwd(), f), "utf8");
      expect(src, `${f} arma el prompt del sistema por su cuenta`).not.toContain("systemPromptFor");
      expect(src, `${f} pega el bloque del runtime por su cuenta`).not.toContain("modelRuntimePromptBlock");
      expect(src, `${f} pega el bloque de la prueba por su cuenta`).not.toContain("modelPruebaPromptBlock");
      expect(src, `${f} manda SYSTEM_PROMPT pelado`).not.toContain("SYSTEM_PROMPT");
    }
  });
});

/**
 * MÁS DE UNA PÁGINA, EN LOS DOS CONTRATOS.
 *
 * El fallo: pedías «una web con inicio, servicios y contacto» y salía UNA
 * página. El modelo hacía bien — el contrato le decía que una ruta relativa se
 * rompe en silencio y que sin destino use `href="#"`, así que escribía
 * `#servicios`. Medido en el corpus del repo: todas las navegaciones generadas
 * son anclas.
 *
 * La regla nueva tiene que estar en LOS DOS contratos, y el que importa es el
 * MÍNIMO: `systemPromptFor` recorta por defecto (`min` es cierto salvo
 * `OPENLEN_MIN_CONTRACT=0`), así que una regla que sólo viva en el completo
 * está escrita y no se envía nunca. Ese es exactamente el modo de fallo que el
 * interruptor ya tuvo que aprender a gritar unas líneas más arriba.
 */
describe("el contrato deja que un sitio tenga varias páginas", () => {
  it("la regla está en el contrato COMPLETO", () => {
    expect(SYSTEM_PROMPT).toContain("MÁS DE UNA PÁGINA");
    expect(SYSTEM_PROMPT).toContain('href="/servicios"');
  });

  it("y en el que de verdad se envía, que es el MÍNIMO", () => {
    const enviado = systemPromptFor({ OPENLEN_MIN_CONTRACT: "1" });
    expect(enviado).toContain("MÁS DE UNA PÁGINA");
    expect(enviado).toContain('href="/servicios"');
  });

  // Sin esto la regla se leería como «haz varias páginas», y cada landing
  // normal nacería troceada. Una página con secciones sigue siendo la
  // respuesta por defecto — el corte lo decide el contenido, no el entusiasmo.
  it("pero una sola página sigue siendo la respuesta por defecto", () => {
    for (const contrato of [SYSTEM_PROMPT, systemPromptFor({ OPENLEN_MIN_CONTRACT: "1" })]) {
      expect(contrato).toContain("por defecto");
      expect(contrato).toContain("#seccion");
    }
  });

  // El techo se dice EN el contrato: es lo que evita que un modelo entusiasta
  // declare doce páginas. `paginasDeclaradas` lo vuelve a aplicar por su cuenta
  // — cinturón y tirantes, porque un prompt no es una garantía.
  it("y dice cuántas caben", () => {
    for (const contrato of [SYSTEM_PROMPT, systemPromptFor({ OPENLEN_MIN_CONTRACT: "1" })]) {
      expect(contrato.toLowerCase()).toContain("cuatro");
    }
  });
});
