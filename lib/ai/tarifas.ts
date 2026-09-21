/**
 * LOS PRECIOS DE LISTA DE FIREWORKS. La única copia.
 *
 * POR QUÉ EXISTE, y es una corrección medida el 2026-09-20. Estos números
 * vivían escritos a mano en `lib/credits.ts` y OTRA VEZ a mano en
 * `lib/generation/page-generation-budget.ts`, atados por una prueba que
 * comparaba las dos tablas entre sí. El 2026-09-12 el papel con visión y el
 * agente pasaron a `deepseek-v4p1-flash` y se les puso la tarifa de V4 Flash
 * «porque cuesta lo mismo». No cuesta lo mismo: hoy V4.1 está a
 * 0.30/0.006/1.20 contra 0.22/0.007/0.66 — la salida es 1,82x.
 *
 * 🔴 Y LA PRUEBA ESTABA VERDE. Comparó dos copias del MISMO número equivocado
 * y lo llamó acuerdo. Una prueba que ata A con B no dice nada de si A es
 * cierto: las dos derivaron juntas. Ése es el defecto que este fichero retira,
 * y no se retira con un número nuevo — se retira dejando UNA sola copia, para
 * que no haya dos cosas que puedan separarse.
 *
 * La forma es la de Claude Code: una constante con nombre por punto de precio,
 * y los modelos que comparten precio APUNTAN a la misma constante en vez de
 * copiar sus cifras. Un alias no puede desincronizarse; una copia sí, y este
 * repo lleva cuatro correcciones demostrándolo.
 *
 * 🔴 NO IMPORTA NADA. Tiene que ser puro: lo lee `lib/credits.ts` (que arrastra
 * `lib/db`) y lo lee el guardia de presupuesto (un módulo de cálculo puro que
 * NO puede arrastrarla). Ése es el motivo exacto por el que las cifras estaban
 * duplicadas en vez de importadas, y por el que la solución es extraer y no
 * importar de una a la otra.
 *
 * LO QUE ESTE FICHERO NO PUEDE SABER: si estos números siguen siendo los de
 * Fireworks. Nada dentro del repo puede. Eso lo comprueba
 * `npm run modelos:comprobar`, que le pregunta al proveedor.
 *
 * Fuente: docs.fireworks.ai/serverless/pricing, columna Standard, USD por
 * millón de tokens. Precios de LISTA, no contratados (confirmado por Jesús el
 * 2026-09-13).
 */

export interface TarifaPorMillon {
  readonly input: number;
  readonly output: number;
  /** ⚰️ ERA OPCIONAL, y sólo por Gemini: sus dos filas nunca la llevaron. Al
   *  retirarlas (2026-09-20) no queda ninguna tarifa sin cacheada, así que
   *  seguir declarándola opcional afirmaría que existe un caso que ya no
   *  existe — y obligaría a cada llamador a escribir un `?? 0` que nunca
   *  corre. Obligatoria: una fila nueva sin cacheada no compila, y quien la
   *  añada tiene que decidir qué pone. */
  readonly cached: number;
}

/** DeepSeek V4 Flash (0731). El papel `reasoner`. */
const V4_FLASH = { input: 0.22, output: 0.66, cached: 0.007 } as const;

/**
 * DeepSeek V4.1 Flash. Los papeles `visualCritic` y `agent`.
 *
 * 🔴 TIENE FILA PROPIA, y ése es todo el arreglo. Se cobraba como `V4_FLASH`
 * desde el 2026-09-12 con un comentario afirmando que costaban igual. La regla
 * que ya estaba escrita en `lib/credits.ts` —«el proveedor que corrió el turno
 * es el que tiene que pagar el turno; cobrar Pro a precio de Flash escondería
 * un 6x»— aplica idéntica aquí: esconder un 1,82x de salida es la misma falta,
 * más pequeña.
 *
 * Ojo a la cacheada: es la ÚNICA que baja (0.006 contra 0.007). No es un
 * redondeo, es la tabla del proveedor.
 */
