// ─────────────────────────────────────────────────────────────────────────────
// EL MOTIVO DE UN FALLO, sacado de la respuesta que la herramienta le dio al
// modelo — para que la tarjeta roja diga LO MISMO que el modelo leyó.
//
// 🔴 POR QUÉ EXISTE. La tarjeta pintaba «Cambiar tema · falló» y se acababa
// ahí. El motivo no faltaba: estaba en `outcome.response.error`, viajaba al
// modelo y desde el 2026-09-10 lo guarda el diario del turno. Lo único que no
// hacía era llegar a la pantalla de quien mira.
//
// LA VARA (Claude Code). Allí el texto del error es UNO: va al
// modelo envuelto en `<tool_use_error>…</tool_use_error>` y la interfaz pinta
// ESE MISMO string quitándole el envoltorio con
// `/^(?:<tool_use_error>)?(?:Error: )?/`. No hay una redacción para el usuario
// y otra para el modelo, porque dos redacciones del mismo fallo son dos
// verdades y una miente.
//
// Y NUNCA VACÍO, que es la otra mitad de esa regla: cuando un comando falla sin
// escribir nada, ellos ponen «Command failed with no output» en vez de dejar el
// hueco. Aquí eso se cumple en la tarjeta, que conserva su «falló» localizado
// cuando esto devuelve `undefined`.
//
// 🔴 TRES CLAVES Y NO UNA, a propósito. Las herramientas no se pusieron de
// acuerdo: la mayoría devuelve `error`, `documento-de-memoria.ts` devuelve
// `motivo` y el guardado de notas devuelve `reason`. Exigir una sola clave
// ahora sería tocar 27 ficheros para que la tarjeta hable, y el fichero que se
// olvidara se quedaría mudo EN SILENCIO — que es el defecto que esto viene a
// cerrar, no uno nuevo que abrir.
// ─────────────────────────────────────────────────────────────────────────────

/** Tope del motivo que viaja en el evento y se pinta. Coincide con el de
 *  `summary` en la tarjeta persistida (`ActionSchema`): pasarse de ahí haría
 *  400 a TODO el turno, que desaparecería al recargar sin decir nada. El motivo
 *  ENTERO —hasta 400— sigue en el diario del turno, que es el registro. */
export const TOPE_MOTIVO = 200;

/** Las claves con las que las herramientas de verdad devuelven el porqué, en
 *  orden de preferencia.
 *
 *  🔴 `detalle` VA PRIMERO, y es lo contrario de lo que parece. En Claude Code
 *  el texto del error es UNO y es PROSA: la interfaz pinta el mismo string que
 *  leyó el modelo. Aquí la respuesta viene partida —`error` a veces es un
 *  CÓDIGO (`op_contra_la_raiz`, `seccion_no_abierta`, `sin_tokens`) y la frase
 *  que un humano lee está en `detalle`—, así que preferir `error` le ponía a la
 *  tarjeta un slug teniendo la frase al lado. MEDIDO el 2026-09-18 en el diario
 *  de producción: el turno «ponme un carrito con base de datos» habría estrenado
 *  la tarjeta diciendo «falló · op_contra_la_raiz».
 *
 *  `error` sigue detrás porque en casi todas las herramientas YA es la frase, y
 *  entonces se enseña igual que antes. Y `como_hacerlo` NO está en esta lista a
 *  propósito: es la corrección que va al modelo —como la que Claude Code pega a
 *  una entrada inválida—, no una línea de tarjeta. El objeto entero sigue en el diario. */
const CLAVES = ["detalle", "error", "motivo", "reason"] as const;

/**
 * El motivo de una respuesta FALLIDA, o `undefined` si no la hay.
 *
 * Sólo mira respuestas con `ok: false` exacto: una respuesta sin `ok` no ha
 * declarado fallo, y una que fue bien no tiene nada que explicar — colgarle un
 * motivo a una tarjeta verde sería peor que no tener motivos.
 */
export function motivoDelFallo(
  respuesta: Record<string, unknown> | undefined,
): string | undefined {
  if (!respuesta || respuesta.ok !== false) return undefined;
  for (const clave of CLAVES) {
    const valor = respuesta[clave];
    if (typeof valor !== "string") continue;
    const limpio = valor.trim();
    if (!limpio) continue;
    return recorta(limpio);
  }
  return undefined;
}

/** Se corta CON MARCA. Una frase que acaba a medias sin avisar se lee como el
 *  motivo entero, y manda a buscar por donde no es. El texto ENTERO sigue en
 *  el diario del turno, que es el registro. */
function recorta(texto: string): string {
  return texto.length > TOPE_MOTIVO ? `${texto.slice(0, TOPE_MOTIVO)}…` : texto;
}

