import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * LAS ETIQUETAS DEL MANDO DE ESFUERZO, EN LOS DIEZ IDIOMAS.
 *
 * POR QUÉ EXISTE. El 2026-09-13 las cinco descripciones se reescribieron con la
 * forma del binario de Claude Code, que no describe la CALIDAD de cada nivel
 * sino la OCASIÓN de usarlo: «`/effort` controls how long Claude thinks before
 * answering. `high` for tricky bugs, `low` when you just need a quick edit.»
 *
 * El motivo del cambio, y lo que esta prueba sujeta: las anteriores no le daban
 * contra a NINGÚN peldaño. Leídas en fila, cada una sonaba mejor que la de
 * abajo —la de arriba era «Toda la capacidad, el razonamiento más profundo»— y
 * un usuario racional elige siempre el tope. Está MEDIDO que eso no compra
 * calidad y cuesta un 14,5% de espera (80,0 s/página contra 91,6, n=48 por
 * brazo), así que la escalera estaba empujando en la dirección equivocada.
 *
 * 🔴 Y LA TRAMPA QUE CIERRA. `xhighDesc` NOMBRA al nivel `high` («Cuando
 * "A fondo" no lo sacó»). Eso es una referencia a la interfaz dentro de un
 * texto, y esas caducan EN SILENCIO: quien renombre `high` deja diez cadenas
 * apuntando a un nivel que ya no se llama así, en diez idiomas, sin que nada se
 * ponga rojo. Ver [[reglas-de-prompt-que-nombran-la-interfaz]]. La referencia se
 * queda porque es la forma más clara de decirlo; lo que no se queda es que sea
 * silenciosa.
 */

const LOCALES = readdirSync(join(process.cwd(), "messages")).filter((d) =>
  /^[a-z]{2}$/.test(d),
);

function composer(locale: string): Record<string, string> {
  const ruta = join(process.cwd(), "messages", locale, "panelsChat.json");
  return JSON.parse(readFileSync(ruta, "utf8")).composer as Record<string, string>;
}

describe("las etiquetas del esfuerzo", () => {
  // Sin esto un recorrido roto —una carpeta renombrada— dejaría todo lo de
  // abajo VERDE por no haber mirado nada, que es la trampa clásica de las
  // pruebas que afirman sobre una lista que ellas mismas construyen.
  it("mira los DIEZ idiomas", () => {
    expect(LOCALES).toHaveLength(10);
  });

  it.each(LOCALES)("%s: los cinco niveles tienen nombre y descripción", (locale) => {
    const c = composer(locale);
    for (const n of ["low", "medium", "high", "xhigh", "max"]) {
      expect(c[n]?.trim(), `${locale}.composer.${n}`).toBeTruthy();
      expect(c[`${n}Desc`]?.trim(), `${locale}.composer.${n}Desc`).toBeTruthy();
    }
  });

  // 🔴 LA GUARDA DE LA REFERENCIA CRUZADA.
  it.each(LOCALES)("%s: `xhighDesc` sigue nombrando al nivel `high` de verdad", (locale) => {
    const c = composer(locale);
    expect(
      c.xhighDesc,
      `«${c.xhighDesc}» tiene que nombrar al nivel high, que en ${locale} se ` +
        `llama «${c.high}». Si acabas de renombrar high, esta cadena —y su ` +
        `gemela en los otros nueve idiomas— apunta a un nivel que ya no existe.`,
    ).toContain(c.high);
  });

  // EL TOPE ES EL ÚNICO PELDAÑO QUE DICE LO QUE CUESTA, y eso es lo que impide
  // que la escalera se lea como «más es siempre mejor» — el defecto entero de
  // las etiquetas anteriores.
  //
  // Se afirma que son DOS FRASES (la ocasión y el coste), no una longitud
  // mínima: ese fue mi primer intento y salió rojo con el chino, que dice lo
  // mismo en nueve caracteres —«真正卡住时用。最慢»— porque es una lengua más
  // compacta, no porque le falte la segunda idea. Un umbral que hay que
  // calibrar por idioma mide el idioma, no la copia. Tampoco vale una lista de
  // la palabra «lento» en diez lenguas: sería una segunda traducción que se
  // desincroniza de la primera.
  const CORTE = /[.。]\s*\S/u;

  it.each(LOCALES)("%s: `maxDesc` son DOS ideas — la ocasión y el coste", (locale) => {
    const c = composer(locale);
    expect(
      CORTE.test(c.maxDesc),
      `${locale}.composer.maxDesc = «${c.maxDesc}». El tope tiene que decir ` +
        `TAMBIÉN lo que cuesta; si se queda en un superlativo suelto, la ` +
        `escalera vuelve a empujar hacia arriba y está medido que arriba no ` +
        `compra calidad (44/48 contra 43/48) y cuesta un 14,5% de espera.`,
    ).toBe(true);
  });

  // BRAZO DE CONTROL. Sin él, la de arriba pasaría también el día que alguien
  // le meta un punto a las cinco descripciones: lo que la hace significar algo
  // es que `max` sea el ÚNICO con dos frases.
  it.each(LOCALES)("%s: y es el ÚNICO con dos frases", (locale) => {
    const c = composer(locale);
    for (const n of ["low", "medium", "high", "xhigh"]) {
      expect(CORTE.test(c[`${n}Desc`]), `${locale}.composer.${n}Desc = «${c[`${n}Desc`]}»`).toBe(
        false,
      );
    }
  });
});