const V4P1_FLASH = { input: 0.30, output: 1.20, cached: 0.006 } as const;

/** DeepSeek V4 Pro. Hoy no lo corre ningún papel; lo monta a mano
 *  `lib/agent/redesign.ts`, y por eso la fila se queda. */
const V4_PRO = { input: 1.32, output: 3.96, cached: 0.044 } as const;

/**
 * La tabla. La clave es el PUNTO DE PRECIO, no el modelo: dos modelos al mismo
 * precio comparten fila, que es lo que hace imposible que se separen.
 *
 * ⚰️ AQUÍ VIVÍAN `gemini-pro` (1.25/10) y `gemini-flash` (0.30/2.50), retiradas
 * el 2026-09-20. Gemini salió del repo entero el 2026-08-28 y nadie las cobraba
 * desde entonces; sobrevivieron trece días más a la limpieza porque una tarifa
 * no parece una palanca. Lo es: `CreditRate` es un tipo, así que mientras la
 * fila esté, el compilador ACEPTA `creditRate("gemini-flash")` en cualquier
 * sitio nuevo — y este repo ya tuvo un rediseño cobrándose a esa tarifa
 * mientras corría por Fireworks. Es el mismo argumento con el que se quitó
 * `qwen-vision`, aplicado al último resto.
 *
 * Con ellas se va el ÚNICO caso de tarifa sin cacheada, y por eso `cached` pasó
 * a obligatoria arriba.
 */
export const TARIFAS_POR_MILLON = {
  "deepseek-flash": V4_FLASH,
  "deepseek-flash-4p1": V4P1_FLASH,
  "deepseek-pro": V4_PRO,
} as const satisfies Readonly<Record<string, TarifaPorMillon>>;

export type CreditRate = keyof typeof TARIFAS_POR_MILLON;

/**
 * LA TARIFA DE UNA CLAVE, O UN ERROR QUE DICE CUÁL FALTA.
 *
 * 🔴 EL TIPO NO BASTA, y por eso esto revienta en EJECUCIÓN. `CreditRate`
 * protege lo que el compilador ve, y la clave llega a esta tabla desde sitios
 * que el compilador no mira: un `as CreditRate` en la política, un valor que
 * venga de la base de datos, un papel nuevo cuya fila nadie añadió. Por
 * cualquiera de esas puertas, `TARIFAS_POR_MILLON[clave]` era `undefined` y lo
 * de después no fallaba aquí: fallaba en la aritmética, como
 * «Cannot read properties of undefined» dentro del cálculo del cargo — o peor,
 * como un `NaN` que se convierte en créditos.
 *
 * LA FORMA ES LA DE Claude Code: al montar la tarifa desde una entrada de su
 * catálogo comprueba que estén TODOS los medidores y, si falta uno, lanza
 * nombrando la entrada en vez de devolver un objeto a medias. Una tarifa
 * incompleta no se completa sola: se denuncia.
 *
 * Se comprueban los tres ejes y que sean números FINITOS y no negativos: un
 * `NaN` en la tabla pasaría todas las comprobaciones de presencia y volvería a
 * salir por el otro lado como un cargo sin sentido.
 */
export function tarifaDe(clave: CreditRate): TarifaPorMillon {
  const t: TarifaPorMillon | undefined = TARIFAS_POR_MILLON[clave];
  if (!t) {
    throw new Error(
      `tarifa desconocida: «${clave}» no está en lib/ai/tarifas.ts. ` +
        `Las que hay: ${Object.keys(TARIFAS_POR_MILLON).join(", ")}.`,
    );
  }
  const malos = (["input", "output", "cached"] as const).filter((eje) => {
    const v = t[eje];
    return typeof v !== "number" || !Number.isFinite(v) || v < 0;
  });
  if (malos.length > 0) {
    throw new Error(
      `la tarifa «${clave}» está incompleta: ${malos.join(", ")}. ` +
        `Una tarifa necesita entrada, salida y cacheada, y las tres finitas — ` +
        `media tarifa cobra mal en silencio.`,
    );
  }
  return t;
}