/**
 * LO QUE EL DUEÑO TIENE QUE SABER DE UNA LLAMADA QUE FUE BIEN, para la ÁMBAR.
 *
 * No es un fallo: la llamada fue bien y la edición se guardó. Lo que no ocurrió
 * es la COMPROBACIÓN, y hasta el 2026-09-18 eso no salía del servidor — se
 * quedaba en un `console.warn` de la caja mientras la tarjeta se pintaba verde.
 * MEDIDO esa noche en producción: dos pruebas descartadas por `sin_accion` en
 * «ponme un carrito con base de datos», y ni una señal en la pantalla del dueño.
 *
 * 🔴 ÁMBAR Y NO ROJA, y la diferencia importa. En Claude Code una entrada que no
 * valida acaba en un `tool_result` con `is_error` —la llamada ENTERA falló—.
 * Aquí la edición sí se aplicó: pintarla roja diría que el trabajo del usuario
 * se perdió, que es mentira y es la avería contraria a la que arreglamos.
 *
 * El string es el MISMO que leyó el modelo, no una segunda redacción — la regla
 * de siempre.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🔴 POR QUÉ YA NO MIRA SÓLO `prueba_descartada` (2026-09-21).
 *
 * El arreglo del 18/09 acertó en la forma y se quedó en UNA bandera. Contadas
 * sobre `tools.ts`: hay **17** claves `extra.*`, de las cuales **13 son señales
 * de avería** —`handlers_muertos`, `contenido_perdido`, `formularios_perdidos`,
 * `css_sin_efecto`, `referencias_rotas`, `enlaces_sin_origen`…— todas con su
 * guarda, o sea que sólo aparecen cuando algo se rompió de verdad. Y el bucle
 * leía de la respuesta, para pintar, exactamente cuatro: `ok`, `cambio`,
 * `error` y `prueba_descartada`. **Una de trece.**
 *
 * Las otras doce viajaban en `aviso_critico` y su ÚNICO consumidor era el
 * modelo, vía la regla «nunca cierres un turno callando un aviso»
 * (`catalog.ts`). O sea que el dueño se enteraba de un handler muerto **sólo si
 * Len se acordaba de mencionarlo en su prosa** — exactamente la clase de señal
 * que depende de la obediencia del modelo, y que ya está medido que falla.
 *
 * LA DECISIÓN, en la forma de Claude Code: **un solo canal.** Lo que el modelo
 * lee ES lo que se enseña; no hay una segunda ruta con lista blanca de la que
 * un hecho pueda caerse. Un `Edit` que dice «Found 2 matches» no necesita que
 * nadie recableé ese hecho para que se vea.
 *
 * NO INUNDA, y se midió antes de escribirlo: sobre 90 llamadas con diario en
 * producción, 15 traían `aviso_critico`; 9 eran rechazos de spec —que desde el
 * despliegue del 20/09 ya salen ámbar— y quedan **6, un 6,7%**, que hoy son
 * invisibles. Ése es el ámbar que esto añade.
 *
 * ⚠️ LA PRECEDENCIA NO CAMBIA, y es lo que evita el defecto contrario: la
 * frase del DUEÑO (`tarjeta`) va primero, y `aviso_critico` es el último
 * recurso. `aviso_critico` está escrito para el modelo y a veces trae su receta
 * dentro; enseñarlo es peor que enseñar nada sólo si hay algo mejor, y cuando
 * no lo hay, una frase áspera y verdadera le gana al silencio. Que las trece
 * ganen su frase de dueño es trabajo aparte, y ahora al menos se nota cuál
 * falta.
 */
export function avisoParaElDueno(
  respuesta: Record<string, unknown> | undefined,
): string | undefined {
  // Sólo cuando la llamada NO falló: un turno que además falló ya tiene su
  // motivo rojo, y dos motivos en una fila no caben ni se leen.
  if (!respuesta || respuesta.ok === false) return undefined;

  // `tarjeta` PRIMERO: es la frase escrita para quien mira —lo que no se
  // comprobó y qué hacer—, mientras que `aviso` es la receta del modelo
  // («dale a alguno un `clic:"#selector"`»), que al dueño no le sirve de nada.
  // El hecho es el mismo en las dos (`HECHO_SIN_COMPROBAR`); lo que cambia es
  // quién tiene que mover ficha. `aviso` queda de respaldo para las entradas
  // anteriores al 2026-09-18: una tarjeta técnica se lee mal, media no se lee.
  const descartada = respuesta.prueba_descartada;
  if (descartada && typeof descartada === "object") {
    for (const clave of ["tarjeta", "aviso"] as const) {
      const texto = (descartada as Record<string, unknown>)[clave];
      if (typeof texto !== "string") continue;
      const limpio = texto.trim();
      if (limpio) return recorta(limpio);
    }
  }

  // Y EL CANAL GENERAL. Cualquier aviso que la herramienta le dio al modelo es
  // un hecho que el servidor comprobó; que se vea. Ver el bloque de arriba.
  const critico = respuesta.aviso_critico;
  if (typeof critico === "string") {
    const limpio = critico.trim();
    if (limpio) return recorta(limpio);
  }

  return undefined;
}
